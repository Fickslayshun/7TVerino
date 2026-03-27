import { markRaw, reactive, ref, toRaw, watch } from "vue";
import { toReactive, until, useDocumentVisibility, useIntervalFn, useTitle } from "@vueuse/core";
import { debounceFn } from "@/common/Async";
import { log } from "@/common/Logger";
import type { ChatMessage } from "@/common/chat/ChatMessage";
import type { WorkerSafeHighlightDef } from "@/common/chat/PerformanceProcessor";
import { ChannelContext } from "@/composable/channel/useChannelContext";
import { useConfig } from "../useSettings";

interface ChatHighlights {
	highlights: Record<string, HighlightDef>;
	compiled: {
		all: CompiledHighlight[];
		phrase: CompiledHighlight[];
		username: CompiledHighlight[];
		badge: CompiledHighlight[];
		worker: WorkerSafeHighlightDef[];
	};
	filtered: {
		phrase: Record<string, HighlightDef>;
		username: Record<string, HighlightDef>;
		badge: Record<string, HighlightDef>;
	};
}

export interface HighlightDef {
	id: string;

	pattern?: string;
	test?: (msg: ChatMessage) => boolean;
	regexp?: boolean;
	readonly cachedRegExp?: RegExp;

	color: string;
	label: string;
	caseSensitive?: boolean;
	flashTitle?: boolean;
	flashTitleFn?: (msg: ChatMessage) => string;
	persist?: boolean;
	phrase?: boolean;
	username?: boolean;
	badge?: boolean;
	badgeURL?: string;
	version?: string;
}

interface CompiledHighlight {
	def: HighlightDef;
	kind: "phrase" | "username" | "badge";
	patternLower?: string;
	badgeKey?: string;
	badgeVersion?: string;
}

interface HighlightMatchMemo {
	bodyLower?: string;
	authorLower?: string;
	badgeKeys?: string[];
	badgeValues?: string[];
}

interface LegacyHighlightSoundFields {
	soundPath?: string;
	soundDef?: unknown;
	soundFile?: {
		name: string;
		type: string;
		data: ArrayBuffer;
	};
}

const m = new WeakMap<ChannelContext, ChatHighlights>();

const customHighlights = useConfig<Map<string, HighlightDef>>("highlights.custom");

