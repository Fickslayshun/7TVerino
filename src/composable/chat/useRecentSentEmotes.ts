import { computed, ref, watch } from "vue";
import { useConfig, waitForSettingsBootstrap } from "@/composable/useSettings";

export const RECENT_EMOTE_BAR_LIMIT = 6;
const RECENT_EMOTE_BAR_HISTORY_LIMIT = 24;
const RECENT_EMOTE_BAR_MOST_USED_MIN_COUNT = 3;
// The bar only renders a few entries, so keep the backing store bounded to avoid
// unbounded in-memory maps and large localStorage rewrites over time.
const RECENT_EMOTE_BAR_CHANNEL_LIMIT = 64;
const RECENT_EMOTE_BAR_USAGE_ENTRY_LIMIT = 96;

export type RecentEmoteBarScope = "7tv" | "all";
export type RecentEmoteBarMode = "none" | "recent" | "most_used" | "combine";
export type RecentSentEmoteProvider = "7TV" | "PLATFORM" | "BTTV" | "FFZ";

export interface RecentSentEmoteEntry {
	id: string;
	name: string;
	provider: RecentSentEmoteProvider;
}

export interface RecentSentEmoteUsageEntry extends RecentSentEmoteEntry {
	count: number;
}

interface RecentSentEmoteHistorySnapshotChannel {
	channelID: string;
	updatedAt?: number;
	entries: RecentSentEmoteEntry[];
}

interface RecentSentEmoteHistorySnapshot {
	version: 1;
	channels: RecentSentEmoteHistorySnapshotChannel[];
}

interface RecentSentEmoteHistoryState {
	history: Map<string, RecentSentEmoteEntry[]>;
	timestamps: Map<string, number>;
}

interface RecentSentEmoteUsageSnapshotChannel {
	channelID: string;
	updatedAt?: number;
	entries: RecentSentEmoteUsageEntry[];
}

interface RecentSentEmoteUsageSnapshot {
	version: 1;
	channels: RecentSentEmoteUsageSnapshotChannel[];
}

interface RecentSentEmoteUsageState {
	history: Map<string, RecentSentEmoteUsageEntry[]>;
	timestamps: Map<string, number>;
}

export interface RecentSentEmoteChannelMeta {
	username?: string;
	displayName?: string;
}

interface RecentSentEmoteChannelMetaSnapshotChannel extends RecentSentEmoteChannelMeta {
	channelID: string;
}

interface RecentSentEmoteChannelMetaSnapshot {
	version: 1;
	channels: RecentSentEmoteChannelMetaSnapshotChannel[];
}

const rawMode = useConfig<RecentEmoteBarMode | string>("chat.recent_emote_bar.mode", "recent");
const scope = useConfig<RecentEmoteBarScope>("chat.recent_emote_bar.scope", "7tv");
const persistedMirrorVersion = useConfig<number>("chat.recent_emote_bar.export_version", 0);
const persistedHistory = useConfig<Map<string, RecentSentEmoteEntry[]>>("chat.recent_emote_bar.history", new Map());
const persistedUsage = useConfig<Map<string, RecentSentEmoteUsageEntry[]>>("chat.recent_emote_bar.usage", new Map());
const persistedChannelMeta = useConfig<Map<string, RecentSentEmoteChannelMeta>>(
	"chat.recent_emote_bar.channel_meta",
	new Map(),
);
const history = ref<Map<string, RecentSentEmoteEntry[]>>(new Map());
const historyTimestamps = ref<Map<string, number>>(new Map());
const usageHistory = ref<Map<string, RecentSentEmoteUsageEntry[]>>(new Map());
const usageHistoryTimestamps = ref<Map<string, number>>(new Map());
const channelMeta = ref<Map<string, RecentSentEmoteChannelMeta>>(new Map());
const RECENT_EMOTE_HISTORY_SESSION_KEY = "seventv:recent-emote-bar:history";
const RECENT_EMOTE_HISTORY_STORAGE_KEY = "seventv:recent-emote-bar:history:persistent";
const RECENT_EMOTE_USAGE_STORAGE_KEY = "seventv:recent-emote-bar:usage:persistent";
const RECENT_EMOTE_CHANNEL_META_STORAGE_KEY = "seventv:recent-emote-bar:channels:persistent";

