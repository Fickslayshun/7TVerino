import { computed, ref, watch } from "vue";
import { useStore } from "@/store/main";
import type { ChannelContext, ChannelRole } from "@/composable/channel/useChannelContext";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useApollo } from "@/composable/useApollo";
import { twitchChannelBadgesQuery } from "@/assets/gql/tw.channel-badges.gql";
import { twitchViewerChatBadgePickerQuery } from "@/assets/gql/tw.viewer-chat-badge-picker.gql";
import {
	applyTVerinoSelfMessageStateToMessage,
	rememberTVerinoSelfMessageState,
	toTVerinoBadgeMap,
} from "./tverinoPendingMessage";
import { getTwitchBadgeSets } from "./twitchBadgeSets";
import {
	selectTwitchChannelAuthorityBadge,
	selectTwitchChannelBadge,
	selectTwitchGlobalBadge,
} from "./twitchGlobalBadgeSelection";

export interface TVerinoGlobalBadgeOption {
	key: string;
	setID: string;
	version: string;
	title: string;
	image1x: string;
	image2x: string;
}

type SubscriptionBadgeLike = Pick<Twitch.ChatBadge, "setID" | "title" | "version"> & {
	description?: string | null;
};
type ApolloQueryClient = NonNullable<ReturnType<typeof useApollo>["value"]>;
interface BadgeRefreshResult {
	channelDisplayBadges: Twitch.ChatBadge[];
	globalDisplayBadges: Twitch.ChatBadge[];
}

const EMPTY_BADGE_SETS: Twitch.BadgeSets = {
	globalsBySet: new Map(),
	channelsBySet: new Map(),
	count: 0,
};
const KNOWN_SUBSCRIPTION_BADGE_SET_IDS = new Set(["subscriber", "founder"]);
const KNOWN_CHANNEL_AUTHORITY_BADGE_SET_IDS = new Set(["broadcaster", "moderator", "vip"]);
const CHANNEL_ROLE_BADGE_PRIORITY: ChannelRole[] = ["BROADCASTER", "MODERATOR", "VIP"];
const CHANNEL_ROLE_BADGE_SET_BY_ROLE: Record<ChannelRole, string | null> = {
	BROADCASTER: "broadcaster",
	EDITOR: null,
	MODERATOR: "moderator",
	VIP: "vip",
	SUBSCRIBER: null,
	FOLLOWER: null,
};
const SUBSCRIPTION_BADGE_PATTERN = /\b(subscriber|founder)\b/i;
const GIFT_SUBSCRIPTION_BADGE_PATTERN = /\bgift(?:ed)?\s+subs?\b/i;
const GLOBAL_BADGE_CACHE_STALE_MS = 2 * 60 * 1000;
const GLOBAL_BADGE_CACHE_LIMIT = 32;
const globalBadgeStateCache = new Map<string, CachedGlobalBadgeState>();

interface CachedGlobalBadgeState {
	fetchedAt: number;
	accessedAt: number;
	ownedGlobalBadges: Twitch.ChatBadge[];
	availableChannelBadges: Twitch.ChatBadge[];
	channelDisplayBadges: Twitch.ChatBadge[];
	selectedDisplayBadges: Twitch.ChatBadge[];
	selectedGlobalDisplayBadges: Twitch.ChatBadge[];
}

