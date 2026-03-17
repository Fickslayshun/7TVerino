import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { ChatMessage } from "@/common/chat/ChatMessage";
import type { ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useApollo } from "@/composable/useApollo";
import { MessageType } from "@/site/twitch.tv";
import { redeemTwitchCustomReward } from "./twitchRedeemCustomReward";
import PointsRewardMessage from "@/app/chat/msg/43.PointsReward.vue";
import type { DocumentNode } from "graphql";

interface UnknownRecord {
	[key: string]: unknown;
}

interface QueryInfoLike {
	document?: DocumentNode | null;
	observableQuery?: {
		query?: DocumentNode | null;
		options?: {
			query?: DocumentNode | null;
		} | null;
	} | null;
}

interface ApolloQueryManagerLike {
	queries?: Map<string, QueryInfoLike>;
}

type ApolloQueryClient = NonNullable<ReturnType<typeof useApollo>["value"]>;
type ApolloClientWithQueryManager = ApolloQueryClient & {
	queryManager?: ApolloQueryManagerLike;
};

export interface TVerinoChannelPointsReward {
	id: string;
	title: string;
	prompt: string;
	cost: number;
	backgroundColor: string;
	kind: string;
	cooldownExpiresAt: string;
	globalCooldownSeconds: number;
	isEnabled: boolean;
	isInStock: boolean;
	isPaused: boolean;
}

export interface TVerinoChannelPointsIcon {
	image1x: string;
	image2x: string;
	image4x: string;
	backgroundColor: string;
}

const POINTS_CONTEXT_GOAL_TYPES = ["CREATOR", "BOOST"] as const;
const numberFormatter = new Intl.NumberFormat(undefined);
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 1,
});
const operationDocumentCache = new WeakMap<ApolloQueryClient, Map<string, DocumentNode>>();
const CHANNEL_POINTS_CACHE_STALE_MS = 2 * 60 * 1000;
const CHANNEL_POINTS_CACHE_LIMIT = 32;
const channelPointsStateCache = new Map<string, CachedChannelPointsState>();

interface CachedChannelPointsState {
	fetchedAt: number;
	accessedAt: number;
	supported: boolean;
	balance: number | null;
	name: string;
	rewards: TVerinoChannelPointsReward[];
	icon: TVerinoChannelPointsIcon | null;
}