const SUPPORTED_PROVIDERS = new Set<RecentSentEmoteProvider>(["7TV", "PLATFORM", "BTTV", "FFZ"]);
const TOKEN_EDGE_PUNCTUATION = /^[`~!@#$%^&*()\-+=\[\]{}\\|;:'",.<>/?]+|[`~!@#$%^&*()\-+=\[\]{}\\|;:'",.<>/?]+$/g;

let initialized = false;
let storageListenerBound = false;
let persistentStateWatcherBound = false;
let settingsBootstrapResolved = false;

function emptyHistoryState(): RecentSentEmoteHistoryState {
	return {
		history: new Map<string, RecentSentEmoteEntry[]>(),
		timestamps: new Map<string, number>(),
	};
}

function emptyUsageState(): RecentSentEmoteUsageState {
	return {
		history: new Map<string, RecentSentEmoteUsageEntry[]>(),
		timestamps: new Map<string, number>(),
	};
}

function normalizeRecentEmoteBarMode(value: unknown): RecentEmoteBarMode {
	switch (value) {
		case "none":
		case "most_used":
		case "combine":
		case "recent":
			return value;
		default:
			return "recent";
	}
}

function isRecentSentEmoteProvider(provider: string): provider is RecentSentEmoteProvider {
	return SUPPORTED_PROVIDERS.has(provider as RecentSentEmoteProvider);
}

function normalizeEntry(entry: Partial<RecentSentEmoteEntry> | null | undefined): RecentSentEmoteEntry | null {
	if (!entry) return null;

	const id = entry.id?.trim();
	const name = entry.name?.trim();
	const provider = entry.provider?.trim();
	if (!id || !name || !provider || !isRecentSentEmoteProvider(provider)) return null;

	return {
		id,
		name,
		provider,
	};
}

function normalizeEntries(entries: RecentSentEmoteEntry[] | null | undefined): RecentSentEmoteEntry[] {
	const out = [] as RecentSentEmoteEntry[];
	const seen = new Set<string>();

	for (const entry of entries ?? []) {
		const normalized = normalizeEntry(entry);
		if (!normalized) continue;

		const key = `${normalized.provider}:${normalized.id}`;
		if (seen.has(key)) continue;

		seen.add(key);
		out.push(normalized);
		if (out.length >= RECENT_EMOTE_BAR_HISTORY_LIMIT) break;
	}

	return out;
}

function sortChannelIDsByFreshness(channelIDs: Iterable<string>, timestamps: Map<string, number>): string[] {
	return Array.from(channelIDs).sort(
		(a, b) => (timestamps.get(b) ?? 0) - (timestamps.get(a) ?? 0) || a.localeCompare(b),
	);
}

function pruneHistoryChannels(state: RecentSentEmoteHistoryState): RecentSentEmoteHistoryState {
	if (state.history.size <= RECENT_EMOTE_BAR_CHANNEL_LIMIT) return state;

	const keepChannelIDs = new Set(
		sortChannelIDsByFreshness(state.history.keys(), state.timestamps).slice(0, RECENT_EMOTE_BAR_CHANNEL_LIMIT),
	);
	const nextState = emptyHistoryState();

	for (const channelID of keepChannelIDs) {
		const entries = state.history.get(channelID);
		if (!entries?.length) continue;

		nextState.history.set(channelID, entries);
		nextState.timestamps.set(channelID, state.timestamps.get(channelID) ?? 0);
	}

	return nextState;
}

function pruneUsageChannels(state: RecentSentEmoteUsageState): RecentSentEmoteUsageState {
	if (state.history.size <= RECENT_EMOTE_BAR_CHANNEL_LIMIT) return state;

	const keepChannelIDs = new Set(
		sortChannelIDsByFreshness(state.history.keys(), state.timestamps).slice(0, RECENT_EMOTE_BAR_CHANNEL_LIMIT),
	);
	const nextState = emptyUsageState();

	for (const channelID of keepChannelIDs) {
		const entries = state.history.get(channelID);
		if (!entries?.length) continue;

		nextState.history.set(channelID, entries);
		nextState.timestamps.set(channelID, state.timestamps.get(channelID) ?? 0);
	}

	return nextState;
}

function normalizeUsageEntry(
	entry: Partial<RecentSentEmoteUsageEntry> | null | undefined,
): RecentSentEmoteUsageEntry | null {
	const normalized = normalizeEntry(entry);
	const count = Math.max(0, Math.floor(Number(entry?.count ?? 0)));
	if (!normalized || !count) return null;

	return {
		...normalized,
		count,
	};
}

function sortUsageEntries(a: RecentSentEmoteUsageEntry, b: RecentSentEmoteUsageEntry): number {
	return (
		b.count - a.count ||
		a.name.localeCompare(b.name) ||
		a.provider.localeCompare(b.provider) ||
		a.id.localeCompare(b.id)
	);
}

function normalizeUsageEntries(entries: RecentSentEmoteUsageEntry[] | null | undefined): RecentSentEmoteUsageEntry[] {
	const deduped = new Map<string, RecentSentEmoteUsageEntry>();

	for (const entry of entries ?? []) {
		const normalized = normalizeUsageEntry(entry);
		if (!normalized) continue;

		const key = `${normalized.provider}:${normalized.id}`;
		const existing = deduped.get(key);
		if (existing) {
			existing.count = Math.max(existing.count, normalized.count);
			existing.name = normalized.name;
			continue;
		}

		deduped.set(key, { ...normalized });
	}

	return Array.from(deduped.values()).sort(sortUsageEntries).slice(0, RECENT_EMOTE_BAR_USAGE_ENTRY_LIMIT);
}

function normalizeHistoryState(
	value: Iterable<[string, RecentSentEmoteEntry[]]> | null | undefined,
	timestamps?: Iterable<[string, number]> | null | undefined,
): RecentSentEmoteHistoryState {
	const out = emptyHistoryState();
	const timestampMap = new Map<string, number>(timestamps ?? []);

	for (const [channelID, entries] of value ?? []) {
		if (typeof channelID !== "string" || !channelID) continue;

		const normalized = normalizeEntries(entries);
		if (!normalized.length) continue;

		out.history.set(channelID, normalized);
		out.timestamps.set(channelID, timestampMap.get(channelID) ?? 0);
	}

	return out;
}

function normalizeSnapshot(value: unknown): RecentSentEmoteHistoryState {
	if (value instanceof Array) {
		return normalizeHistoryState(value as Iterable<[string, RecentSentEmoteEntry[]]>);
	}

	if (!value || typeof value !== "object") {
		return emptyHistoryState();
	}

	const channels = (value as Partial<RecentSentEmoteHistorySnapshot>).channels;
	if (!(channels instanceof Array)) {
		return emptyHistoryState();
	}

	const out = emptyHistoryState();

	for (const channel of channels) {
		if (!channel || typeof channel !== "object") continue;

		const channelID = (channel as Partial<RecentSentEmoteHistorySnapshotChannel>).channelID;
		if (typeof channelID !== "string" || !channelID) continue;

		const normalizedEntries = normalizeEntries((channel as RecentSentEmoteHistorySnapshotChannel).entries);
		if (!normalizedEntries.length) continue;

		const updatedAt = (channel as Partial<RecentSentEmoteHistorySnapshotChannel>).updatedAt;
		out.history.set(channelID, normalizedEntries);
		out.timestamps.set(channelID, typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0);
	}

	return pruneHistoryChannels(out);
}

function normalizeUsageSnapshot(value: unknown): RecentSentEmoteUsageState {
	if (!value || typeof value !== "object") {
		return emptyUsageState();
	}

	const channels = (value as Partial<RecentSentEmoteUsageSnapshot>).channels;
	if (!(channels instanceof Array)) {
		return emptyUsageState();
	}

	const out = emptyUsageState();

	for (const channel of channels) {
		if (!channel || typeof channel !== "object") continue;

		const channelID = (channel as Partial<RecentSentEmoteUsageSnapshotChannel>).channelID;
		if (typeof channelID !== "string" || !channelID) continue;

		const normalizedEntries = normalizeUsageEntries((channel as RecentSentEmoteUsageSnapshotChannel).entries);
		if (!normalizedEntries.length) continue;

		const updatedAt = (channel as Partial<RecentSentEmoteUsageSnapshotChannel>).updatedAt;
		out.history.set(channelID, normalizedEntries);
		out.timestamps.set(channelID, typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0);
	}

	return pruneUsageChannels(out);
}

function buildSnapshot(state: RecentSentEmoteHistoryState): RecentSentEmoteHistorySnapshot {
	return {
		version: 1,
		channels: Array.from(state.history.entries()).map(([channelID, entries]) => ({
			channelID,
			updatedAt: state.timestamps.get(channelID) ?? 0,
			entries,
		})),
	};
}

function buildUsageSnapshot(state: RecentSentEmoteUsageState): RecentSentEmoteUsageSnapshot {
	return {
		version: 1,
		channels: Array.from(state.history.entries()).map(([channelID, entries]) => ({
			channelID,
			updatedAt: state.timestamps.get(channelID) ?? 0,
			entries,
		})),
	};
}

function areEntriesEqual(a: RecentSentEmoteEntry[] | undefined, b: RecentSentEmoteEntry[] | undefined): boolean {
	if (!a || !b || a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++) {
		if (a[i]?.id !== b[i]?.id || a[i]?.name !== b[i]?.name || a[i]?.provider !== b[i]?.provider) {
			return false;
		}
	}

	return true;
}

function areUsageEntriesEqual(
	a: RecentSentEmoteUsageEntry[] | undefined,
	b: RecentSentEmoteUsageEntry[] | undefined,
): boolean {
	if (!a || !b || a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++) {
		if (
			a[i]?.id !== b[i]?.id ||
			a[i]?.name !== b[i]?.name ||
			a[i]?.provider !== b[i]?.provider ||
			a[i]?.count !== b[i]?.count
		) {
			return false;
		}
	}

	return true;
}

function isSameUsageMap(
	currentHistory: Map<string, RecentSentEmoteUsageEntry[]>,
	nextHistory: Map<string, RecentSentEmoteUsageEntry[]>,
): boolean {
	if (currentHistory.size !== nextHistory.size) return false;

	for (const [channelID, entries] of currentHistory) {
		if (!areUsageEntriesEqual(entries, nextHistory.get(channelID))) return false;
	}

	return true;
}

function areChannelMetaEqual(
	a: RecentSentEmoteChannelMeta | undefined,
	b: RecentSentEmoteChannelMeta | undefined,
): boolean {
	return a?.username === b?.username && a?.displayName === b?.displayName;
}

function isSameHistoryMap(
	currentHistory: Map<string, RecentSentEmoteEntry[]>,
	nextHistory: Map<string, RecentSentEmoteEntry[]>,
): boolean {
	if (currentHistory.size !== nextHistory.size) return false;

	for (const [channelID, entries] of currentHistory) {
		if (!areEntriesEqual(entries, nextHistory.get(channelID))) return false;
	}

	return true;
}

function isSameHistoryState(currentState: RecentSentEmoteHistoryState, nextState: RecentSentEmoteHistoryState): boolean {
	if (currentState.history.size !== nextState.history.size || currentState.timestamps.size !== nextState.timestamps.size) {
		return false;
	}

	for (const [channelID, entries] of currentState.history) {
		if (!areEntriesEqual(entries, nextState.history.get(channelID))) return false;
		if ((currentState.timestamps.get(channelID) ?? 0) !== (nextState.timestamps.get(channelID) ?? 0)) return false;
	}

	return true;
}

function currentHistoryState(): RecentSentEmoteHistoryState {
	return normalizeHistoryState(history.value.entries(), historyTimestamps.value.entries());
}

function normalizeUsageState(
	value: Iterable<[string, RecentSentEmoteUsageEntry[]]> | null | undefined,
	timestamps?: Iterable<[string, number]> | null | undefined,
): RecentSentEmoteUsageState {
	const out = emptyUsageState();
	const timestampMap = new Map<string, number>(timestamps ?? []);

	for (const [channelID, entries] of value ?? []) {
		if (typeof channelID !== "string" || !channelID) continue;

		const normalized = normalizeUsageEntries(entries);
		if (!normalized.length) continue;

		out.history.set(channelID, normalized);
		out.timestamps.set(channelID, timestampMap.get(channelID) ?? 0);
	}

	return out;
}

function currentUsageState(): RecentSentEmoteUsageState {
	return normalizeUsageState(usageHistory.value.entries(), usageHistoryTimestamps.value.entries());
}

function normalizeChannelMetaEntry(value: RecentSentEmoteChannelMeta | null | undefined): RecentSentEmoteChannelMeta | null {
	if (!value) return null;

	const username = value.username?.trim();
	const displayName = value.displayName?.trim();
	if (!username && !displayName) return null;

	return {
		username,
		displayName,
	};
}

function normalizeChannelMetaState(
	value: Iterable<[string, RecentSentEmoteChannelMeta]> | null | undefined,
): Map<string, RecentSentEmoteChannelMeta> {
	const out = new Map<string, RecentSentEmoteChannelMeta>();

	for (const [channelID, meta] of value ?? []) {
		if (typeof channelID !== "string" || !channelID) continue;

		const normalized = normalizeChannelMetaEntry(meta);
		if (!normalized) continue;

		out.set(channelID, normalized);
	}

	return out;
}

function isSameChannelMetaState(
	currentState: Map<string, RecentSentEmoteChannelMeta>,
	nextState: Map<string, RecentSentEmoteChannelMeta>,
): boolean {
	if (currentState.size !== nextState.size) return false;

	for (const [channelID, meta] of currentState) {
		if (!areChannelMetaEqual(meta, nextState.get(channelID))) return false;
	}

	return true;
}

function createCurrentTimestampMap(channelIDs: Iterable<string>): Map<string, number> {
	const out = new Map<string, number>();
	let nextTimestamp = Date.now();

	for (const channelID of channelIDs) {
		if (typeof channelID !== "string" || !channelID) continue;

		out.set(channelID, nextTimestamp);
		nextTimestamp += 1;
	}

	return out;
}

function hasAnyRuntimeState(): boolean {
	return currentHistoryState().history.size > 0 || currentUsageState().history.size > 0 || channelMeta.value.size > 0;
}

function hasAnyPersistedMirrorData(): boolean {
	return (
		persistedHistory.value.size > 0 ||
		persistedUsage.value.size > 0 ||
		persistedChannelMeta.value.size > 0
	);
}

function markPersistedMirrorVersion(): void {
	if (!settingsBootstrapResolved) return;

	persistedMirrorVersion.value = Date.now();
}

function normalizeChannelMetaSnapshot(value: unknown): Map<string, RecentSentEmoteChannelMeta> {
	if (!value || typeof value !== "object") {
		return new Map();
	}

	const channels = (value as Partial<RecentSentEmoteChannelMetaSnapshot>).channels;
	if (!(channels instanceof Array)) {
		return new Map();
	}

	const out = new Map<string, RecentSentEmoteChannelMeta>();

	for (const channel of channels) {
		if (!channel || typeof channel !== "object") continue;

		const channelID = (channel as Partial<RecentSentEmoteChannelMetaSnapshotChannel>).channelID;
		if (typeof channelID !== "string" || !channelID) continue;

		const normalized = normalizeChannelMetaEntry(channel as RecentSentEmoteChannelMetaSnapshotChannel);
		if (!normalized) continue;

		out.set(channelID, normalized);
	}

	return out;
}

function buildChannelMetaSnapshot(state: Map<string, RecentSentEmoteChannelMeta>): RecentSentEmoteChannelMetaSnapshot {
	return {
		version: 1,
		channels: Array.from(state.entries()).map(([channelID, meta]) => ({
			channelID,
			...meta,
		})),
	};
}

function readChannelMetaState(storage: Storage, key: string): Map<string, RecentSentEmoteChannelMeta> {
	try {
		const raw = storage.getItem(key);
		if (!raw) return new Map();

		return normalizeChannelMetaSnapshot(JSON.parse(raw));
	} catch {
		storage.removeItem(key);
		return new Map();
	}
}

function writeChannelMetaState(storage: Storage, key: string, state: Map<string, RecentSentEmoteChannelMeta>): void {
	try {
		if (state.size === 0) {
			storage.removeItem(key);
			return;
		}

		storage.setItem(key, JSON.stringify(buildChannelMetaSnapshot(state)));
	} catch {
		// Ignore storage failures and keep the in-memory channel metadata active.
	}
}

function applyHistoryState(nextState: RecentSentEmoteHistoryState): boolean {
	const normalized = normalizeHistoryState(nextState.history.entries(), nextState.timestamps.entries());
	if (isSameHistoryState(currentHistoryState(), normalized)) return false;

	history.value = normalized.history;
	historyTimestamps.value = normalized.timestamps;
	return true;
}

function isSameUsageState(currentState: RecentSentEmoteUsageState, nextState: RecentSentEmoteUsageState): boolean {
	if (currentState.history.size !== nextState.history.size || currentState.timestamps.size !== nextState.timestamps.size) {
		return false;
	}

	for (const [channelID, entries] of currentState.history) {
		if (!areUsageEntriesEqual(entries, nextState.history.get(channelID))) return false;
		if ((currentState.timestamps.get(channelID) ?? 0) !== (nextState.timestamps.get(channelID) ?? 0)) return false;
	}

	return true;
}

function applyUsageState(nextState: RecentSentEmoteUsageState): boolean {
	const normalized = normalizeUsageState(nextState.history.entries(), nextState.timestamps.entries());
	if (isSameUsageState(currentUsageState(), normalized)) return false;

	usageHistory.value = normalized.history;
	usageHistoryTimestamps.value = normalized.timestamps;
	return true;
}

function applyChannelMetaState(nextState: Map<string, RecentSentEmoteChannelMeta>): boolean {
	const normalized = normalizeChannelMetaState(nextState.entries());
	if (isSameChannelMetaState(channelMeta.value, normalized)) return false;

	channelMeta.value = normalized;
	return true;
}

function mergeHistoryStates(...states: RecentSentEmoteHistoryState[]): RecentSentEmoteHistoryState {
	const merged = emptyHistoryState();

	for (const state of states) {
		for (const [channelID, entries] of state.history) {
			const normalizedEntries = normalizeEntries(entries);
			if (!normalizedEntries.length) continue;

			const nextTimestamp = state.timestamps.get(channelID) ?? 0;
			const currentTimestamp = merged.timestamps.get(channelID);
			const currentEntries = merged.history.get(channelID);
			const shouldReplace =
				currentTimestamp === undefined ||
				nextTimestamp > currentTimestamp ||
				(nextTimestamp === currentTimestamp && !areEntriesEqual(currentEntries, normalizedEntries));
			if (!shouldReplace) continue;

			merged.history.set(channelID, normalizedEntries);
			merged.timestamps.set(channelID, nextTimestamp);
		}
	}

	return normalizeHistoryState(merged.history.entries(), merged.timestamps.entries());
}

function mergeUsageStates(...states: RecentSentEmoteUsageState[]): RecentSentEmoteUsageState {
	const merged = emptyUsageState();

	for (const state of states) {
		for (const [channelID, entries] of state.history) {
			const normalizedEntries = normalizeUsageEntries(entries);
			if (!normalizedEntries.length) continue;

			const nextTimestamp = state.timestamps.get(channelID) ?? 0;
			const currentTimestamp = merged.timestamps.get(channelID);
			const currentEntries = merged.history.get(channelID);
			const shouldReplace =
				currentTimestamp === undefined ||
				nextTimestamp > currentTimestamp ||
				(nextTimestamp === currentTimestamp && !areUsageEntriesEqual(currentEntries, normalizedEntries));
			if (!shouldReplace) continue;

			merged.history.set(channelID, normalizedEntries);
			merged.timestamps.set(channelID, nextTimestamp);
		}
	}

	return normalizeUsageState(merged.history.entries(), merged.timestamps.entries());
}

function readHistoryState(storage: Storage, key: string): RecentSentEmoteHistoryState {
	try {
		const rawHistory = storage.getItem(key);
		if (!rawHistory) return emptyHistoryState();

		return normalizeSnapshot(JSON.parse(rawHistory));
	} catch {
		storage.removeItem(key);
		return emptyHistoryState();
	}
}

function writeHistoryState(storage: Storage, key: string, state: RecentSentEmoteHistoryState): void {
	try {
		if (state.history.size === 0) {
			storage.removeItem(key);
			return;
		}

		storage.setItem(key, JSON.stringify(buildSnapshot(state)));
	} catch {
		// Ignore storage failures and keep the in-memory history active.
	}
}

function readUsageState(storage: Storage, key: string): RecentSentEmoteUsageState {
	try {
		const rawUsage = storage.getItem(key);
		if (!rawUsage) return emptyUsageState();

		return normalizeUsageSnapshot(JSON.parse(rawUsage));
	} catch {
		storage.removeItem(key);
		return emptyUsageState();
	}
}

function writeUsageState(storage: Storage, key: string, state: RecentSentEmoteUsageState): void {
	try {
		if (state.history.size === 0) {
			storage.removeItem(key);
			return;
		}

		storage.setItem(key, JSON.stringify(buildUsageSnapshot(state)));
	} catch {
		// Ignore storage failures and keep the in-memory usage active.
	}
}

function persistHistoryConfigState(nextState = currentHistoryState()): boolean {
	if (!settingsBootstrapResolved) return false;

	const normalizedConfigState = normalizeHistoryState(persistedHistory.value.entries());
	if (isSameHistoryMap(normalizedConfigState.history, nextState.history)) return false;

	persistedHistory.value = new Map(nextState.history);
	return true;
}

function persistUsageConfigState(nextState = currentUsageState()): boolean {
	if (!settingsBootstrapResolved) return false;

	const normalizedConfigState = normalizeUsageState(persistedUsage.value.entries());
	if (isSameUsageMap(normalizedConfigState.history, nextState.history)) return false;

	persistedUsage.value = new Map(nextState.history);
	return true;
}

function persistChannelMetaConfigState(nextState = normalizeChannelMetaState(channelMeta.value.entries())): boolean {
	if (!settingsBootstrapResolved) return false;

	const normalizedConfigState = normalizeChannelMetaState(persistedChannelMeta.value.entries());
	if (isSameChannelMetaState(normalizedConfigState, nextState)) return false;

	persistedChannelMeta.value = new Map(nextState);
	return true;
}

function mirrorRuntimeToPersistedConfig(): void {
	if (!settingsBootstrapResolved) return;

	const didPersistHistory = persistHistoryConfigState(currentHistoryState());
	const didPersistUsage = persistUsageConfigState(currentUsageState());
	const didPersistChannelMeta = persistChannelMetaConfigState(normalizeChannelMetaState(channelMeta.value.entries()));
	if (didPersistHistory || didPersistUsage || didPersistChannelMeta || (persistedMirrorVersion.value === 0 && hasAnyRuntimeState())) {
		markPersistedMirrorVersion();
	}
}

function syncRuntimeFromPersistedConfig(): void {
	if (!settingsBootstrapResolved) return;

	const hasFullPersistedState = persistedMirrorVersion.value > 0;
	const importedHistory = normalizeHistoryState(persistedHistory.value.entries()).history;
	const importedUsage = normalizeUsageState(persistedUsage.value.entries()).history;
	const importedChannelMeta = normalizeChannelMetaState(persistedChannelMeta.value.entries());
	if (!hasFullPersistedState && !hasAnyPersistedMirrorData()) {
		if (hasAnyRuntimeState()) {
			mirrorRuntimeToPersistedConfig();
		}

		return;
	}

	if ((hasFullPersistedState || importedHistory.size > 0) && !isSameHistoryMap(currentHistoryState().history, importedHistory)) {
		const importedState = normalizeHistoryState(
			importedHistory.entries(),
			createCurrentTimestampMap(importedHistory.keys()).entries(),
		);
		applyHistoryState(importedState);
		persistHistoryState(importedState);
	}

	if ((hasFullPersistedState || importedUsage.size > 0) && !isSameUsageMap(currentUsageState().history, importedUsage)) {
		const importedState = normalizeUsageState(
			importedUsage.entries(),
			createCurrentTimestampMap(importedUsage.keys()).entries(),
		);
		applyUsageState(importedState);
		persistUsageState(importedState);
	}

	if ((hasFullPersistedState || importedChannelMeta.size > 0) && !isSameChannelMetaState(channelMeta.value, importedChannelMeta)) {
		applyChannelMetaState(importedChannelMeta);
		persistChannelMetaState(importedChannelMeta);
	}

	if (!hasFullPersistedState) {
		mirrorRuntimeToPersistedConfig();
	}
}

void waitForSettingsBootstrap().finally(() => {
	settingsBootstrapResolved = true;
	if (!initialized) return;

	bindPersistentStateWatchers();
	syncRuntimeFromPersistedConfig();
});

function persistHistoryState(nextState = currentHistoryState()): void {
	persistHistoryConfigState(nextState);
	markPersistedMirrorVersion();
	if (typeof window === "undefined") return;

	writeHistoryState(window.sessionStorage, RECENT_EMOTE_HISTORY_SESSION_KEY, nextState);

	const mergedPersistentState = mergeHistoryStates(
		readHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY),
		nextState,
	);
	applyHistoryState(mergedPersistentState);
	writeHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY, mergedPersistentState);
	persistHistoryConfigState(mergedPersistentState);
}

