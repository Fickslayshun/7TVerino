<template>
	<ChatInputCarousel
		v-if="tabState && tabState.currentMatch && shouldRenderAutocompleteCarousel"
		:current-match="tabState.currentMatch"
		:forwards-matches="tabState.forwardsMatches ?? []"
		:backwards-matches="tabState.backwardsMatches ?? []"
		:instance="instance"
		@back="(ev) => handleTabPress(ev, true)"
		@forward="(ev) => handleTabPress(ev, false)"
	/>
</template>

<!-- eslint-disable prettier/prettier -->
<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import { useEventListener, useKeyModifier } from "@vueuse/core";
import { useStore } from "@/store/main";
import { REACT_TYPEOF_TOKEN } from "@/common/Constant";
import { imageHostToSrcset, resolve7TVEmoteFormat } from "@/common/Image";
import { TabToken, getSearchRange } from "@/common/Input";
import { HookedInstance } from "@/common/ReactHooks";
import {
	defineFunctionHook,
	defineNamedEventHandler,
	definePropertyHook,
	unsetNamedEventHandler,
	unsetPropertyHook,
} from "@/common/Reflection";
import { ChatAutocompleteIndex } from "@/common/chat/AutocompleteIndex";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useCosmetics } from "@/composable/useCosmetics";
import { getModule } from "@/composable/useModule";
import { useConfig } from "@/composable/useSettings";
import { useUserAgent } from "@/composable/useUserAgent";
import ChatInputCarousel from "./ChatInputCarousel.vue";

const props = defineProps<{
	instance: HookedInstance<Twitch.ChatAutocompleteComponent>;
}>();

interface AutocompleteResult {
	current: string;
	type: string;
	element: unknown;
	replacement: string;
}

const AUTOCOMPLETION_MODE = {
	OFF: 0,
	COLON: 1,
	ALWAYS_ON: 2,
};

type HookState = {
	mentionProviderHookRefCount: WeakMap<object, number>;
	mentionProviderTabTriggerState: WeakMap<object, boolean>;
	emoteProviderHookRefCount: WeakMap<object, number>;
	emoteProviderTabTriggerState: WeakMap<object, boolean>;
};

const HOOK_STATE_KEY = "__SEVENTV_TWITCH_CHAT_INPUT_HOOK_STATE__";
const hookStateStore = globalThis as typeof globalThis & { [HOOK_STATE_KEY]?: HookState };
const hookState =
	hookStateStore[HOOK_STATE_KEY] ??
	(hookStateStore[HOOK_STATE_KEY] = {
		mentionProviderHookRefCount: new WeakMap<object, number>(),
		mentionProviderTabTriggerState: new WeakMap<object, boolean>(),
		emoteProviderHookRefCount: new WeakMap<object, number>(),
		emoteProviderTabTriggerState: new WeakMap<object, boolean>(),
	});

const mentionProviderHookRefCount = hookState.mentionProviderHookRefCount;
const mentionProviderTabTriggerState = hookState.mentionProviderTabTriggerState;
const emoteProviderHookRefCount = hookState.emoteProviderHookRefCount;
const emoteProviderTabTriggerState = hookState.emoteProviderTabTriggerState;

function retainHook(target: object, map: WeakMap<object, number>, onFirst: () => void): void {
	const count = map.get(target) ?? 0;
	if (count === 0) {
		onFirst();
	}

	map.set(target, count + 1);
}

function releaseHook(target: object, map: WeakMap<object, number>, onLast: () => void): void {
	const count = map.get(target);
	if (!count) return;

	if (count <= 1) {
		map.delete(target);
		onLast();
		return;
	}

	map.set(target, count - 1);
}

const mod = getModule<"TWITCH", "chat-input">("chat-input");
const store = useStore();
const ctx = useChannelContext(props.instance.component.componentRef.props.channelID, true);
const messages = useChatMessages(ctx);
const emotes = useChatEmotes(ctx);
const performance = useChatPerformance(ctx);
const cosmetics = useCosmetics(store.identity?.id ?? "");
const ua = useUserAgent();
const autocompleteIndex = new ChatAutocompleteIndex();
const autocompleteIndexState = {
	dirty: true,
};