export function useTVerinoGlobalBadges(ctx: ChannelContext) {
	const store = useStore();
	const apollo = useApollo();
	const messages = useChatMessages(ctx);
	const properties = useChatProperties(ctx);

	const globalBadgeLoading = ref(false);
	const selectingBadgeKey = ref("");
	const globalBadgeNotice = ref("");
	const globalBadgeNoticeIsError = ref(false);
	const ownedGlobalBadges = ref<Twitch.ChatBadge[]>([]);
	const availableChannelBadges = ref<Twitch.ChatBadge[]>([]);
	const channelDisplayBadges = ref<Twitch.ChatBadge[]>([]);
	const selectedDisplayBadges = ref<Twitch.ChatBadge[]>([]);
	const selectedGlobalDisplayBadges = ref<Twitch.ChatBadge[]>([]);
	const optimisticSelectedGlobalBadge = ref<TVerinoGlobalBadgeOption | null>(null);
	let refreshToken = 0;
	let selectionAttemptToken = 0;

	const viewerLogin = computed(() => {
		const identity = store.identity;
		if (!identity || !("username" in identity)) return "";
		return identity.username?.trim().toLowerCase() ?? "";
	});
	const viewerID = computed(() => store.identity?.id ?? "");
	const viewerDisplayName = computed(() => {
		const identity = store.identity;
		if (!identity || !("username" in identity)) return "";
		return ("displayName" in identity && identity.displayName) || identity.username || "";
	});

	const globalBadgeOptions = computed<TVerinoGlobalBadgeOption[]>(() =>
		buildBadgeOptions(
			[
				...ownedGlobalBadges.value,
				...selectedGlobalDisplayBadges.value.filter(
					(badge) =>
						!availableChannelBadges.value.some(
							(channelBadge) => toBadgeKey(channelBadge) === toBadgeKey(badge),
						),
				),
			],
			selectedGlobalDisplayBadges.value,
		),
	);

	const channelBadgeOptions = computed<TVerinoGlobalBadgeOption[]>(() =>
		buildBadgeOptions(
			[
				...availableChannelBadges.value,
				...selectedDisplayBadges.value.filter((badge) =>
					availableChannelBadges.value.some((channelBadge) => toBadgeKey(channelBadge) === toBadgeKey(badge)),
				),
			],
			selectedDisplayBadges.value,
		),
	);

	const resolvedSelectedGlobalBadge = computed(() => {
		const optionsByKey = new Map<string, TVerinoGlobalBadgeOption>();
		for (const option of [...globalBadgeOptions.value, ...channelBadgeOptions.value]) {
			optionsByKey.set(option.key, option);
		}

		for (const badge of selectedGlobalDisplayBadges.value) {
			const found = optionsByKey.get(toBadgeKey(badge));
			if (found) return found;
		}

		return null;
	});
	const selectedGlobalBadgeKeys = computed(() =>
		optimisticSelectedGlobalBadge.value
			? [optimisticSelectedGlobalBadge.value.key]
			: selectedGlobalDisplayBadges.value.map(toBadgeKey),
	);
	const selectedGlobalBadge = computed(
		() => optimisticSelectedGlobalBadge.value ?? resolvedSelectedGlobalBadge.value,
	);
	const selectedChannelRoleBadge = computed<TVerinoGlobalBadgeOption | null>(() => {
		for (const badge of channelDisplayBadges.value) {
			if (!isChannelAuthorityBadge(badge)) continue;
			return toBadgeOption(badge);
		}

		const fallbackBadge = resolveActorRoleBadge(ctx.actor.roles, properties.twitchBadgeSets);
		return fallbackBadge ? toBadgeOption(fallbackBadge) : null;
	});
	const selectedSubscriberBadge = computed<TVerinoGlobalBadgeOption | null>(() => {
		for (const badge of channelDisplayBadges.value) {
			if (!isSubscriptionBadge(badge)) continue;
			return toBadgeOption(badge);
		}

		return null;
	});

	const isSelectingBadge = computed(() => selectingBadgeKey.value.length > 0);
	const globalBadgeEmptyText = computed(() => {
		if (globalBadgeLoading.value) return "Loading Twitch badges...";
		if (!viewerLogin.value) return "Log in to Twitch to manage your Twitch badges.";
		if (!ctx.username) return "This channel is unavailable.";
		return "No selectable Twitch badges were found for this account.";
	});

	watch(
		() => [ctx.id, ctx.username, viewerLogin.value] as const,
		() => {
			const cacheKey = getGlobalBadgeCacheKey(ctx, viewerLogin.value);
			if (!cacheKey) {
				ownedGlobalBadges.value = [];
				availableChannelBadges.value = [];
				channelDisplayBadges.value = [];
				selectedDisplayBadges.value = [];
				selectedGlobalDisplayBadges.value = [];
				globalBadgeNotice.value = "";
				globalBadgeNoticeIsError.value = false;
				globalBadgeLoading.value = false;
				return;
			}

			const cachedState = readCachedGlobalBadgeState(cacheKey);
			if (cachedState) {
				applyCachedGlobalBadgeState(cachedState);
				if (!isCachedGlobalBadgeStateStale(cachedState)) return;
				void refreshGlobalBadgeState(true);
				return;
			}

			void refreshGlobalBadgeState();
		},
		{ immediate: true },
	);

	watch(
		() =>
			[ctx.id, viewerID.value, viewerLogin.value, viewerDisplayName.value, selectedDisplayBadges.value] as const,
		([channelID, actorID, actorLogin, actorDisplayName, displayBadges]) => {
			if (!channelID || !actorID || !actorLogin) return;

			if (displayBadges.length > 0) {
				properties.twitchBadgeSets = mergeDisplayBadgesIntoBadgeSets(properties.twitchBadgeSets, displayBadges);
			}

			const badges = toTVerinoBadgeMap(displayBadges);
			const selfState = {
				badges,
				displayBadges: displayBadges.map((badge) => ({ ...badge })),
				user: {
					userID: actorID,
					userLogin: actorLogin,
					userDisplayName: actorDisplayName || actorLogin,
					displayName: actorDisplayName || actorLogin,
					isSubscriber: !!(badges.subscriber || badges.founder),
				},
			};

			rememberTVerinoSelfMessageState(channelID, selfState);

			for (const message of messages.find((msg) => msg.author?.id === actorID, true)) {
				applyTVerinoSelfMessageStateToMessage(message, selfState);
			}
		},
		{ immediate: true },
	);

	async function refreshGlobalBadgeState(preserveNotice = false): Promise<BadgeRefreshResult | null> {
		const token = ++refreshToken;
		const channelID = ctx.id?.trim();
		const channelLogin = ctx.username?.trim().toLowerCase();
		const cacheKey = getGlobalBadgeCacheKey(ctx, viewerLogin.value);
		if (!channelID || !channelLogin || !viewerLogin.value || !cacheKey) {
			ownedGlobalBadges.value = [];
			availableChannelBadges.value = [];
			channelDisplayBadges.value = [];
			selectedDisplayBadges.value = [];
			selectedGlobalDisplayBadges.value = [];
			if (!preserveNotice) {
				globalBadgeNotice.value = "";
				globalBadgeNoticeIsError.value = false;
			}
			return {
				channelDisplayBadges: [],
				globalDisplayBadges: [],
			};
		}

		globalBadgeLoading.value = true;
		if (!preserveNotice) {
			globalBadgeNotice.value = "";
			globalBadgeNoticeIsError.value = false;
		}

		try {
			if (!apollo.value) {
				throw new Error("Twitch GraphQL client unavailable");
			}

			const [pickerResp, badgeSets] = await Promise.all([
				apollo.value.query<
					twitchViewerChatBadgePickerQuery.Response,
					twitchViewerChatBadgePickerQuery.Variables
				>({
					query: twitchViewerChatBadgePickerQuery,
					variables: {
						channelID,
						channelLogin,
						targetLogin: viewerLogin.value,
						isViewerBadgeCollectionEnabled: true,
					},
					fetchPolicy: "network-only",
				}),
				loadBadgeSetsForPicker(apollo.value, channelID, channelLogin),
			]);

			if (token !== refreshToken) return null;

			const earnedBadges = dedupeBadges(pickerResp.data.channelViewer?.earnedBadges ?? []);
			const globalDisplayBadges = dedupeBadges(pickerResp.data.targetUser?.globalDisplayBadges ?? []);
			const nextChannelDisplayBadges = dedupeBadges(pickerResp.data.targetUser?.channelDisplayBadges ?? []);
			const globalBadges = dedupeBadges([...earnedBadges, ...globalDisplayBadges]).filter(
				(badge) => !isSubscriptionBadge(badge) && !isChannelScopedBadge(badge, badgeSets),
			);
			const channelBadges = buildSelectableChannelBadges({
				badgeSets,
				displayBadges: nextChannelDisplayBadges,
				earnedBadges,
			});
			const channelSelectableKeys = new Set<string>([
				...globalBadges.map(toBadgeKey),
				...channelBadges.map(toBadgeKey),
			]);
			const globalSelectableKeys = new Set<string>(globalBadges.map(toBadgeKey));

			ownedGlobalBadges.value = globalBadges;
			availableChannelBadges.value = channelBadges;
			channelDisplayBadges.value = nextChannelDisplayBadges;
			selectedDisplayBadges.value = nextChannelDisplayBadges.filter((badge) =>
				channelSelectableKeys.has(toBadgeKey(badge)),
			);
			selectedGlobalDisplayBadges.value = globalDisplayBadges.filter((badge) =>
				globalSelectableKeys.has(toBadgeKey(badge)),
			);
			writeCachedGlobalBadgeState(cacheKey, {
				fetchedAt: Date.now(),
				accessedAt: Date.now(),
				ownedGlobalBadges: ownedGlobalBadges.value.map((badge) => ({ ...badge })),
				availableChannelBadges: availableChannelBadges.value.map((badge) => ({ ...badge })),
				channelDisplayBadges: channelDisplayBadges.value.map((badge) => ({ ...badge })),
				selectedDisplayBadges: selectedDisplayBadges.value.map((badge) => ({ ...badge })),
				selectedGlobalDisplayBadges: selectedGlobalDisplayBadges.value.map((badge) => ({ ...badge })),
			});
			return {
				channelDisplayBadges: channelDisplayBadges.value.map((badge) => ({ ...badge })),
				globalDisplayBadges: selectedGlobalDisplayBadges.value.map((badge) => ({ ...badge })),
			};
		} catch (error) {
			if (token !== refreshToken) return null;
			if (!preserveNotice) {
				ownedGlobalBadges.value = [];
				availableChannelBadges.value = [];
				channelDisplayBadges.value = [];
				selectedDisplayBadges.value = [];
				selectedGlobalDisplayBadges.value = [];
			}
			globalBadgeNotice.value = toErrorMessage(error, "Unable to load Twitch badges.");
			globalBadgeNoticeIsError.value = true;
			return null;
		} finally {
			if (token === refreshToken) {
				globalBadgeLoading.value = false;
			}
		}
	}

	function applyCachedGlobalBadgeState(state: CachedGlobalBadgeState): void {
		ownedGlobalBadges.value = state.ownedGlobalBadges.map((badge) => ({ ...badge }));
		availableChannelBadges.value = state.availableChannelBadges.map((badge) => ({ ...badge }));
		channelDisplayBadges.value = state.channelDisplayBadges.map((badge) => ({ ...badge }));
		selectedDisplayBadges.value = state.selectedDisplayBadges.map((badge) => ({ ...badge }));
		selectedGlobalDisplayBadges.value = state.selectedGlobalDisplayBadges.map((badge) => ({ ...badge }));
		globalBadgeNotice.value = "";
		globalBadgeNoticeIsError.value = false;
		globalBadgeLoading.value = false;
	}

	async function selectBadgeOption(badge: TVerinoGlobalBadgeOption): Promise<void> {
		if (
			selectingBadgeKey.value ||
			(!optimisticSelectedGlobalBadge.value &&
				selectedGlobalDisplayBadges.value.some((entry) => toBadgeKey(entry) === badge.key))
		) {
			return;
		}
		const selectingChannelBadge = channelBadgeOptions.value.some((option) => option.key === badge.key);
		const selectingSubscriptionBadge = isSubscriptionBadge(badge);
		const attemptToken = ++selectionAttemptToken;

		selectingBadgeKey.value = badge.key;
		globalBadgeNotice.value = "";
		globalBadgeNoticeIsError.value = false;
		if (!selectingChannelBadge) {
			optimisticSelectedGlobalBadge.value = badge;
		}

		try {
			if (selectingChannelBadge) {
				const channelID = ctx.id?.trim();
				if (!channelID) {
					throw new Error("Channel unavailable.");
				}

				if (selectingSubscriptionBadge) {
					await selectTwitchChannelBadge(
						{
							channelID,
							badgeSetID: badge.setID,
							badgeSetVersion: badge.version,
						},
						apollo.value,
					);
				} else {
					await selectTwitchChannelAuthorityBadge(
						{
							channelID,
							badgeSetID: badge.setID,
							badgeSetVersion: badge.version,
						},
						apollo.value,
					);
				}
			} else {
				await selectTwitchGlobalBadge(
					{
						badgeSetID: badge.setID,
						badgeSetVersion: badge.version,
					},
					apollo.value,
				);
			}

			if (attemptToken !== selectionAttemptToken) return;

			selectingBadgeKey.value = "";
			globalBadgeNotice.value = `Applying ${badge.title}...`;
			globalBadgeNoticeIsError.value = false;

			void confirmBadgeSelection({
				badge,
				selectingChannelBadge,
				attemptToken,
			});
		} catch (error) {
			if (attemptToken !== selectionAttemptToken) return;
			if (!selectingChannelBadge) {
				optimisticSelectedGlobalBadge.value = null;
			}
			globalBadgeNotice.value = toErrorMessage(error, `Unable to select ${badge.title}.`);
			globalBadgeNoticeIsError.value = true;
		} finally {
			if (attemptToken === selectionAttemptToken && selectingBadgeKey.value === badge.key) {
				selectingBadgeKey.value = "";
			}
		}
	}

	async function confirmBadgeSelection(input: {
		badge: TVerinoGlobalBadgeOption;
		selectingChannelBadge: boolean;
		attemptToken: number;
	}): Promise<void> {
		const verifiedBadges = await refreshGlobalBadgeState(true);
		if (input.attemptToken !== selectionAttemptToken) return;

		if (!verifiedBadges) {
			globalBadgeNotice.value = `Selected ${input.badge.title}. Syncing with Twitch...`;
			globalBadgeNoticeIsError.value = false;
			return;
		}

		const verifiedSelection = input.selectingChannelBadge
			? verifiedBadges.channelDisplayBadges
			: verifiedBadges.globalDisplayBadges;

		if (!verifiedSelection.some((entry) => toBadgeKey(entry) === input.badge.key)) {
			if (!input.selectingChannelBadge) {
				optimisticSelectedGlobalBadge.value = null;
			}
			globalBadgeNotice.value = `Twitch did not confirm ${input.badge.title} as your ${
				input.selectingChannelBadge ? "channel badge" : "global badge"
			}.`;
			globalBadgeNoticeIsError.value = true;
			return;
		}

		if (!input.selectingChannelBadge) {
			optimisticSelectedGlobalBadge.value = null;
		}
		globalBadgeNotice.value = `Selected ${input.badge.title}.`;
		globalBadgeNoticeIsError.value = false;
	}

	return {
		globalBadgeLoading,
		globalBadgeOptions,
		channelBadgeOptions,
		globalBadgeNotice,
		globalBadgeNoticeIsError,
		globalBadgeEmptyText,
		isSelectingBadge,
		channelDisplayBadges,
		selectedChannelRoleBadge,
		selectedGlobalBadge,
		selectedDisplayBadges,
		selectedSubscriberBadge,
		selectedGlobalBadgeKeys,
		selectingBadgeKey,
		refreshGlobalBadgeState,
		selectBadgeOption,
	};
}