export function useTVerinoChannelPoints(ctx: ChannelContext) {
	const apollo = useApollo();
	const messages = useChatMessages(ctx);
	const { identity } = storeToRefs(useStore());

	const channelPointsLoading = ref(false);
	const channelPointsNotice = ref("");
	const channelPointsNoticeIsError = ref(false);
	const channelPointsSupported = ref(false);
	const channelPointsBalance = ref<number | null>(null);
	const channelPointsName = ref("Channel Points");
	const channelPointsRewards = ref<TVerinoChannelPointsReward[]>([]);
	const channelPointsIcon = ref<TVerinoChannelPointsIcon | null>(null);
	const redeemingRewardID = ref("");
	const redeemedRewardID = ref("");
	let refreshToken = 0;

	const channelPointsVisible = computed(
		() => channelPointsLoading.value || channelPointsSupported.value || channelPointsNoticeIsError.value,
	);
	const channelPointsBalanceCompact = computed(() =>
		channelPointsBalance.value === null ? "..." : compactNumberFormatter.format(channelPointsBalance.value),
	);
	const channelPointsBalanceDisplay = computed(() =>
		channelPointsBalance.value === null ? "Unavailable" : numberFormatter.format(channelPointsBalance.value),
	);
	const channelPointsButtonTitle = computed(() => {
		if (channelPointsBalance.value === null) return `Open ${channelPointsName.value}`;
		return `${channelPointsName.value}: ${numberFormatter.format(channelPointsBalance.value)}`;
	});
	const redeemableRewardIDs = computed(() =>
		channelPointsRewards.value.filter((reward) => isRedeemableCustomReward(reward)).map((reward) => reward.id),
	);

	watch(
		() => [apollo.value, ctx.id, ctx.username, identity.value?.id ?? identity.value?.username ?? ""] as const,
		() => {
			const cacheKey = getChannelPointsCacheKey(ctx, identity.value?.id ?? identity.value?.username ?? "");
			if (!cacheKey) {
				resetChannelPointsState();
				return;
			}

			const cachedState = readCachedChannelPointsState(cacheKey);
			if (cachedState) {
				applyCachedChannelPointsState(cachedState);
				if (!isCachedChannelPointsStateStale(cachedState)) return;
				void refreshChannelPointsState({ background: true });
				return;
			}

			void refreshChannelPointsState();
		},
		{ immediate: true },
	);

	async function refreshChannelPointsState(options: { background?: boolean } = {}): Promise<void> {
		const token = ++refreshToken;
		const client = apollo.value;
		const channelLogin = ctx.username?.trim().toLowerCase();
		const cacheKey = getChannelPointsCacheKey(ctx, identity.value?.id ?? identity.value?.username ?? "");
		const background = !!options.background;
		if (!client || !channelLogin || !cacheKey) {
			resetChannelPointsState();
			return;
		}

		if (!background) {
			channelPointsLoading.value = true;
			channelPointsNotice.value = "";
			channelPointsNoticeIsError.value = false;
		}

		try {
			const document = findLiveOperationDocument(client, "ChannelPointsContext");
			if (!document) {
				throw new Error("Twitch channel points query unavailable on this page");
			}

			const response = await client.query<
				Record<string, unknown>,
				{ channelLogin: string; includeGoalTypes: string[] }
			>({
				query: document,
				variables: {
					channelLogin,
					includeGoalTypes: [...POINTS_CONTEXT_GOAL_TYPES],
				},
				fetchPolicy: "network-only",
			});

			const data = response.data;
			const balance = extractChannelPointsBalance(data);
			const rewards = extractChannelPointRewards(data);
			const pointName = extractChannelPointsName(data);
			const pointIcon = extractChannelPointsIcon(data);

			if (token !== refreshToken) return;

			channelPointsBalance.value = balance;
			channelPointsRewards.value = rewards;
			channelPointsName.value = pointName || "Channel Points";
			channelPointsIcon.value = pointIcon;
			channelPointsSupported.value = balance !== null || rewards.length > 0 || !!pointName || !!pointIcon;
			writeCachedChannelPointsState(cacheKey, {
				fetchedAt: Date.now(),
				accessedAt: Date.now(),
				supported: channelPointsSupported.value,
				balance: channelPointsBalance.value,
				name: channelPointsName.value,
				rewards: channelPointsRewards.value.map((reward) => ({ ...reward })),
				icon: channelPointsIcon.value ? { ...channelPointsIcon.value } : null,
			});
		} catch (error) {
			if (token !== refreshToken) return;
			if (!background) {
				resetChannelPointsState();
				channelPointsNotice.value = toErrorMessage(error, "Unable to load channel points.");
				channelPointsNoticeIsError.value = true;
			}
		} finally {
			if (token === refreshToken && !background) {
				channelPointsLoading.value = false;
			}
		}
	}

	function resetChannelPointsState(): void {
		channelPointsSupported.value = false;
		channelPointsBalance.value = null;
		channelPointsName.value = "Channel Points";
		channelPointsRewards.value = [];
		channelPointsIcon.value = null;
		redeemingRewardID.value = "";
		redeemedRewardID.value = "";
		channelPointsNotice.value = "";
		channelPointsNoticeIsError.value = false;
		channelPointsLoading.value = false;
	}

	async function redeemReward(reward: TVerinoChannelPointsReward): Promise<void> {
		const channelID = ctx.id?.trim();
		if (!channelID) {
			channelPointsNotice.value = "Channel unavailable.";
			channelPointsNoticeIsError.value = true;
			return;
		}

		if (!isRedeemableCustomReward(reward)) {
			channelPointsNotice.value =
				"Only custom reward redemption is wired right now. Native automatic rewards still need Twitch's separate flow.";
			channelPointsNoticeIsError.value = true;
			return;
		}

		if (redeemingRewardID.value) return;

		redeemingRewardID.value = reward.id;
		redeemedRewardID.value = "";
		channelPointsNotice.value = "";
		channelPointsNoticeIsError.value = false;

		try {
			await redeemTwitchCustomReward(
				{
					channelID,
					rewardID: reward.id,
					cost: reward.cost,
					title: reward.title,
				},
				apollo.value,
			);

			if (channelPointsBalance.value !== null) {
				channelPointsBalance.value = Math.max(0, channelPointsBalance.value - reward.cost);
			}

			const localCooldownExpiresAt = createLocalRewardCooldownExpiry(reward);
			if (localCooldownExpiresAt) {
				channelPointsRewards.value = channelPointsRewards.value.map((entry) =>
					entry.id === reward.id
						? {
								...entry,
								cooldownExpiresAt: localCooldownExpiresAt,
						  }
						: entry,
				);
			}

			redeemedRewardID.value = reward.id;
			channelPointsNotice.value = `Redeemed ${reward.title}.`;
			channelPointsNoticeIsError.value = false;
			persistCurrentChannelPointsState();
			emitLocalRewardRedemptionMessage(reward);
			void refreshChannelPointsState({ background: true });
		} catch (error) {
			channelPointsNotice.value = toErrorMessage(error, `Unable to redeem ${reward.title}.`);
			channelPointsNoticeIsError.value = true;
		} finally {
			redeemingRewardID.value = "";
		}
	}

	function clearRedeemedReward(): void {
		redeemedRewardID.value = "";
	}

	function persistCurrentChannelPointsState(): void {
		const cacheKey = getChannelPointsCacheKey(ctx, identity.value?.id ?? identity.value?.username ?? "");
		if (!cacheKey) return;

		writeCachedChannelPointsState(cacheKey, {
			fetchedAt: Date.now(),
			accessedAt: Date.now(),
			supported: channelPointsSupported.value,
			balance: channelPointsBalance.value,
			name: channelPointsName.value,
			rewards: channelPointsRewards.value.map((reward) => ({ ...reward })),
			icon: channelPointsIcon.value ? { ...channelPointsIcon.value } : null,
		});
	}

	function applyCachedChannelPointsState(state: CachedChannelPointsState): void {
		channelPointsSupported.value = state.supported;
		channelPointsBalance.value = state.balance;
		channelPointsName.value = state.name;
		channelPointsRewards.value = state.rewards.map((reward) => ({ ...reward }));
		channelPointsIcon.value = state.icon ? { ...state.icon } : null;
		channelPointsNotice.value = "";
		channelPointsNoticeIsError.value = false;
		channelPointsLoading.value = false;
	}

	function emitLocalRewardRedemptionMessage(reward: TVerinoChannelPointsReward): void {
		const currentIdentity = identity.value;
		const actorLogin = currentIdentity?.username ?? "";
		const actorDisplayName =
			currentIdentity && "displayName" in currentIdentity && currentIdentity.displayName
				? currentIdentity.displayName
				: actorLogin || "You";
		const messageID = `tverino-reward:${ctx.id}:${reward.id}:${Date.now()}`;
		const msgData = {
			id: messageID,
			type: MessageType.CHANNEL_POINTS_REWARD,
			channelID: ctx.id,
			displayName: actorDisplayName,
			login: actorLogin,
			userID: currentIdentity?.id ?? "",
			message: null,
			reward: {
				cost: reward.cost,
				isHighlighted: false,
				name: reward.title,
			},
			isHistorical: false,
		} as unknown as Twitch.ChannelPointsRewardMessage;
		const message = new ChatMessage(messageID).setComponent(PointsRewardMessage, { msgData });
		message.channelID = ctx.id;
		message.setTimestamp(Date.now());
		messages.add(message, true);
	}

	return {
		channelPointsBalance,
		channelPointsBalanceCompact,
		channelPointsBalanceDisplay,
		channelPointsButtonTitle,
		channelPointsIcon,
		channelPointsLoading,
		channelPointsName,
		channelPointsNotice,
		channelPointsNoticeIsError,
		channelPointsRewards,
		clearRedeemedReward,
		redeemReward,
		redeemableRewardIDs,
		redeemedRewardID,
		redeemingRewardID,
		channelPointsSupported,
		channelPointsVisible,
		refreshChannelPointsState,
	};
}