const autocompletionMode = useConfig("chat_input.autocomplete.colon");
const shouldColonCompleteEmoji = useConfig("chat_input.autocomplete.colon.emoji");
const shouldAutocompleteChatters = useConfig<boolean>("chat_input.autocomplete.chatters");
const shouldRenderAutocompleteCarousel = useConfig("chat_input.autocomplete.carousel");
const colonCompletionMode = useConfig<number>("chat_input.autocomplete.colon.mode");
const tabCompletionMode = useConfig<number>("chat_input.autocomplete.carousel.mode");

const providers = ref<Record<string, Twitch.ChatAutocompleteProvider>>({});
type MentionProvider = Twitch.ChatAutocompleteProvider<"mention">;
type EmoteProvider = Twitch.ChatAutocompleteProvider<"emote">;
let attachedMentionProvider: MentionProvider | null = null;
let attachedEmoteProvider: EmoteProvider | null = null;

const TAB_AROUND_MATCH_COUNT = 3;
const tabState = ref<
	| {
			index: number;
			matches: TabToken[];
			currentMatch: TabToken;
			forwardsMatches: TabToken[];
			backwardsMatches: TabToken[];
			expectedPath: number[];
			expectedOffset: number;
			expectedWord: string;
	  }
	| undefined
>();
const tabCycleOwned = ref(false);

const textValue = ref("");
const awaitingUpdate = ref(false);
const forceResetOnNextEditableUpdate = ref(false);

const preHistory = ref<Twitch.ChatSlateLeaf[] | undefined>();
const history = ref<Twitch.ChatSlateLeaf[][]>([]);
const historyLocation = ref(-1);

const isCtrl = useKeyModifier("Control");
const isShift = useKeyModifier("Shift");

useEventListener(window, "keydown", handleCapturedKeyDown, { capture: true });

watch(
	() => performance.enabled.value,
	() => {
		autocompleteIndexState.dirty = true;
	},
	{ immediate: true },
);

watch(
	() => [
		Object.keys(cosmetics.emotes).join("|"),
		Object.entries(emotes.providers)
			.filter(([provider]) => provider !== "EMOJI")
			.map(
				([provider, sets]) =>
					`${provider}:${Object.entries(sets)
						.map(([id, set]) => `${id}:${set.emotes.length}`)
						.join(",")}`,
			)
			.join("|"),
		Object.keys(emotes.emojis).length,
		Object.keys(messages.chatters).length,
	],
	() => {
		autocompleteIndexState.dirty = true;
	},
);

function ensureAutocompleteIndex(): void {
	if (!performance.enabled.value || !autocompleteIndexState.dirty) return;

	autocompleteIndex.rebuild({
		personalEmotes: cosmetics.emotes,
		activeEmotes: emotes.active,
		providers: emotes.providers,
		emojis: emotes.emojis,
		chatters: messages.chatters,
	});
	autocompleteIndexState.dirty = false;
}

function findMatchingTokens(str: string, mode: "tab" | "colon" = "tab", limit?: number): TabToken[] {
	const usedTokens = new Set<string>();

	const matches: TabToken[] = [];

	// Test modes
	// 0: startsWith
	// 1: includes
	const testMode = mode === "tab" ? tabCompletionMode.value : colonCompletionMode.value;

	const prefix = str.toLowerCase();
	const test = (token: string) =>
		({
			0: token.toLowerCase().startsWith(prefix),
			1: token.toLowerCase().includes(prefix),
		})[testMode];

	if (performance.enabled.value) {
		ensureAutocompleteIndex();
		return autocompleteIndex.query(str, {
			mode,
			matchMode: testMode as 0 | 1,
			includeChatters: shouldAutocompleteChatters.value,
			limit,
		});
	}

	for (const [token, ae] of Object.entries(cosmetics.emotes)) {
		if (usedTokens.has(token) || !test(token)) continue;

		usedTokens.add(token);
		matches.push({
			token,
			priority: 1,
			item: ae,
		});
	}

	for (const [provider, sets] of Object.entries(emotes.providers)) {
		if (provider == "EMOJI") continue;

		for (const [, set] of Object.entries(sets)) {
			for (const emote of set.emotes) {
				const token = emote.name;

				if (usedTokens.has(token) || !test(token)) continue;

				usedTokens.add(token);
				matches.push({
					token,
					priority: 2,
					item: emote,
				});
			}
		}
	}

	if (mode === "colon") {
		for (const [token] of Object.entries(emotes.emojis)) {
			if (usedTokens.has(token) || !test(token)) continue;

			usedTokens.add(token);
			matches.push({
				token,
				priority: 4,
			});
		}
	}

	if (shouldAutocompleteChatters.value && mode === "tab") {
		const tokenStartsWithAt = prefix.startsWith("@");
		const lPrefix = prefix.replace("@", "");

		const chatters = Object.entries(messages.chatters);
		for (const [, chatter] of chatters) {
			if (usedTokens.has(chatter.displayName) || !chatter.displayName.toLowerCase().startsWith(lPrefix)) continue;

			matches.push({
				token: (tokenStartsWithAt ? "@" : "") + chatter.displayName,
				priority: 10,
			});
		}
	}

	matches.sort((a, b) => a.priority + b.priority * (a.token.localeCompare(b.token) / 0.5));
	if (typeof limit === "number" && matches.length > limit) matches.length = limit;

	return matches;
}

function pathsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}

	return true;
}

function comparePaths(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] === b[i]) continue;
		return a[i] < b[i] ? -1 : 1;
	}

	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

function comparePoints(a: { path: number[]; offset: number }, b: { path: number[]; offset: number }): number {
	const pathOrder = comparePaths(a.path, b.path);
	if (pathOrder !== 0) return pathOrder;

	if (a.offset === b.offset) return 0;
	return a.offset < b.offset ? -1 : 1;
}

function getSlateSelection():
	| {
			anchor: { path: number[]; offset: number };
			focus: { path: number[]; offset: number };
	  }
	| undefined {
	const selection = props.instance.component.componentRef.state?.slateEditor?.selection;
	if (!selection?.anchor || !selection?.focus) return;

	return selection;
}

function isSlateSelectionRange(): boolean {
	const selection = getSlateSelection();
	if (!selection) return false;

	return comparePoints(selection.anchor, selection.focus) !== 0;
}

function isSpaceKey(ev: KeyboardEvent): boolean {
	return ev.key === " " || ev.key === "Space" || ev.key === "Spacebar" || ev.code === "Space";
}

function isModifierOnlyKey(key: string): boolean {
	return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

function isSelectAllShortcut(ev: KeyboardEvent): boolean {
	return (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === "a" || ev.key === "A");
}

function isEventFromChatRoot(ev: Event): boolean {
	const rootNode = props.instance.domNodes.root;
	if (!(rootNode instanceof HTMLElement)) return false;

	const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
	if (path.length > 0) {
		return path.includes(rootNode);
	}

	const target = ev.target;
	return target instanceof Node ? rootNode.contains(target) : false;
}

function isAutocompleteTrayOpen(): boolean {
	const tray = props.instance.component.props?.tray;
	return !!tray && (tray.type as string) === "autocomplete-tray";
}

function closeAutocompleteTray(): void {
	if (!isAutocompleteTrayOpen()) return;

	try {
		const setTray = props.instance.component.props?.setTray as
			| ((v?: Twitch.ChatTray | null) => unknown)
			| undefined;
		setTray?.(null);
	} catch {
		// noop
	}
}

function stripInputEmoteSets(propsValue: unknown): void {
	if (!propsValue || typeof propsValue !== "object") return;

	const v = propsValue as { emotes?: Twitch.TwitchEmoteSet[] };
	if (Array.isArray(v.emotes) && v.emotes.length > 0) {
		v.emotes = [];
	}
}

function stripProviderEmoteSets(propsValue: unknown): void {
	if (!propsValue || typeof propsValue !== "object") return;

	const v = propsValue as { emote?: { emotes?: Twitch.TwitchEmoteSet[] } };
	if (Array.isArray(v.emote?.emotes) && v.emote.emotes.length > 0) {
		v.emote.emotes = [];
	}
}

function hasActiveTabCycle(): boolean {
	return !!tabState.value || (tabCycleOwned.value && isAutocompleteTrayOpen());
}

function clearTabCycle(closeTray = false): void {
	tabState.value = undefined;
	tabCycleOwned.value = false;

	if (closeTray) {
		closeAutocompleteTray();
	}
}

function normalizeTabMatchToken(token: string): string {
	return token.trimEnd();
}

function markForceResetForUserRangeEdit(closeTray = false): void {
	forceResetOnNextEditableUpdate.value = true;
	clearTabCycle(closeTray);
}

function commitTabCycleSpace(ev: KeyboardEvent): boolean {
	if (!hasActiveTabCycle() || !isEventFromChatRoot(ev)) return false;

	const slate = props.instance.component.componentRef.state?.slateEditor;
	const sel = slate?.selection;
	if (slate && sel?.anchor && sel.focus) {
		const end = comparePoints(sel.anchor, sel.focus) >= 0 ? sel.anchor : sel.focus;
		slate.apply({ type: "set_selection", newProperties: { anchor: end, focus: end } });
	}

	clearTabCycle(true);

	// Own Space commit while tab-cycling so native handlers cannot desync state.
	ev.preventDefault();
	ev.stopImmediatePropagation();
	ev.stopPropagation();

	if (slate) {
		awaitingUpdate.value = true;
		slate.insertText(" ");
	}

	return true;
}

function handleTabPress(ev: KeyboardEvent | null, isBackwards?: boolean): void {
	tabCycleOwned.value = false;

	if (ev) {
		ev.preventDefault();
		ev.stopImmediatePropagation();
		ev.stopPropagation();
	}

	const slate = props.instance.component.componentRef.state?.slateEditor;
	if (!slate) {
		tabState.value = undefined;
		return;
	}

	// Phase 1: Extract cursor token context
	const selection = slate.selection;
	const anchor = selection?.anchor;
	const focus = selection?.focus;
	if (!anchor || !focus) {
		tabState.value = undefined;
		return;
	}

	const cursor = focus;

	let currentNode: { children: Twitch.ChatSlateLeaf[] } & Partial<Twitch.ChatSlateLeaf> = slate;
	for (const i of cursor.path) {
		if (!currentNode.children?.[i]) {
			tabState.value = undefined;
			return;
		}

		currentNode = currentNode.children[i];
	}

	if (currentNode.type !== "text" || typeof currentNode.text !== "string") {
		tabState.value = undefined;
		return;
	}

	const searchText = currentNode.text;
	let lookupOffset = cursor.offset;

	if (pathsEqual(anchor.path, focus.path)) {
		lookupOffset = Math.max(anchor.offset, focus.offset);
	}

	// Keep lookup inside the active token to avoid boundary ambiguity.
	if (
		lookupOffset > 0 &&
		lookupOffset < searchText.length &&
		searchText.charAt(lookupOffset - 1) === " " &&
		searchText.charAt(lookupOffset) !== " "
	) {
		lookupOffset += 1;
	}

	const [wordStart, wordEnd] = getSearchRange(searchText, lookupOffset);
	const currentWord = searchText.substring(wordStart, wordEnd);
	const currentToken = currentWord.trimEnd();

	if (!currentToken) {
		tabState.value = undefined;
		return;
	}

	// Phase 2: Resolve match list source
	const previousMatches = tabState.value?.matches ?? [];
	let matches = previousMatches;
	let currentIndex = -1;
	if (
		tabState.value &&
		normalizeTabMatchToken(tabState.value.currentMatch.token) === normalizeTabMatchToken(currentToken)
	) {
		currentIndex = tabState.value.index;
	} else {
		currentIndex = previousMatches.findIndex(
			(m) => normalizeTabMatchToken(m.token) === normalizeTabMatchToken(currentToken),
		);
	}

	if (currentIndex < 0) {
		matches = findMatchingTokens(currentToken, "tab");
	}

	if (matches.length === 0) {
		tabState.value = undefined;
		return;
	}

	// Phase 3: Advance index
	let nextIndex = currentIndex;
	if (nextIndex < 0) {
		nextIndex = isBackwards ? matches.length - 1 : 0;
	} else {
		nextIndex = isBackwards ? nextIndex - 1 : nextIndex + 1;
		nextIndex %= matches.length;
		if (nextIndex < 0) nextIndex = matches.length - 1;
	}

	const match = matches[nextIndex];
	if (!match) {
		tabState.value = undefined;
		return;
	}

	// Phase 4: Apply replacement + persist cycle state
	const isPlatformMatch = match.item?.provider === "PLATFORM";
	const replacement = isPlatformMatch || match.token.endsWith(" ") ? match.token : `${match.token} `;

	awaitingUpdate.value = true;

	slate.apply({ type: "remove_text", path: cursor.path, offset: wordStart, text: currentWord });
	slate.apply({ type: "insert_text", path: cursor.path, offset: wordStart, text: replacement });

	const newOffset = wordStart + replacement.length;
	const newCursor = { path: cursor.path, offset: newOffset };
	slate.apply({ type: "set_selection", newProperties: { anchor: newCursor, focus: newCursor } });

	const backwardsMatches = matches.slice(Math.max(0, nextIndex - TAB_AROUND_MATCH_COUNT), nextIndex);
	const forwardsMatches = matches.slice(nextIndex + 1, nextIndex + TAB_AROUND_MATCH_COUNT + 1);

	if (forwardsMatches.length < TAB_AROUND_MATCH_COUNT) {
		forwardsMatches.push(
			...matches.slice(0, TAB_AROUND_MATCH_COUNT - forwardsMatches.length).filter((tok) => tok !== match),
		);
	}

	if (backwardsMatches.length < TAB_AROUND_MATCH_COUNT) {
		backwardsMatches.unshift(
			...matches.slice(backwardsMatches.length - TAB_AROUND_MATCH_COUNT).filter((tok) => tok !== match),
		);
	}

	tabState.value = {
		index: nextIndex,
		matches,
		currentMatch: match,
		backwardsMatches,
		forwardsMatches,
		expectedOffset: newOffset,
		expectedPath: [...cursor.path],
		expectedWord: replacement,
	};
	tabCycleOwned.value = true;
}

function pushHistory() {
	const component = props.instance.component;

	const slateComponent = component.componentRef;

	const slate = slateComponent.state?.slateEditor;
	if (!slate) return;

	history.value.unshift(slate.children);
	history.value.splice(9, Infinity);

	resetState();
}

function useHistory(backwards = true): boolean {
	const component = props.instance.component;

	const slateComponent = component.componentRef;

	const slate = slateComponent.state?.slateEditor;
	if (!slate) return false;

	const hist = history.value;
	let location = historyLocation.value;

	if (backwards) {
		location += 1;
	} else {
		location -= 1;
	}

	if (location < -1 || hist.length < location) {
		return false;
	}

	if (!preHistory.value) {
		preHistory.value = slate.children;
	}

	let value: Twitch.ChatSlateLeaf[] | undefined;
	if (location < 0) {
		value = preHistory.value;
	} else {
		value = hist[location];
	}

	if (value) {
		awaitingUpdate.value = true;

		if (backwards && (slate.selection?.focus.offset ?? 0) > 1) {
			return false;
		} else if (!backwards && (slate.selection?.focus.offset ?? 0) < textValue.value.length) {
			return false;
		}

		for (const i in slate.children) {
			slate.apply({ type: "remove_node", path: [i], node: slate.children[i] });
		}

		for (const i in value) {
			slate.apply({ type: "insert_node", path: [i], node: value[i] });
		}

		const lastChildPath: number[] = [];
		let lastChild: Twitch.ChatSlateLeaf | undefined;
		if (value.length > 0) {
			const index = value.length - 1;

			lastChildPath.push(index);
			lastChild = value[index];

			while (lastChild && lastChild.children && lastChild.children.length > 0) {
				const index: number = lastChild.children.length - 1;

				lastChildPath.push(index);
				lastChild = lastChild.children[index];
			}
		}

		let endOffset = 0;
		if (lastChild && lastChild.type == "text" && lastChild.text) {
			endOffset = lastChild.text.length;
		}

		const newCursor = { path: lastChildPath, offset: endOffset };
		slate.apply({ type: "set_selection", newProperties: { anchor: newCursor, focus: newCursor } });

		historyLocation.value = location;

		return true;
	}

	return false;
}

function resetState() {
	historyLocation.value = -1;
	preHistory.value = undefined;
	clearTabCycle();
}

function onKeyDown(ev: KeyboardEvent) {
	if (ev.isComposing) return;

	const isTypingCharacter = ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
	if (isTypingCharacter && isSlateSelectionRange()) {
		markForceResetForUserRangeEdit();
		return;
	}

	if (isSelectAllShortcut(ev)) {
		markForceResetForUserRangeEdit(true);
		return;
	}

	if ((ev.key === "Backspace" || ev.key === "Delete") && isSlateSelectionRange()) {
		markForceResetForUserRangeEdit(true);
		return;
	}

	if (isSpaceKey(ev) && commitTabCycleSpace(ev)) {
		return;
	}

	if (hasActiveTabCycle() && (ev.key === "Backspace" || ev.key === "Delete" || ev.key === "Escape")) {
		clearTabCycle();
		return;
	}

	switch (ev.key) {
		case "Tab":
			handleTabPress(ev, isShift.value ?? undefined);
			break;
		case "ArrowUp":
			if (useHistory(true)) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
			}
			break;
		case "ArrowDown":
			if (useHistory(false)) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
			}
			break;
		default:
			if (
				hasActiveTabCycle() &&
				!isModifierOnlyKey(ev.key) &&
				ev.key !== "ArrowLeft" &&
				ev.key !== "ArrowRight"
			) {
				clearTabCycle();
			}
			break;
	}
}