function getGlobalBadgeCacheKey(ctx: ChannelContext, viewerLogin: string): string {
	const channelKey = ctx.id?.trim() || ctx.username?.trim().toLowerCase() || "";
	if (!channelKey) return "";
	return `${viewerLogin || "anonymous"}:${channelKey}`;
}

function readCachedGlobalBadgeState(cacheKey: string): CachedGlobalBadgeState | null {
	const cached = globalBadgeStateCache.get(cacheKey);
	if (!cached) return null;

	cached.accessedAt = Date.now();
	return cached;
}

function writeCachedGlobalBadgeState(cacheKey: string, state: CachedGlobalBadgeState): void {
	globalBadgeStateCache.set(cacheKey, state);

	if (globalBadgeStateCache.size <= GLOBAL_BADGE_CACHE_LIMIT) return;

	let oldestKey = "";
	let oldestAccess = Number.POSITIVE_INFINITY;
	for (const [key, value] of globalBadgeStateCache) {
		if (value.accessedAt >= oldestAccess) continue;
		oldestAccess = value.accessedAt;
		oldestKey = key;
	}

	if (oldestKey) {
		globalBadgeStateCache.delete(oldestKey);
	}
}

function isCachedGlobalBadgeStateStale(state: CachedGlobalBadgeState): boolean {
	return Date.now() - state.fetchedAt > GLOBAL_BADGE_CACHE_STALE_MS;
}

