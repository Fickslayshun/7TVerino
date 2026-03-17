import type { TabToken } from "@/common/Input";
import type { ChatUser } from "@/common/chat/ChatMessage";

type IndexedToken = TabToken & {
	lower: string;
};

interface QueryOptions {
	mode: "tab" | "colon";
	matchMode: 0 | 1;
	includeChatters: boolean;
	limit?: number;
}

export class ChatAutocompleteIndex {
	private personal = [] as IndexedToken[];
	private provider = [] as IndexedToken[];
	private emojis = [] as IndexedToken[];
	private chatters = [] as IndexedToken[];

	private personalBuckets = new Map<string, IndexedToken[]>();
	private providerBuckets = new Map<string, IndexedToken[]>();
	private emojiBuckets = new Map<string, IndexedToken[]>();
	private chatterBuckets = new Map<string, IndexedToken[]>();

	rebuild(input: {
		personalEmotes: Record<string, SevenTV.ActiveEmote>;
		activeEmotes: Record<string, SevenTV.ActiveEmote>;
		providers: Record<SevenTV.Provider, Record<string, SevenTV.EmoteSet>>;
		emojis: Record<string, SevenTV.ActiveEmote>;
		chatters: Record<string, ChatUser>;
	}): void {
		this.personal = [];
		this.provider = [];
		this.emojis = [];
		this.chatters = [];
		this.personalBuckets.clear();
		this.providerBuckets.clear();
		this.emojiBuckets.clear();
		this.chatterBuckets.clear();

		for (const [token, emote] of Object.entries(input.personalEmotes)) {
			this.pushToken(this.personal, this.personalBuckets, {
				token,
				priority: 1,
				item: input.activeEmotes[token] ?? emote,
			});
		}

		for (const [provider, sets] of Object.entries(input.providers)) {
			if (provider === "EMOJI") continue;

			for (const set of Object.values(sets)) {
				for (const emote of set.emotes) {
					this.pushToken(this.provider, this.providerBuckets, {
						token: emote.name,
						priority: 2,
						item: input.activeEmotes[emote.name] ?? emote,
					});
				}
			}
		}

		for (const token of Object.keys(input.emojis)) {
			this.pushToken(this.emojis, this.emojiBuckets, {
				token,
				priority: 4,
			});
		}

		for (const chatter of Object.values(input.chatters)) {
			if (!chatter.displayName) continue;

			this.pushToken(this.chatters, this.chatterBuckets, {
				token: chatter.displayName,
				priority: 10,
			});
		}
	}

	query(search: string, options: QueryOptions): TabToken[] {
		const usedTokens = new Set<string>();
		const matches = [] as TabToken[];

		const tokenStartsWithAt = options.mode === "tab" && search.startsWith("@");
		const normalizedSearch = search.toLowerCase();
		const chatterSearch = tokenStartsWithAt ? normalizedSearch.slice(1) : normalizedSearch;

		const pushMatches = (
			entries: IndexedToken[],
			transformToken?: (token: string) => string,
			matchSearch = normalizedSearch,
		) => {
			for (const entry of entries) {
				if (!this.matches(entry.lower, matchSearch, options.matchMode)) continue;

				const token = transformToken ? transformToken(entry.token) : entry.token;
				const dedupeKey = token.toLowerCase();
				if (usedTokens.has(dedupeKey)) continue;

				usedTokens.add(dedupeKey);
				matches.push({
					token,
					priority: entry.priority,
					item: entry.item,
				});
			}
		};

		pushMatches(this.selectEntries(this.personal, this.personalBuckets, normalizedSearch, options.matchMode));
		pushMatches(this.selectEntries(this.provider, this.providerBuckets, normalizedSearch, options.matchMode));

		if (options.mode === "colon") {
			pushMatches(this.selectEntries(this.emojis, this.emojiBuckets, normalizedSearch, options.matchMode));
		}

		if (options.includeChatters && options.mode === "tab" && (tokenStartsWithAt || chatterSearch)) {
			const chatterEntries =
				tokenStartsWithAt && !chatterSearch
					? this.chatters
					: this.selectEntries(this.chatters, this.chatterBuckets, chatterSearch, options.matchMode).filter(
							(entry) => this.matches(entry.lower, chatterSearch, options.matchMode),
					  );

			pushMatches(chatterEntries, (token) => `${tokenStartsWithAt ? "@" : ""}${token}`, chatterSearch);
		}

		matches.sort((a, b) => a.priority - b.priority || a.token.localeCompare(b.token));
		if (typeof options.limit === "number" && matches.length > options.limit) {
			matches.length = options.limit;
		}

		return matches;
	}

	private matches(token: string, search: string, mode: QueryOptions["matchMode"]): boolean {
		return mode === 0 ? token.startsWith(search) : token.includes(search);
	}

	private selectEntries(
		list: IndexedToken[],
		buckets: Map<string, IndexedToken[]>,
		search: string,
		matchMode: QueryOptions["matchMode"],
	): IndexedToken[] {
		if (!search) return [];
		if (matchMode === 1) return list;

		return buckets.get(search.charAt(0)) ?? [];
	}

	private pushToken(list: IndexedToken[], buckets: Map<string, IndexedToken[]>, token: TabToken): void {
		const lower = token.token.toLowerCase();
		const indexed = {
			...token,
			lower,
		};

		list.push(indexed);

		const bucketKey = lower.charAt(0);
		if (!buckets.has(bucketKey)) {
			buckets.set(bucketKey, []);
		}

		buckets.get(bucketKey)?.push(indexed);
	}
}