function persistUsageState(nextState = currentUsageState()): void {
	persistUsageConfigState(nextState);
	markPersistedMirrorVersion();
	if (typeof window === "undefined") return;

	writeUsageState(window.localStorage, RECENT_EMOTE_USAGE_STORAGE_KEY, nextState);
}

function persistChannelMetaState(nextState = normalizeChannelMetaState(channelMeta.value.entries())): void {
	persistChannelMetaConfigState(nextState);
	markPersistedMirrorVersion();
	if (typeof window === "undefined") return;

	writeChannelMetaState(window.localStorage, RECENT_EMOTE_CHANNEL_META_STORAGE_KEY, nextState);
}

function bindStorageListener(): void {
	if (storageListenerBound || typeof window === "undefined") return;

	window.addEventListener("storage", (ev: StorageEvent) => {
		if (ev.storageArea !== window.localStorage) return;

		if (ev.key === RECENT_EMOTE_HISTORY_STORAGE_KEY) {
			const mergedState = mergeHistoryStates(
				currentHistoryState(),
				readHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY),
			);
			applyHistoryState(mergedState);
			writeHistoryState(window.sessionStorage, RECENT_EMOTE_HISTORY_SESSION_KEY, mergedState);
			return;
		}

		if (ev.key === RECENT_EMOTE_USAGE_STORAGE_KEY) {
			applyUsageState(
				mergeUsageStates(currentUsageState(), readUsageState(window.localStorage, RECENT_EMOTE_USAGE_STORAGE_KEY)),
			);
			return;
		}

		if (ev.key === RECENT_EMOTE_CHANNEL_META_STORAGE_KEY) {
			applyChannelMetaState(
				mergeChannelMetaStates(
				channelMeta.value,
				readChannelMetaState(window.localStorage, RECENT_EMOTE_CHANNEL_META_STORAGE_KEY),
				),
			);
		}
	});

	storageListenerBound = true;
}