function handleCapturedKeyDown(ev: KeyboardEvent) {
	if (ev.isComposing) return;

	if (!isEventFromChatRoot(ev)) return;

	const isTypingCharacter = ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
	if (isTypingCharacter && isSlateSelectionRange()) {
		markForceResetForUserRangeEdit();
		return;
	}

	if (isSelectAllShortcut(ev)) {
		markForceResetForUserRangeEdit(true);
		return;
	}

	if ((ev.key === "Backspace" || ev.key === "Delete") && isSlateSelectionRange()) {
		markForceResetForUserRangeEdit(true);
		return;
	}

	if (isSpaceKey(ev) && commitTabCycleSpace(ev)) {
		return;
	}

	if (hasActiveTabCycle() && (ev.key === "Backspace" || ev.key === "Delete" || ev.key === "Escape")) {
		clearTabCycle();
		return;
	}

	// Prevents autocompletion on Enter when completion mode is -> always on
	if (ev.key === "Enter") {
		const component = props.instance.component as Twitch.ChatAutocompleteComponent;
		const activeTray: Twitch.ChatTray = component.props.tray;
		const slate = component.componentRef.state?.slateEditor;

		// Exit if autocomplete is not always on or anything needed is unavailable
		if (
			autocompletionMode.value !== AUTOCOMPLETION_MODE.ALWAYS_ON ||
			!activeTray ||
			(activeTray.type as string) !== "autocomplete-tray" ||
			!slate ||
			!slate.selection?.anchor
		) {
			return;
		}

		// Prevents autocompletion
		ev.preventDefault();
		ev.stopImmediatePropagation();
		ev.stopPropagation();

		// Close autocomplete tray by adding a space
		const cursorLocation = slate.selection.anchor;

		let currentNode: { children: Twitch.ChatSlateLeaf[] } & Partial<Twitch.ChatSlateLeaf> = slate;

		for (const index of cursorLocation.path) {
			if (!currentNode) break;
			currentNode = currentNode.children[index];
		}

		const currentWordEnd =
			currentNode.type === "text" && typeof currentNode.text === "string"
				? getSearchRange(currentNode.text, cursorLocation.offset)[1]
				: 0;
		const newCursor = { path: cursorLocation.path, offset: currentWordEnd };

		slate.apply({ type: "set_selection", newProperties: { anchor: newCursor, focus: newCursor } });
		slate.apply({
			type: "insert_text",
			path: cursorLocation.path,
			offset: currentWordEnd,
			text: " ",
		});
	}
}

