import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import type { ChannelContext } from "@/composable/channel/useChannelContext";
import { useApollo } from "@/composable/useApollo";
import { redeemTwitchCustomReward } from "./twitchRedeemCustomReward";
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
	requiresUserInput: boolean;
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
const REWARD_USER_INPUT_KEYS = [
	"isUserInputRequired",
	"is_user_input_required",
	"requiresUserInput",
	"userInputRequired",
] as const;

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
		channelPointsNotice.value = "";
		channelPointsNoticeIsError.value = false;
		channelPointsLoading.value = false;
	}

	async function redeemReward(reward: TVerinoChannelPointsReward, textInput?: string): Promise<boolean> {
		const channelID = ctx.id?.trim();
		if (!channelID) {
			channelPointsNotice.value = "Channel unavailable.";
			channelPointsNoticeIsError.value = true;
			return false;
		}

		if (!identity.value?.id || !identity.value?.username) {
			channelPointsNotice.value = "Log in to Twitch to redeem channel point rewards.";
			channelPointsNoticeIsError.value = true;
			return false;
		}

		if (!isRedeemableCustomReward(reward)) {
			channelPointsNotice.value =
				"Only custom reward redemption is wired right now. Native automatic rewards still need Twitch's separate flow.";
			channelPointsNoticeIsError.value = true;
			return false;
		}

		const normalizedTextInput = typeof textInput === "string" ? textInput.trim() : "";
		if (reward.requiresUserInput && !normalizedTextInput) {
			channelPointsNotice.value = `Enter a response for ${reward.title} before redeeming.`;
			channelPointsNoticeIsError.value = true;
			return false;
		}

		if (redeemingRewardID.value) return false;

		redeemingRewardID.value = reward.id;
		channelPointsNotice.value = "";
		channelPointsNoticeIsError.value = false;

		try {
			await redeemTwitchCustomReward(
				{
					channelID,
					rewardID: reward.id,
					cost: reward.cost,
					title: reward.title,
					prompt: reward.prompt || null,
					textInput: normalizedTextInput || null,
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

			channelPointsNotice.value = `Redeemed ${reward.title}.`;
			channelPointsNoticeIsError.value = false;
			persistCurrentChannelPointsState();
			void refreshChannelPointsState({ background: true });
			return true;
		} catch (error) {
			channelPointsNotice.value = toRewardRedemptionErrorMessage(error, `Unable to redeem ${reward.title}.`);
			channelPointsNoticeIsError.value = true;
			return false;
		} finally {
			redeemingRewardID.value = "";
		}
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
		redeemReward,
		redeemableRewardIDs,
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
		const previous = rewardsByID.get(normalized.id);
		rewardsByID.set(normalized.id, previous ? mergeReward(previous, normalized) : normalized);
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
		requiresUserInput: readRewardRequiresUserInput(value),
		cooldownExpiresAt: readRewardCooldownExpiresAt(value),
		globalCooldownSeconds: readRewardGlobalCooldownSeconds(value),
		isEnabled: readBoolean(value, "isEnabled", true),
		isInStock: readBoolean(value, "isInStock", true),
		isPaused: readBoolean(value, "isPaused", false),
	};
}

function mergeReward(
	existing: TVerinoChannelPointsReward,
	incoming: TVerinoChannelPointsReward,
): TVerinoChannelPointsReward {
	return {
		...existing,
		...incoming,
		prompt: incoming.prompt || existing.prompt,
		backgroundColor: incoming.backgroundColor || existing.backgroundColor,
		kind: incoming.kind || existing.kind,
		requiresUserInput: existing.requiresUserInput || incoming.requiresUserInput,
		cooldownExpiresAt: incoming.cooldownExpiresAt || existing.cooldownExpiresAt,
		globalCooldownSeconds: incoming.globalCooldownSeconds || existing.globalCooldownSeconds,
		isEnabled: existing.isEnabled && incoming.isEnabled,
		isInStock: existing.isInStock && incoming.isInStock,
		isPaused: existing.isPaused || incoming.isPaused,
	};
}

function isRedeemableCustomReward(reward: Pick<TVerinoChannelPointsReward, "kind" | "id">): boolean {
	if (reward.kind.toLowerCase().includes("customreward")) return true;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reward.id);
}

function getRewardTitle(value: UnknownRecord): string {
	return readString(value, "title") || readString(value, "prompt") || readString(value, "name");
}

function readRewardRequiresUserInput(value: UnknownRecord): boolean {
	const direct = readBooleanishField(value, REWARD_USER_INPUT_KEYS);
	if (direct !== null) return direct;

	return findFirstBooleanPropertyValue(value, REWARD_USER_INPUT_KEYS) ?? false;
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

function findFirstBooleanPropertyValue(data: unknown, keys: readonly string[]): boolean | null {
	let found: boolean | null = null;
	walkUnknown(data, (value) => {
		if (found !== null) return;
		found = readBooleanishField(value, keys);
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

function readBooleanishField(value: UnknownRecord, keys: readonly string[]): boolean | null {
	for (const key of keys) {
		const normalized = normalizeBooleanishValue(value[key]);
		if (normalized !== null) return normalized;
	}

	return null;
}

function normalizeBooleanishValue(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "1") return true;
	if (value === 0 || value === "0") return false;
	if (typeof value !== "string") return null;

	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return null;
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}

function toRewardRedemptionErrorMessage(error: unknown, fallback: string): string {
	const message = toErrorMessage(error, fallback);
	if (/unauthenticated|auth unavailable|oauth/i.test(message)) {
		return "Log in to Twitch to redeem channel point rewards.";
	}

	return message;
}