async function loadBadgeSetsForPicker(
	apollo: ApolloQueryClient | null,
	channelID: string,
	channelLogin: string,
): Promise<Twitch.BadgeSets> {
	const apolloBadgeSets = apollo
		? await fetchBadgeSetsViaApollo(apollo, channelLogin).catch(() => EMPTY_BADGE_SETS)
		: EMPTY_BADGE_SETS;

	if (hasSubscriptionBadgeVersions(apolloBadgeSets)) {
		return apolloBadgeSets;
	}

	const helixBadgeSets = await getTwitchBadgeSets(channelID).catch(() => EMPTY_BADGE_SETS);
	return mergeBadgeSets(apolloBadgeSets, helixBadgeSets);
}

function buildBadgeOptions(badges: Twitch.ChatBadge[], selectedBadges: Twitch.ChatBadge[]): TVerinoGlobalBadgeOption[] {
	const selectedKeys = new Set(selectedBadges.map(toBadgeKey));
	const optionsByKey = new Map<string, TVerinoGlobalBadgeOption>();

	for (const badge of badges) {
		optionsByKey.set(toBadgeKey(badge), toBadgeOption(badge));
	}

	const options = [...optionsByKey.values()];
	options.sort((left, right) => compareBadgeOptions(left, right, selectedKeys));
	return options;
}