function getMatchesHook(this: unknown, native: ((...args: unknown[]) => object[]) | null, str: string, ...args: []) {
	try {
		if (autocompletionMode.value === AUTOCOMPLETION_MODE.OFF) return;

		if (autocompletionMode.value === AUTOCOMPLETION_MODE.COLON && !str.startsWith(":")) return;

		const search = str.startsWith(":") ? str.substring(1) : str;

		if (search.length < 2) {
			return;
		}

		let nativeResults: unknown[] = [];
		try {
			nativeResults = (native?.call(this, `:${search}`, ...args) ?? []) as unknown[];
		} catch {
			nativeResults = [];
		}

		const results = (Array.isArray(nativeResults) ? nativeResults : []) as AutocompleteResult[];

		if (autocompletionMode.value === AUTOCOMPLETION_MODE.ALWAYS_ON) {
			results.forEach((r) => (r.current = str));
		}

		const allEmotes = { ...cosmetics.emotes, ...emotes.active, ...emotes.emojis };

		const tokens = findMatchingTokens(search, "colon", 25);

		for (let i = tokens.length - 1; i > -1; i--) {
			const token = tokens[i].token;
			const emote = tokens[i].item ?? allEmotes[token];
			const replacement = emote?.unicode ?? token;

			if (results.some((r) => r.replacement === replacement)) continue;

			if (!emote || (!shouldColonCompleteEmoji.value && emote.provider == "EMOJI")) {
				continue;
			}

			try {
				const providerName = emote.provider ?? "";
				const providerData = providerName.split("/") ?? ["", ""];
				let provider = providerData[0] ?? providerName;

				switch (emote.scope) {
					case "GLOBAL":
						provider = provider?.concat(" Global");
						break;
					case "PERSONAL":
						provider = provider?.concat(" Personal");
						break;
				}

				let srcset = "";
				if (emote.provider !== "EMOJI") {
					const host = emote.data?.host;
					if (!host || !host.url || !Array.isArray(host.files)) {
						continue;
					}

					srcset =
						emote.provider === "7TV"
							? imageHostToSrcset(host, "7TV", resolve7TVEmoteFormat(host, ua.preferredFormat))
							: host.srcset ?? imageHostToSrcset(host, emote.provider, ua.preferredFormat);
				}

				results.unshift({
					type: "emote",
					current: str,
					element: [
						emote.provider === "EMOJI"
							? {
									[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
									ref: null,
									key: `emote-icon-${emote.id}`,
									type: "svg",
									props: {
										style: {
											width: "3em",
											height: "3em",
											padding: "0.5rem",
										},
										viewBox: "0 0 36 36",
										children: [
											{
												[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
												ref: null,
												key: `emote-text-${emote.id}-text`,
												type: "use",
												props: {
													href: `#${emote.id}`,
												},
											},
										],
									},
							  }
							: {
									[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
									ref: null,
									key: `emote-img-${emote.id}`,
									type: "img",
									props: {
										style: {
											padding: "0.5rem",
										},
										srcset: srcset,
									},
							  },
						{
							[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
							ref: null,
							key: `emote-text-${emote.id}`,
							type: "span",
							props: {
								children: `${emote.name}`,
								style: { "margin-right": "0.25rem" },
							},
						},
						{
							[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
							ref: null,
							key: `emote-provider-${emote.id}`,
							type: "span",
							props: {
								children: `(${provider})`,
								class: [`brand-color-${(providerData[0] ?? "").toLowerCase()}`],
							},
						},
					],
					replacement: replacement,
				});
			} catch {
				continue;
			}
		}

		return results.length > 0 ? results : undefined;
	} catch {
		return;
	}
}

watch(
	() => props.instance.domNodes.root,
	(node, old) => {
		if (node === old) return;

		if (old instanceof HTMLElement) {
			unsetNamedEventHandler(old, "ChatAutoComplete", "keydown");
		}

		if (node instanceof HTMLElement) {
			defineNamedEventHandler(node, "ChatAutoComplete", "keydown", onKeyDown, true);
		}
	},
	{ immediate: true },
);

defineFunctionHook(
	props.instance.component,
	"onEditableValueUpdate",
	function (old, value: string, sendOnUpdate?: boolean, ...args: unknown[]) {
		if (forceResetOnNextEditableUpdate.value) {
			forceResetOnNextEditableUpdate.value = false;
			awaitingUpdate.value = false;
			resetState();
			syncProviders();
		}

		if (sendOnUpdate) {
			pushHistory();

			// Put the previous input back in if the user was pressing control
			if (isCtrl.value) {
				setTimeout(() => useHistory(true), 0);
			}
		}

		if (!awaitingUpdate.value) {
			resetState();
		}

		awaitingUpdate.value = false;
		textValue.value = value;

		return old?.call(this, value, sendOnUpdate, ...args);
	},
);

definePropertyHook(props.instance.component, "props", {
	value(v) {
		stripInputEmoteSets(v);
	},
});

definePropertyHook(props.instance.component.componentRef, "props", {
	value(v) {
		stripInputEmoteSets(v);
	},
});

function attachMentionProvider(provider: MentionProvider): void {
	providers.value.mention = provider;
	retainHook(provider, mentionProviderHookRefCount, () => {
		mentionProviderTabTriggerState.set(provider, provider.canBeTriggeredByTab);
		provider.canBeTriggeredByTab = false;

		definePropertyHook(provider, "props", {
			value(v) {
				const handler = v?.activeChattersAPI?.handleMessage;
				if (handler) {
					messages.handlers.add(handler);
				}
			},
		});
	});
}

function detachMentionProvider(provider: MentionProvider): void {
	releaseHook(provider, mentionProviderHookRefCount, () => {
		provider.canBeTriggeredByTab = mentionProviderTabTriggerState.get(provider) ?? true;
		mentionProviderTabTriggerState.delete(provider);
		unsetPropertyHook(provider, "props");
	});

	if (providers.value.mention === provider) {
		delete providers.value.mention;
	}
}

function attachEmoteProvider(provider: EmoteProvider): void {
	providers.value.emote = provider;
	retainHook(provider, emoteProviderHookRefCount, () => {
		emoteProviderTabTriggerState.set(provider, provider.canBeTriggeredByTab);
		provider.canBeTriggeredByTab = false;

		definePropertyHook(provider, "props", {
			value(v) {
				stripProviderEmoteSets(v);
			},
		});

		defineFunctionHook(provider, "getMatches", getMatchesHook);
	});
}

function detachEmoteProvider(provider: EmoteProvider): void {
	releaseHook(provider, emoteProviderHookRefCount, () => {
		provider.canBeTriggeredByTab = emoteProviderTabTriggerState.get(provider) ?? true;
		emoteProviderTabTriggerState.delete(provider);
		unsetPropertyHook(provider, "props");
		unsetPropertyHook(provider, "getMatches");
	});

	if (providers.value.emote === provider) {
		delete providers.value.emote;
	}
}

function syncProviders(): void {
	const mentionProvider = props.instance.component.providers.find(
		(provider) => provider.autocompleteType == "mention",
	) as MentionProvider | undefined;
	const emoteProvider = props.instance.component.providers.find(
		(provider) => provider.autocompleteType == "emote",
	) as EmoteProvider | undefined;

	// Avoid detaching on transient missing providers during Twitch rerenders.
	if (attachedMentionProvider && mentionProvider && attachedMentionProvider !== mentionProvider) {
		detachMentionProvider(attachedMentionProvider);
		attachedMentionProvider = null;
	}
	if (attachedEmoteProvider && emoteProvider && attachedEmoteProvider !== emoteProvider) {
		detachEmoteProvider(attachedEmoteProvider);
		attachedEmoteProvider = null;
	}

	if (mentionProvider && attachedMentionProvider !== mentionProvider) {
		attachMentionProvider(mentionProvider);
		attachedMentionProvider = mentionProvider;
	}
	if (emoteProvider && attachedEmoteProvider !== emoteProvider) {
		attachEmoteProvider(emoteProvider);
		attachedEmoteProvider = emoteProvider;
	}

	// Re-assert tab-trigger ownership in case Twitch mutates providers in-place.
	if (attachedMentionProvider && attachedMentionProvider.canBeTriggeredByTab) {
		attachedMentionProvider.canBeTriggeredByTab = false;
	}
	if (attachedEmoteProvider && attachedEmoteProvider.canBeTriggeredByTab) {
		attachedEmoteProvider.canBeTriggeredByTab = false;
	}
}

syncProviders();

defineFunctionHook(props.instance.component, "componentDidUpdate", function (this, old, ...args: unknown[]) {
	syncProviders();

	if (mod?.instance && typeof this.props.setTray === "function") {
		mod.instance.setTray = this.props.setTray;
		mod.instance.setModifierTray = this.props.setModifierTray;
		mod.instance.clearModifierTray = this.props.clearModifierTray;
	}

	return old?.call(this, ...args);
});

onUnmounted(() => {
	const component = props.instance.component;

	unsetPropertyHook(component, "onEditableValueUpdate");
	unsetPropertyHook(component, "componentDidUpdate");
	unsetPropertyHook(component, "props");
	if (component.componentRef) {
		unsetPropertyHook(component.componentRef, "props");
	}

	const rootNode = props.instance.domNodes.root;
	if (rootNode instanceof HTMLElement) {
		unsetNamedEventHandler(rootNode, "ChatAutoComplete", "keydown");
	}

	if (attachedMentionProvider) {
		detachMentionProvider(attachedMentionProvider);
		attachedMentionProvider = null;
	}
	if (attachedEmoteProvider) {
		detachEmoteProvider(attachedEmoteProvider);
		attachedEmoteProvider = null;
	}
});
</script>