function bindPersistentStateWatchers(): void {
	if (persistentStateWatcherBound) return;

	watch(
		[persistedMirrorVersion, persistedHistory, persistedUsage, persistedChannelMeta],
		() => {
			syncRuntimeFromPersistedConfig();
		},
		{ immediate: true },
	);

	persistentStateWatcherBound = true;
}

function ensureInitialized(): void {
	if (initialized || typeof window === "undefined") return;

	const mergedState = mergeHistoryStates(
		readHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY),
		readHistoryState(window.sessionStorage, RECENT_EMOTE_HISTORY_SESSION_KEY),
	);

	applyHistoryState(mergedState);
	if (settingsBootstrapResolved) {
		writeHistoryState(window.sessionStorage, RECENT_EMOTE_HISTORY_SESSION_KEY, mergedState);

		const mergedPersistentState = mergeHistoryStates(
			readHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY),
			mergedState,
		);
		applyHistoryState(mergedPersistentState);
		writeHistoryState(window.localStorage, RECENT_EMOTE_HISTORY_STORAGE_KEY, mergedPersistentState);
	} else {
		persistHistoryState(mergedState);
	}
	const mergedUsageState = mergeUsageStates(readUsageState(window.localStorage, RECENT_EMOTE_USAGE_STORAGE_KEY));
	applyUsageState(mergedUsageState);
	if (settingsBootstrapResolved) {
		writeUsageState(window.localStorage, RECENT_EMOTE_USAGE_STORAGE_KEY, mergedUsageState);
	} else {
		persistUsageState(mergedUsageState);
	}
	const initialChannelMetaState = normalizeChannelMetaState(
		readChannelMetaState(window.localStorage, RECENT_EMOTE_CHANNEL_META_STORAGE_KEY).entries(),
	);
	applyChannelMetaState(initialChannelMetaState);
	if (settingsBootstrapResolved) {
		writeChannelMetaState(window.localStorage, RECENT_EMOTE_CHANNEL_META_STORAGE_KEY, initialChannelMetaState);
	} else {
		persistChannelMetaState(initialChannelMetaState);
	}
	bindStorageListener();
	if (settingsBootstrapResolved) {
		bindPersistentStateWatchers();
		syncRuntimeFromPersistedConfig();
	}
	initialized = true;
}