function getChannelPointsCacheKey(ctx: ChannelContext, viewerKey: string): string {
	const channelKey = ctx.id?.trim() || ctx.username?.trim().toLowerCase() || "";
	if (!channelKey) return "";
	return `${viewerKey || "anonymous"}:${channelKey}`;
}

function readCachedChannelPointsState(cacheKey: string): CachedChannelPointsState | null {
	const cached = channelPointsStateCache.get(cacheKey);
	if (!cached) return null;

	cached.accessedAt = Date.now();
	return cached;
}

function writeCachedChannelPointsState(cacheKey: string, state: CachedChannelPointsState): void {
	channelPointsStateCache.set(cacheKey, state);

	if (channelPointsStateCache.size <= CHANNEL_POINTS_CACHE_LIMIT) return;

	let oldestKey = "";
	let oldestAccess = Number.POSITIVE_INFINITY;
	for (const [key, value] of channelPointsStateCache) {
		if (value.accessedAt >= oldestAccess) continue;
		oldestAccess = value.accessedAt;
		oldestKey = key;
	}

	if (oldestKey) {
		channelPointsStateCache.delete(oldestKey);
	}
}

function isCachedChannelPointsStateStale(state: CachedChannelPointsState): boolean {
	return Date.now() - state.fetchedAt > CHANNEL_POINTS_CACHE_STALE_MS;
}