function buildSelectableChannelBadges(input: {
	badgeSets: Twitch.BadgeSets;
	displayBadges: Twitch.ChatBadge[];
	earnedBadges: Twitch.ChatBadge[];
}): Twitch.ChatBadge[] {
	const channelBadges = [
		...dedupeBadges([...input.displayBadges, ...input.earnedBadges]).filter(
			(badge) => !isSubscriptionBadge(badge) && isChannelScopedBadge(badge, input.badgeSets),
		),
	];

	return dedupeBadges(channelBadges);
}

function compareBadgeOptions(
	left: TVerinoGlobalBadgeOption,
	right: TVerinoGlobalBadgeOption,
	selectedKeys: Set<string>,
): number {
	const selectedDelta = Number(selectedKeys.has(right.key)) - Number(selectedKeys.has(left.key));
	if (selectedDelta !== 0) return selectedDelta;

	return left.title.localeCompare(right.title) || left.version.localeCompare(right.version);
}

function isSubscriptionBadgeSet(setID: string): boolean {
	return KNOWN_SUBSCRIPTION_BADGE_SET_IDS.has(setID.trim().toLowerCase());
}

function isChannelScopedBadge(
	badge: Pick<Twitch.ChatBadge, "setID" | "version">,
	badgeSets: Twitch.BadgeSets,
): boolean {
	if (KNOWN_CHANNEL_AUTHORITY_BADGE_SET_IDS.has(badge.setID.trim().toLowerCase())) return true;
	if (badgeSets.channelsBySet.has(badge.setID)) return true;

	const globalVersions = badgeSets.globalsBySet.get(badge.setID);
	if (!globalVersions) return false;

	return !globalVersions.has(badge.version);
}