function mergeChannelMetaStates(
	...states: (Map<string, RecentSentEmoteChannelMeta> | Iterable<[string, RecentSentEmoteChannelMeta]>)[]
): Map<string, RecentSentEmoteChannelMeta> {
	const merged = new Map<string, RecentSentEmoteChannelMeta>();

	for (const state of states) {
		for (const [channelID, meta] of state) {
			const normalized = normalizeChannelMetaEntry(meta);
			if (!normalized) continue;

			merged.set(channelID, {
				...merged.get(channelID),
				...normalized,
			});
		}
	}

	return normalizeChannelMetaState(merged.entries());
}

function rememberChannel(channelID: string, meta?: RecentSentEmoteChannelMeta): void {
	if (!channelID) return;

	ensureInitialized();
	const normalized = normalizeChannelMetaEntry(meta);
	if (!normalized) return;

	const existing = channelMeta.value.get(channelID);
	if (existing?.username === normalized.username && existing?.displayName === normalized.displayName) {
		return;
	}

	const nextState = new Map(channelMeta.value);
	nextState.set(channelID, normalized);
	applyChannelMetaState(nextState);
	persistChannelMetaState(nextState);
}

function getEntries(channelID: string): RecentSentEmoteEntry[] {
	if (!channelID) return [];

	ensureInitialized();
	return normalizeEntries(history.value.get(channelID));
}