function findLiveOperationDocument(client: ApolloQueryClient, operationName: string): DocumentNode | null {
	let cache = operationDocumentCache.get(client);
	if (!cache) {
		cache = new Map<string, DocumentNode>();
		operationDocumentCache.set(client, cache);
	}

	const cachedDocument = cache.get(operationName);
	if (cachedDocument) return cachedDocument;

	const queries = (client as ApolloClientWithQueryManager).queryManager?.queries;
	if (!queries) return null;

	for (const queryInfo of queries.values()) {
		const document =
			queryInfo.document ?? queryInfo.observableQuery?.query ?? queryInfo.observableQuery?.options?.query;
		if (!document) continue;

		if (getOperationNames(document).includes(operationName)) {
			cache.set(operationName, document);
			return document;
		}
	}

	return null;
}

function getOperationNames(document: DocumentNode): string[] {
	const names = [] as string[];

	for (const definition of document.definitions) {
		if (!("name" in definition) || !definition.name?.value) continue;
		names.push(definition.name.value);
	}

	return names;
}

function extractChannelPointsBalance(data: unknown): number | null {
	const balanceCandidate = findFirstObject(
		data,
		(value) => readNumber(value, "balance") !== null && readNumber(value, "bitsBalance") === null,
	);
	return balanceCandidate ? readNumber(balanceCandidate, "balance") : null;
}

function extractChannelPointsName(data: unknown): string {
	const directPointName = findFirstPropertyValue(data, "pointName");
	if (typeof directPointName === "string" && directPointName.trim()) return directPointName.trim();

	const pointCustomization = findFirstPropertyValue(data, "pointCustomization");
	if (isRecord(pointCustomization)) {
		const customizationName = findFirstObject(
			pointCustomization,
			(value) =>
				typeof value.name === "string" &&
				!!(readString(value, "image1x") || readString(value, "image2x") || readString(value, "image4x")),
		);
		if (customizationName) {
			return readString(customizationName, "name");
		}
	}

	return "";
}

function extractChannelPointsIcon(data: unknown): TVerinoChannelPointsIcon | null {
	const pointCustomization = findFirstPropertyValue(data, "pointCustomization");
	const iconSource = pointCustomization ?? data;
	const iconCandidate = findFirstObject(iconSource, (value) => {
		if (readNumber(value, "cost") !== null) return false;
		return !!(readString(value, "image1x") || readString(value, "image2x") || readString(value, "image4x"));
	});

	if (!iconCandidate) return null;

	return {
		image1x: readString(iconCandidate, "image1x"),
		image2x: readString(iconCandidate, "image2x") || readString(iconCandidate, "image1x"),
		image4x:
			readString(iconCandidate, "image4x") ||
			readString(iconCandidate, "image2x") ||
			readString(iconCandidate, "image1x"),
		backgroundColor:
			readString(iconCandidate, "backgroundColor") ||
			readString(iconCandidate, "backgroundColorHex") ||
			readString(iconCandidate, "color"),
	};
}

function extractChannelPointRewards(data: unknown): TVerinoChannelPointsReward[] {
	const rewardCandidates = [] as UnknownRecord[];
	for (const key of ["rewards", "automaticRewards", "customRewards"]) {
		for (const value of collectPropertyValues(data, key)) {
			if (!Array.isArray(value)) continue;
			for (const item of value) {
				if (isRecord(item)) rewardCandidates.push(item);
			}
		}
	}

	if (!rewardCandidates.length) {
		for (const value of collectMatchingObjects(
			data,
			(entry) => readNumber(entry, "cost") !== null && !!getRewardTitle(entry),
		)) {
			rewardCandidates.push(value);
		}
	}

	const rewardsByID = new Map<string, TVerinoChannelPointsReward>();
	for (const reward of rewardCandidates) {
		const normalized = normalizeReward(reward);
		if (!normalized) continue;
		rewardsByID.set(normalized.id, normalized);
	}

	return [...rewardsByID.values()].sort(
		(left, right) => left.cost - right.cost || left.title.localeCompare(right.title),
	);
}