function isChannelAuthorityBadge(badge: Pick<Twitch.ChatBadge, "setID">): boolean {
	return KNOWN_CHANNEL_AUTHORITY_BADGE_SET_IDS.has(badge.setID.trim().toLowerCase());
}

function isSubscriptionBadge(badge: SubscriptionBadgeLike): boolean {
	if (isSubscriptionBadgeSet(badge.setID)) return true;

	const description = typeof badge.description === "string" ? badge.description : "";
	const text = [badge.title, description]
		.map((value) => value?.trim() ?? "")
		.filter(Boolean)
		.join(" ");

	return SUBSCRIPTION_BADGE_PATTERN.test(text) && !GIFT_SUBSCRIPTION_BADGE_PATTERN.test(text);
}

function dedupeBadges(badges: Twitch.ChatBadge[]): Twitch.ChatBadge[] {
	const byKey = new Map<string, Twitch.ChatBadge>();

	for (const badge of badges) {
		byKey.set(toBadgeKey(badge), badge);
	}

	return [...byKey.values()];
}

function toBadgeOption(badge: Twitch.ChatBadge): TVerinoGlobalBadgeOption {
	return {
		key: toBadgeKey(badge),
		setID: badge.setID,
		version: badge.version,
		title: badge.title || `${badge.setID} ${badge.version}`,
		image1x: badge.image1x,
		image2x: badge.image2x,
	};
}