function getMostUsedEntries(channelID: string): RecentSentEmoteUsageEntry[] {
	if (!channelID) return [];

	ensureInitialized();
	return normalizeUsageEntries(usageHistory.value.get(channelID))
		.filter((entry) => entry.count >= RECENT_EMOTE_BAR_MOST_USED_MIN_COUNT)
		.slice(0, RECENT_EMOTE_BAR_LIMIT);
}

function scopeAllows(provider: RecentSentEmoteProvider, value = scope.value): boolean {
	switch (value) {
		case "7tv":
			return provider === "7TV";
		case "all":
			return SUPPORTED_PROVIDERS.has(provider);
		default:
			return false;
	}
}

function resolveEmoteToken(token: string, activeEmotes: Record<string, SevenTV.ActiveEmote>): SevenTV.ActiveEmote | null {
	if (!token) return null;

	const directMatch = activeEmotes[token];
	if (directMatch) return directMatch;

	const trimmedToken = token.replace(TOKEN_EDGE_PUNCTUATION, "");
	if (!trimmedToken || trimmedToken === token) return null;

	return activeEmotes[trimmedToken] ?? null;
}

function clearAll(): void {
	ensureInitialized();

	const nextHistoryState = emptyHistoryState();
	applyHistoryState(nextHistoryState);
	persistHistoryState(nextHistoryState);

	const nextUsageState = emptyUsageState();
	applyUsageState(nextUsageState);
	persistUsageState(nextUsageState);

	const nextChannelMetaState = new Map<string, RecentSentEmoteChannelMeta>();
	applyChannelMetaState(nextChannelMetaState);
	persistChannelMetaState(nextChannelMetaState);
}