export function useChatHighlights(ctx: ChannelContext) {
	const visibility = useDocumentVisibility();

	let data = m.get(ctx);
	let needsLegacySoundCleanup = false;
	if (!data) {
		data = reactive<ChatHighlights>({
			highlights: {},
			compiled: {
				all: [],
				phrase: [],
				username: [],
				badge: [],
				worker: [],
			},
			filtered: {
				phrase: reactive({}),
				username: reactive({}),
				badge: reactive({}),
			},
		});

		watch(
			customHighlights,
			(h) => {
				if (!data) return;
				let strippedLegacySound = false;

				// Clear all custom highlights
				for (const [k, v] of Object.entries(data.highlights)) {
					if (!v.persist) continue;

					delete data.highlights[k];
				}

				for (const [, v] of h) {
					const sanitized = sanitizeLegacyHighlight(v);
					data.highlights[sanitized.highlight.id] = sanitized.highlight;
					updateFlashTitle(sanitized.highlight);
					strippedLegacySound = strippedLegacySound || sanitized.stripped;
				}

				rebuildCompiledHighlights();
				needsLegacySoundCleanup = needsLegacySoundCleanup || strippedLegacySound;
			},
			{
				immediate: true,
			},
		);

		m.set(ctx, data);
	}

	const save = debounceFn(function (): void {
		if (!data) return;

		const items: [string, HighlightDef][] = Array.from(Object.values(data.highlights))
			.filter((h) => h.persist)
			.map((h) => [h.id, stripSerializableHighlightFields(h)]);

		customHighlights.value = new Map(items);
	}, 250);

	if (needsLegacySoundCleanup) {
		save();
	}

	function define(id: string, def: Omit<HighlightDef, "id">, persist?: boolean): HighlightDef {
		if (!data) return {} as HighlightDef;

		const h = (data.highlights[id] = { ...def, id, persist });
		updateFlashTitle(h);
		rebuildCompiledHighlights();

		if (!persist) return h;

		// Store to DB
		customHighlights.value.set(id, markRaw(h));
		save();

		return h;
	}

	function updateFlashTitle(h: HighlightDef) {
		h.flashTitleFn = h.flashTitle ? () => ` 💬 Highlight: ${h.label || h.pattern}` : undefined;
	}

	function remove(id: string): void {
		if (!data) return;

		delete data.highlights[id];
		rebuildCompiledHighlights();
		save();
	}

	function checkMatch(key: string, msg: ChatMessage): boolean {
		if (!data) return false;

		const h = data?.highlights[key];
		if (!h) return false;

		return applyHighlightMatch(compileHighlight(h), msg);
	}

	function checkAll(msg: ChatMessage): boolean {
		if (!data) return false;

		let ok = false;
		const memo: HighlightMatchMemo = {};

		for (const highlight of data.compiled.all) {
			if (applyHighlightMatch(highlight, msg, memo)) {
				ok = true;
			}
		}

		return ok;
	}

	function rebuildCompiledHighlights(): void {
		if (!data) return;

		data.compiled.all.length = 0;
		data.compiled.phrase.length = 0;
		data.compiled.username.length = 0;
		data.compiled.badge.length = 0;
		data.compiled.worker.length = 0;

		replaceHighlightRecord(data.filtered.phrase, {});
		replaceHighlightRecord(data.filtered.username, {});
		replaceHighlightRecord(data.filtered.badge, {});

		for (const highlight of Object.values(data.highlights)) {
			const compiled = compileHighlight(highlight);
			data.compiled.all.push(compiled);
			data.compiled.worker.push(toWorkerHighlight(highlight));

			switch (compiled.kind) {
				case "phrase":
					data.compiled.phrase.push(compiled);
					data.filtered.phrase[highlight.id] = highlight;
					break;
				case "username":
					data.compiled.username.push(compiled);
					data.filtered.username[highlight.id] = highlight;
					break;
				case "badge":
					data.compiled.badge.push(compiled);
					data.filtered.badge[highlight.id] = highlight;
					break;
			}
		}
	}

	function compileHighlight(h: HighlightDef): CompiledHighlight {
		const kind = h.username ? "username" : h.badge ? "badge" : "phrase";

		return {
			def: h,
			kind,
			patternLower:
				kind === "phrase" && h.pattern && !h.caseSensitive && !h.regexp ? h.pattern.toLowerCase() : undefined,
			badgeKey: kind === "badge" ? h.pattern?.toLowerCase() : undefined,
			badgeVersion: kind === "badge" ? h.version?.toLowerCase() : undefined,
		};
	}

	function applyHighlightMatch(
		compiled: CompiledHighlight,
		msg: ChatMessage,
		memo: HighlightMatchMemo = {},
	): boolean {
		const h = compiled.def;

		let ok = false;

		if (h.phrase || (!h.phrase && !h.username && !h.badge)) {
			if (h.regexp) {
				let regexp = h.cachedRegExp;
				if (!regexp) {
					try {
						regexp = new RegExp(h.pattern as string, "i");
						Object.defineProperty(h, "cachedRegExp", { value: regexp });
					} catch (err) {
						log.warn("<ChatHighlights>", "Invalid regexp:", h.pattern ?? "");

						msg.setHighlight("#878787", "Error " + (err as Error).message);
						return false;
					}
				}

				ok = regexp.test(msg.body);
			} else if (h.pattern) {
				ok = h.caseSensitive
					? msg.body.includes(h.pattern)
					: getLowerBody(msg, memo).includes(compiled.patternLower ?? h.pattern.toLowerCase());
			} else if (typeof h.test === "function") {
				ok = h.test(msg);
			}
		} else if (h.username) {
			ok = getAuthorLower(msg, memo) === h.pattern?.toLowerCase();
		} else if (h.badge) {
			ok =
				getBadgeKeys(msg, memo).includes(compiled.badgeKey ?? "") &&
				getBadgeValues(msg, memo).includes(compiled.badgeVersion ?? "");
		}

		if (ok) {
			msg.setHighlight(h.color, h.label);

			if (h.flashTitleFn && !msg.historical) {
				setFlash(h, msg);
			}
		}

		return ok;
	}

	// Flash the title when the actor is mentioned
	const newTitle = ref("");
	const lastKnownTitle = ref(document.title);
	let step = 0;
	const titleFlash = useIntervalFn(
		() => {
			useTitle(step++ % 2 === 0 ? newTitle.value : lastKnownTitle.value);
		},
		1000,
		{ immediate: false, immediateCallback: true },
	);

	function setFlash(def: HighlightDef, msg: ChatMessage): void {
		if (!def.flashTitleFn || titleFlash.isActive.value) return;

		lastKnownTitle.value = document.title;
		newTitle.value = def.flashTitleFn(msg);

		titleFlash.resume();

		until(visibility)
			.toBe("visible")
			.then(() => {
				titleFlash.pause();
				newTitle.value = "";
				document.title = lastKnownTitle.value;
			});
	}

	function getAll(): Record<string, HighlightDef> {
		if (!data) return {};

		return toReactive(data.highlights);
	}

	function getAllPhraseHighlights(): Record<string, HighlightDef> {
		if (!data) return {};
		return toReactive(data.filtered.phrase);
	}

	function getAllUsernameHighlights(): Record<string, HighlightDef> {
		if (!data) return {};
		return toReactive(data.filtered.username);
	}

	function getAllBadgeHighlights(): Record<string, HighlightDef> {
		if (!data) return {};
		return toReactive(data.filtered.badge);
	}

	function getWorkerHighlights(): WorkerSafeHighlightDef[] {
		if (!data) return [];

		return data.compiled.worker;
	}

	function updateId(oldId: string, newId: string): void {
		if (!data) return;

		const h = data.highlights[oldId];
		if (!h) return;

		data.highlights[newId] = h;
		delete data.highlights[oldId];

		h.id = newId;

		rebuildCompiledHighlights();
		save();
	}

	return {
		define,
		remove,
		getAll,
		getAllPhraseHighlights,
		getAllUsernameHighlights,
		getAllBadgeHighlights,
		getWorkerHighlights,
		save,
		updateId,
		checkMatch,
		checkAll,
		updateFlashTitle,
	};
}

