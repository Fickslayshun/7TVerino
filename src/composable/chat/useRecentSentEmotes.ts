import { computed } from "vue";
import { useConfig } from "@/composable/useSettings";

export const RECENT_EMOTE_BAR_LIMIT = 6;

export type RecentEmoteBarScope = "7tv" | "all";
export type RecentSentEmoteProvider = "7TV" | "PLATFORM" | "BTTV" | "FFZ";

export interface RecentSentEmoteEntry {
	id: string;
	name: string;
	provider: RecentSentEmoteProvider;
}

const enabled = useConfig<boolean>("chat.recent_emote_bar", false);
const scope = useConfig<RecentEmoteBarScope>("chat.recent_emote_bar.scope", "7tv");
const history = useConfig<Map<string, RecentSentEmoteEntry[]>>("chat.recent_emote_bar.history", new Map());
const RECENT_EMOTE_HISTORY_SESSION_KEY = "seventv:recent-emote-bar:history";

const SUPPORTED_PROVIDERS = new Set<RecentSentEmoteProvider>(["7TV", "PLATFORM", "BTTV", "FFZ"]);

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
		if (out.length >= RECENT_EMOTE_BAR_LIMIT) break;
	}

	return out;
}

function normalizeHistoryEntries(
	value: Iterable<[string, RecentSentEmoteEntry[]]> | null | undefined,
): Map<string, RecentSentEmoteEntry[]> {
	const out = new Map<string, RecentSentEmoteEntry[]>();

	for (const [channelID, entries] of value ?? []) {
		if (typeof channelID !== "string" || !channelID) continue;

		const normalized = normalizeEntries(entries);
		if (!normalized.length) continue;

		out.set(channelID, normalized);
	}

	return out;
}

function isSameHistory(
	currentHistory: Map<string, RecentSentEmoteEntry[]>,
	nextHistory: Map<string, RecentSentEmoteEntry[]>,
): boolean {
	if (currentHistory.size !== nextHistory.size) return false;

	for (const [channelID, currentEntries] of currentHistory) {
		const nextEntries = nextHistory.get(channelID);
		if (!nextEntries || currentEntries.length !== nextEntries.length) return false;

		for (let i = 0; i < currentEntries.length; i++) {
			if (
				currentEntries[i]?.id !== nextEntries[i]?.id ||
				currentEntries[i]?.name !== nextEntries[i]?.name ||
				currentEntries[i]?.provider !== nextEntries[i]?.provider
			) {
				return false;
			}
		}
	}

	return true;
}

function persistHistoryToSession(nextHistory: Map<string, RecentSentEmoteEntry[]>): void {
	try {
		if (nextHistory.size === 0) {
			window.sessionStorage.removeItem(RECENT_EMOTE_HISTORY_SESSION_KEY);
			return;
		}

		window.sessionStorage.setItem(
			RECENT_EMOTE_HISTORY_SESSION_KEY,
			JSON.stringify(Array.from(nextHistory.entries())),
		);
	} catch {
		// Ignore session storage failures and keep the in-memory history active.
	}
}

function setHistory(nextHistory: Map<string, RecentSentEmoteEntry[]>): void {
	const normalizedHistory = normalizeHistoryEntries(nextHistory.entries());
	persistHistoryToSession(normalizedHistory);
	history.value = normalizedHistory;
}

function restoreHistoryFromSession(): void {
	try {
		const rawHistory = window.sessionStorage.getItem(RECENT_EMOTE_HISTORY_SESSION_KEY);
		if (!rawHistory) return;

		const parsed = JSON.parse(rawHistory);
		if (!(parsed instanceof Array)) return;

		const restoredHistory = normalizeHistoryEntries(parsed);
		if (!restoredHistory.size) return;

		const currentHistory = normalizeHistoryEntries(history.value.entries());
		if (isSameHistory(currentHistory, restoredHistory)) return;

		setHistory(restoredHistory);
	} catch {
		window.sessionStorage.removeItem(RECENT_EMOTE_HISTORY_SESSION_KEY);
	}
}

restoreHistoryFromSession();

function getEntries(channelID: string): RecentSentEmoteEntry[] {
	if (!channelID) return [];

	return normalizeEntries(history.value.get(channelID));
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

function recordMessage(channelID: string, message: string, activeEmotes: Record<string, SevenTV.ActiveEmote>): void {
	if (!enabled.value || !channelID) return;

	const tokens = message.trim().split(/\s+/).filter(Boolean);
	if (!tokens.length) return;

	const nextEntries = getEntries(channelID);

	for (const token of tokens) {
		const emote = activeEmotes[token];
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
	if (
		normalizedEntries.length === previousEntries.length &&
		normalizedEntries.every(
			(entry, index) =>
				entry.id === previousEntries[index]?.id &&
				entry.provider === previousEntries[index]?.provider &&
				entry.name === previousEntries[index]?.name,
		)
	) {
		return;
	}

	const nextHistory = new Map(history.value);
	nextHistory.set(channelID, normalizedEntries);
	setHistory(nextHistory);
}

export function useRecentSentEmotes() {
	return {
		enabled,
		scope,
		history,
		entries: computed(() => history.value),
		getEntries,
		scopeAllows,
		recordMessage,
	};
}