function clearMostUsed(channelID: string): boolean {
	if (!channelID) return false;

	ensureInitialized();
	if (!usageHistory.value.has(channelID)) return false;

	const nextUsageHistory = new Map(usageHistory.value);
	const nextUsageTimestamps = new Map(usageHistoryTimestamps.value);
	nextUsageHistory.delete(channelID);
	nextUsageTimestamps.delete(channelID);

	const nextUsageState = normalizeUsageState(nextUsageHistory.entries(), nextUsageTimestamps.entries());
	applyUsageState(nextUsageState);
	persistUsageState(nextUsageState);

	return true;
}

function resolveChannelIDByName(channelName: string): string | null {
	ensureInitialized();

	const normalizedName = channelName.trim().replace(/^@/, "").toLowerCase();
	if (!normalizedName) return null;

	for (const [channelID, meta] of channelMeta.value) {
		const username = meta.username?.trim().toLowerCase();
		const displayName = meta.displayName?.trim().toLowerCase();
		if (normalizedName === channelID.toLowerCase() || normalizedName === username || normalizedName === displayName) {
			return channelID;
		}
	}

	return null;
}

function clearMostUsedByChannelName(channelName: string): boolean {
	const channelID = resolveChannelIDByName(channelName);
	if (!channelID) return false;

	return clearMostUsed(channelID);
}