function stripSerializableHighlightFields(highlight: HighlightDef): HighlightDef {
	const raw = { ...(toRaw(highlight) as HighlightDef & LegacyHighlightSoundFields) };
	delete raw.flashTitleFn;
	delete raw.soundDef;
	delete raw.soundFile;
	delete raw.soundPath;
	return raw;
}

function sanitizeLegacyHighlight(highlight: HighlightDef): {
	highlight: HighlightDef;
	stripped: boolean;
} {
	const raw = { ...(toRaw(highlight) as HighlightDef & LegacyHighlightSoundFields) };
	const stripped = "soundDef" in raw || "soundFile" in raw || "soundPath" in raw;
	delete raw.soundDef;
	delete raw.soundFile;
	delete raw.soundPath;
	return {
		highlight: raw,
		stripped,
	};
}

function replaceHighlightRecord(target: Record<string, HighlightDef>, next: Record<string, HighlightDef>): void {
	for (const key in target) {
		if (!(key in next)) {
			delete target[key];
		}
	}

	for (const [key, value] of Object.entries(next)) {
		target[key] = value;
	}
}

function getLowerBody(msg: ChatMessage, memo: HighlightMatchMemo): string {
	return (memo.bodyLower ??= msg.body.toLowerCase());
}

function getAuthorLower(msg: ChatMessage, memo: HighlightMatchMemo): string {
	return (memo.authorLower ??= msg.author?.displayName.toLowerCase() ?? "");
}

function getBadgeKeys(msg: ChatMessage, memo: HighlightMatchMemo): string[] {
	return (memo.badgeKeys ??= Object.keys(msg.badges).map((value) => value.toLowerCase()));
}

function getBadgeValues(msg: ChatMessage, memo: HighlightMatchMemo): string[] {
	return (memo.badgeValues ??= Object.values(msg.badges).map((value) => value.toLowerCase()));
}

function toWorkerHighlight(h: HighlightDef): WorkerSafeHighlightDef {
	const builtin =
		h.id === "~mention" ? "mention" : h.id === "~reply" ? "reply" : h.id === "~self" ? "self" : undefined;

	return {
		id: h.id,
		color: h.color,
		label: h.label,
		pattern: h.pattern,
		regexp: h.regexp,
		caseSensitive: h.caseSensitive,
		phrase: h.phrase,
		username: h.username,
		badge: h.badge,
		version: h.version,
		builtin,
	};
}