function normalizeReward(value: UnknownRecord): TVerinoChannelPointsReward | null {
	const cost = readNumber(value, "cost");
	const title = getRewardTitle(value);
	if (cost === null || !title) return null;

	const prompt = readString(value, "prompt") || readString(value, "subtitle");
	const id =
		readString(value, "id") ||
		`${readString(value, "__typename") || "Reward"}:${title}:${cost}:${readString(value, "backgroundColor") || ""}`;

	return {
		id,
		title,
		prompt,
		cost,
		backgroundColor:
			readString(value, "backgroundColor") ||
			readString(value, "defaultBackgroundColor") ||
			readString(value, "themeColor"),
		kind: readString(value, "__typename") || "Reward",
		cooldownExpiresAt: readRewardCooldownExpiresAt(value),
		globalCooldownSeconds: readRewardGlobalCooldownSeconds(value),
		isEnabled: readBoolean(value, "isEnabled", true),
		isInStock: readBoolean(value, "isInStock", true),
		isPaused: readBoolean(value, "isPaused", false),
	};
}

function isRedeemableCustomReward(reward: Pick<TVerinoChannelPointsReward, "kind" | "id">): boolean {
	if (reward.kind.toLowerCase().includes("customreward")) return true;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reward.id);
}

function getRewardTitle(value: UnknownRecord): string {
	return readString(value, "title") || readString(value, "prompt") || readString(value, "name");
}

function readRewardCooldownExpiresAt(value: UnknownRecord): string {
	const cooldownExpiresAt = readString(value, "cooldownExpiresAt");
	return cooldownExpiresAt && !Number.isNaN(Date.parse(cooldownExpiresAt)) ? cooldownExpiresAt : "";
}

function readRewardGlobalCooldownSeconds(value: UnknownRecord): number {
	const globalCooldownSetting = value.globalCooldownSetting;
	if (!isRecord(globalCooldownSetting) || !readBoolean(globalCooldownSetting, "isEnabled", false)) {
		return 0;
	}

	return readNumber(globalCooldownSetting, "globalCooldownSeconds") ?? 0;
}

function createLocalRewardCooldownExpiry(reward: Pick<TVerinoChannelPointsReward, "globalCooldownSeconds">): string {
	if (reward.globalCooldownSeconds <= 0) return "";
	return new Date(Date.now() + reward.globalCooldownSeconds * 1000).toISOString();
}

function collectMatchingObjects(data: unknown, predicate: (value: UnknownRecord) => boolean): UnknownRecord[] {
	const results = [] as UnknownRecord[];
	walkUnknown(data, (value) => {
		if (predicate(value)) results.push(value);
	});
	return results;
}

function collectPropertyValues(data: unknown, key: string): unknown[] {
	const results = [] as unknown[];
	walkUnknown(data, (value) => {
		if (key in value) results.push(value[key]);
	});
	return results;
}

function findFirstPropertyValue(data: unknown, key: string): unknown {
	let found: unknown = undefined;
	walkUnknown(data, (value) => {
		if (found !== undefined || !(key in value)) return;
		found = value[key];
	});
	return found;
}

function findFirstObject(data: unknown, predicate: (value: UnknownRecord) => boolean): UnknownRecord | null {
	let found: UnknownRecord | null = null;
	walkUnknown(data, (value) => {
		if (found || !predicate(value)) return;
		found = value;
	});
	return found;
}

function walkUnknown(data: unknown, visit: (value: UnknownRecord) => void, visited = new WeakSet<object>()): void {
	if (!data || typeof data !== "object") return;

	const target = data as object;
	if (visited.has(target)) return;
	visited.add(target);

	if (Array.isArray(data)) {
		for (const item of data) {
			walkUnknown(item, visit, visited);
		}
		return;
	}

	const record = data as UnknownRecord;
	visit(record);

	for (const value of Object.values(record)) {
		walkUnknown(value, visit, visited);
	}
}

function isRecord(value: unknown): value is UnknownRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: UnknownRecord, key: string): string {
	const field = value[key];
	return typeof field === "string" ? field : "";
}

function readNumber(value: UnknownRecord, key: string): number | null {
	const field = value[key];
	return typeof field === "number" ? field : null;
}

function readBoolean(value: UnknownRecord, key: string, fallback: boolean): boolean {
	const field = value[key];
	return typeof field === "boolean" ? field : fallback;
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}