function recordMessage(
	channelID: string,
	message: string,
	activeEmotes: Record<string, SevenTV.ActiveEmote>,
	meta?: RecentSentEmoteChannelMeta,
): void {
	ensureInitialized();
	if (!channelID) return;
	rememberChannel(channelID, meta);

	const tokens = message.trim().split(/\s+/).filter(Boolean);
	if (!tokens.length) return;

	const nextEntries = getEntries(channelID);

	for (const token of tokens) {
		const emote = resolveEmoteToken(token, activeEmotes);
		const provider = emote?.provider;
		if (!emote || !provider || !isRecentSentEmoteProvider(provider)) continue;

		const entry = {
			id: emote.id,
			name: emote.name,
			provider,
		} satisfies RecentSentEmoteEntry;
		const existingIndex = nextEntries.findIndex((item) => item.id === entry.id && item.provider === entry.provider);
		if (existingIndex >= 0) {
			nextEntries.splice(existingIndex, 1);
		}

		nextEntries.unshift(entry);
	}

	const normalizedEntries = normalizeEntries(nextEntries);
	const previousEntries = getEntries(channelID);
	if (!areEntriesEqual(normalizedEntries, previousEntries)) {
		const nextHistory = new Map(history.value);
		const nextTimestamps = new Map(historyTimestamps.value);
		if (normalizedEntries.length) {
			nextHistory.set(channelID, normalizedEntries);
			nextTimestamps.set(channelID, Date.now());
		} else {
			nextHistory.delete(channelID);
			nextTimestamps.delete(channelID);
		}

		const nextState = normalizeHistoryState(nextHistory.entries(), nextTimestamps.entries());
		applyHistoryState(nextState);
		persistHistoryState(nextState);
	}

	const previousUsageEntries = normalizeUsageEntries(usageHistory.value.get(channelID));
	const nextUsageEntries = previousUsageEntries.map((entry) => ({ ...entry }));
	let didChangeUsage = false;

	for (const token of tokens) {
		const emote = resolveEmoteToken(token, activeEmotes);
		const provider = emote?.provider;
		if (!emote || !provider || !isRecentSentEmoteProvider(provider)) continue;

		const existingEntry = nextUsageEntries.find((entry) => entry.id === emote.id && entry.provider === provider);
		if (existingEntry) {
			existingEntry.name = emote.name;
			existingEntry.count += 1;
		} else {
			nextUsageEntries.push({
				id: emote.id,
				name: emote.name,
				provider,
				count: 1,
			});
		}

		didChangeUsage = true;
	}

	if (!didChangeUsage) return;

	const normalizedUsageEntries = normalizeUsageEntries(nextUsageEntries);
	if (areUsageEntriesEqual(normalizedUsageEntries, previousUsageEntries)) return;

	const nextUsageHistory = new Map(usageHistory.value);
	const nextUsageTimestamps = new Map(usageHistoryTimestamps.value);
	if (normalizedUsageEntries.length) {
		nextUsageHistory.set(channelID, normalizedUsageEntries);
		nextUsageTimestamps.set(channelID, Date.now());
	} else {
		nextUsageHistory.delete(channelID);
		nextUsageTimestamps.delete(channelID);
	}

	const nextUsageState = normalizeUsageState(nextUsageHistory.entries(), nextUsageTimestamps.entries());
	applyUsageState(nextUsageState);
	persistUsageState(nextUsageState);
}

export function useRecentSentEmotes() {
	ensureInitialized();

	const mode = computed<RecentEmoteBarMode>({
		get: () => normalizeRecentEmoteBarMode(rawMode.value),
		set: (value) => {
			rawMode.value = value;
		},
	});
	const showRecentBar = computed(() => {
		const currentMode = mode.value;
		return currentMode === "recent" || currentMode === "combine";
	});
	const showMostUsedBar = computed(() => {
		const currentMode = mode.value;
		return currentMode === "most_used" || currentMode === "combine";
	});
	const isEnabled = computed(() => showRecentBar.value || showMostUsedBar.value);

	return {
		isEnabled,
		mode,
		scope,
		showRecentBar,
		showMostUsedBar,
		history,
		entries: computed(() => history.value),
		getEntries,
		getMostUsedEntries,
		scopeAllows,
		clearAll,
		clearMostUsed,
		clearMostUsedByChannelName,
		resolveChannelIDByName,
		recordMessage,
	};
}