function toBadgeKey(badge: Pick<Twitch.ChatBadge, "setID" | "version">): string {
	return `${badge.setID}:${badge.version}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}

async function fetchBadgeSetsViaApollo(apollo: ApolloQueryClient, channelLogin: string): Promise<Twitch.BadgeSets> {
	const resp = await apollo.query<twitchChannelBadgesQuery.Response, twitchChannelBadgesQuery.Variables>({
		query: twitchChannelBadgesQuery,
		variables: {
			login: channelLogin,
		},
		fetchPolicy: "network-only",
	});

	return mapBadgeSetsFromApollo(resp.data.badges ?? [], resp.data.user?.broadcastBadges ?? []);
}

function hasSubscriptionBadgeVersions(badgeSets: Twitch.BadgeSets): boolean {
	for (const versions of badgeSets.channelsBySet.values()) {
		for (const badge of versions.values()) {
			if (isSubscriptionBadge(badge)) return true;
		}
	}

	return false;
}

function mergeBadgeSets(primary: Twitch.BadgeSets, secondary: Twitch.BadgeSets): Twitch.BadgeSets {
	const globalsBySet = mergeBadgeMaps(primary.globalsBySet, secondary.globalsBySet);
	const channelsBySet = mergeBadgeMaps(primary.channelsBySet, secondary.channelsBySet);

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function mergeBadgeMaps(
	primary: Map<string, Map<string, Twitch.ChatBadge>>,
	secondary: Map<string, Map<string, Twitch.ChatBadge>>,
): Map<string, Map<string, Twitch.ChatBadge>> {
	const merged = new Map<string, Map<string, Twitch.ChatBadge>>();

	for (const [setID, versions] of primary) {
		merged.set(setID, new Map(versions));
	}

	for (const [setID, versions] of secondary) {
		let target = merged.get(setID);
		if (!target) {
			target = new Map<string, Twitch.ChatBadge>();
			merged.set(setID, target);
		}

		for (const [version, badge] of versions) {
			if (!target.has(version)) {
				target.set(version, badge);
			}
		}
	}

	return merged;
}

function mergeDisplayBadgesIntoBadgeSets(
	current: Twitch.BadgeSets | null | undefined,
	displayBadges: Twitch.ChatBadge[],
): Twitch.BadgeSets {
	const globalsBySet = cloneBadgeMap(current?.globalsBySet);
	const channelsBySet = cloneBadgeMap(current?.channelsBySet);

	for (const badge of displayBadges) {
		let versions = channelsBySet.get(badge.setID);
		if (!versions) {
			versions = new Map<string, Twitch.ChatBadge>();
			channelsBySet.set(badge.setID, versions);
		}

		versions.set(badge.version, badge);
	}

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function cloneBadgeMap(
	source: Map<string, Map<string, Twitch.ChatBadge>> | null | undefined,
): Map<string, Map<string, Twitch.ChatBadge>> {
	const cloned = new Map<string, Map<string, Twitch.ChatBadge>>();
	if (!source) return cloned;

	for (const [setID, versions] of source) {
		cloned.set(setID, new Map(versions));
	}

	return cloned;
}

function mapBadgeSetsFromApollo(globalBadges: Twitch.ChatBadge[], channelBadges: Twitch.ChatBadge[]): Twitch.BadgeSets {
	const globalsBySet = toBadgeMap(globalBadges);
	const channelsBySet = toBadgeMap(channelBadges);

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function toBadgeMap(badges: Twitch.ChatBadge[]): Map<string, Map<string, Twitch.ChatBadge>> {
	const mapped = new Map<string, Map<string, Twitch.ChatBadge>>();

	for (const badge of badges) {
		let versions = mapped.get(badge.setID);
		if (!versions) {
			versions = new Map();
			mapped.set(badge.setID, versions);
		}

		versions.set(badge.version, badge);
	}

	return mapped;
}

function resolveActorRoleBadge(
	actorRoles: Set<ChannelRole>,
	badgeSets: Twitch.BadgeSets | null | undefined,
): Twitch.ChatBadge | null {
	if (!badgeSets) return null;

	for (const role of CHANNEL_ROLE_BADGE_PRIORITY) {
		if (!actorRoles.has(role)) continue;

		const setID = CHANNEL_ROLE_BADGE_SET_BY_ROLE[role];
		if (!setID) continue;

		const versions = badgeSets.channelsBySet.get(setID) ?? badgeSets.globalsBySet.get(setID);
		if (!versions?.size) continue;

		return versions.get("1") ?? versions.values().next().value ?? null;
	}

	return null;
}
