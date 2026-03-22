<!-- eslint-disable no-fallthrough -->
<template>
	<Teleport v-if="ctx.id" :to="containerEl">
		<TVerinoChatShell
			v-if="tverinoEnabled"
			:header-container="headerContainerEl"
			:input-container="inputContainerEl"
			:active-target="tverinoActiveTarget"
			:native-input-status="nativeTVerinoInputStatus"
			:native-tray-state="nativeTVerinoTrayState"
			:native-send-message="sendNativeTVerinoMessage"
			:set-active-target="setTVerinoActiveTarget"
			:current-ctx="ctx"
			:list="list"
			:restrictions="restrictions"
			:message-handler="messageHandler"
			:shared-chat-data="sharedChatDataByChannelID"
		/>
		<template v-else>
			<UiScrollable
				ref="scrollerRef"
				class="seventv-chat-scroller"
				:style="{ fontFamily: properties.fontAprilFools }"
				@container-scroll="scroller.onScroll"
				@container-wheel="scroller.onWheel"
				@mouseenter="properties.hovering = true"
				@mouseleave="properties.hovering = false"
			>
				<div id="seventv-message-container" class="seventv-message-container">
					<ChatList
						ref="chatList"
						:list="list"
						:restrictions="restrictions"
						:shared-chat-data="sharedChatDataByChannelID"
						:message-handler="messageHandler"
						:force-hydrated="forceStandardHydration"
					/>
				</div>

				<!-- New Messages during Scrolling Pause -->
				<div v-if="scroller.paused" class="seventv-message-buffer-notice" @click="scroller.unpause">
					<PauseIcon />

					<span
						v-if="scroller.pauseBuffer.length"
						:class="{ capped: scroller.pauseBuffer.length >= lineLimit }"
					>
						{{ scroller.pauseBuffer.length }}
					</span>
					<span>{{ scroller.pauseBuffer.length > 0 ? "new messages" : "Chat Paused" }}</span>
				</div>
			</UiScrollable>

			<!-- Data Logic -->
			<ChatData v-if="ctx.loaded" />
		</template>
	</Teleport>

	<ChatTray />
	<ChatPubSub />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onUnmounted, ref, toRaw, toRefs, watch, watchEffect } from "vue";
import { refDebounced, until, useTimeout } from "@vueuse/core";
import { useStore } from "@/store/main";
import { ObserverPromise } from "@/common/Async";
import { log } from "@/common/Logger";
import { HookedInstance, awaitComponents } from "@/common/ReactHooks";
import { defineFunctionHook, definePropertyHook, unsetPropertyHook } from "@/common/Reflection";
import { ChatMessage } from "@/common/chat/ChatMessage";
import {
	DEFAULT_PERSONAL_TIMEOUT_DURATION,
	formatTimeoutNotice,
	parseTimeoutDuration,
} from "@/common/chat/timeoutPresets";
import { ChannelContext, ChannelRole, useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatMessageProcessor } from "@/composable/chat/useChatMessageProcessor";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useChatScroller } from "@/composable/chat/useChatScroller";
import { useChatTools } from "@/composable/chat/useChatTools";
import { usePersonalTimeouts } from "@/composable/chat/usePersonalTimeouts";
import { useRecentSentEmotes } from "@/composable/chat/useRecentSentEmotes";
import { getModule } from "@/composable/useModule";
import { useConfig } from "@/composable/useSettings";
import { useWorker } from "@/composable/useWorker";
import { MessagePartType, MessageType } from "@/site/twitch.tv";
import ChatList from "@/site/twitch.tv/modules/chat/ChatList.vue";
import PauseIcon from "@/assets/svg/icons/PauseIcon.vue";
import ChatPubSub from "./ChatPubSub.vue";
import TVerinoChatShell from "./TVerinoChatShell.vue";
import ChatTray from "./components/tray/ChatTray.vue";
import { getTVerinoSelfMessageState } from "./tverinoPendingMessage";
import { resolveTVerinoRemoteContext } from "./tverinoRemoteContexts";
import { setTwitchHelixAuth } from "./twitchHelixAuth";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import ChatData from "@/app/chat/ChatData.vue";
import BasicSystemMessage from "@/app/chat/msg/BasicSystemMessage.vue";
import UiScrollable from "@/ui/UiScrollable.vue";

const props = defineProps<{
	controller: HookedInstance<Twitch.ChatControllerComponent>;
	room: HookedInstance<Twitch.ChatRoomComponent>;
	list: HookedInstance<Twitch.ChatListComponent>;
	buffer?: HookedInstance<Twitch.MessageBufferComponent>;
	events?: HookedInstance<Twitch.ChatEventComponent>;
	presentation?: HookedInstance<Twitch.ChatListPresentationComponent>;
	restrictions?: HookedInstance<Twitch.ChatRestrictionsComponent>;
}>();

const mod = getModule<"TWITCH", "chat">("chat")!;
const { sendMessage: sendWorkerMessage } = useWorker();
const store = useStore();
const { sendChatMessage: sendTVerinoChatMessage, emitLocalMessage: emitTVerinoLocalMessage, getStatus } =
	useTVerinoChatTransport();

const { list, controller, room, presentation } = toRefs(props);

const el = document.createElement("seventv-container");
el.id = "seventv-chat-controller";

const chatList = ref<InstanceType<typeof ChatList> | undefined>();
const containerEl = ref<HTMLElement>(el);
const headerHostEl = document.createElement("seventv-container");
headerHostEl.id = "seventv-tverino-header";
const headerContainerEl = ref<HTMLElement>(headerHostEl);
const alertHostEl = document.createElement("seventv-container");
alertHostEl.id = "seventv-tverino-alerts";
const inputHostEl = document.createElement("seventv-container");
inputHostEl.id = "seventv-tverino-input";
const inputContainerEl = ref<HTMLElement>(inputHostEl);
const TVERINO_ACTIVE_VIEWPORT_CLASS = "seventv-tverino-active-viewport";
const TVERINO_INPUT_ALERT_ACTIVE_CLASS = "seventv-tverino-has-native-alert";
const NATIVE_PRIVATE_CALLOUT_SELECTOR = [
	'[data-test-selector="chat-private-callout-queue__callout-container"]',
	'[data-a-target="chat-private-callout__primary-button"]',
].join(", ");
const NATIVE_SHARE_RESUB_TRAY_SELECTOR = ".chat-input-tray__open";

interface NativeTVerinoTrayState {
	active: boolean;
	sendHandlerType: string;
	placeholder: string;
	sendButtonLabel: string;
	allowEmpty: boolean;
	disableChat: boolean;
}

const EMPTY_NATIVE_TVERINO_TRAY_STATE: NativeTVerinoTrayState = {
	active: false,
	sendHandlerType: "",
	placeholder: "",
	sendButtonLabel: "Chat",
	allowEmpty: false,
	disableChat: false,
};

let observedChatRoomRoot: HTMLElement | null = null;
let observedMessageViewport: HTMLElement | null = null;
let observedChatInputRoot: HTMLElement | null = null;
let observedTVerinoInputRoot: HTMLElement | null = null;
let relocatedAlertNodes: {
	el: HTMLElement;
	parent: Node | null;
	nextSibling: ChildNode | null;
}[] = [];
let alertObserver: MutationObserver | null = null;

const bounds = ref<DOMRect>(el.getBoundingClientRect());
const scrollerRef = ref<InstanceType<typeof UiScrollable> | undefined>();

const primaryColor = ref("");

const ctx = useChannelContext(props.controller.component.props.channelID, true);
ctx.setCurrentChannel({ ...ctx.base, id: ctx.id });
const worker = useWorker();
const emotes = useChatEmotes(ctx);
const messages = useChatMessages(ctx);
const scroller = useChatScroller(ctx, {
	scroller: scrollerRef,
	bounds: bounds,
});
const personalTimeouts = usePersonalTimeouts();
const recentSentEmotes = useRecentSentEmotes();
const properties = useChatProperties(ctx);
const tools = useChatTools(ctx);
const sharedChatDataByChannelID = ref<Map<string, Twitch.SharedChat> | null>(null);
const processor = useChatMessageProcessor(ctx, {
	sharedChatData: sharedChatDataByChannelID,
});
const personalTimeoutMiddlewareKey = `personal-timeout:${ctx.id}`;
const tverinoEnabled = useConfig<boolean>("chat.tverino.enabled", true);
const tverinoActiveTarget = ref<SevenTV.TVerinoActiveTarget>({
	kind: "native",
	id: "",
	login: "",
	displayName: "",
});
const nativeTVerinoTrayState = ref<NativeTVerinoTrayState>({ ...EMPTY_NATIVE_TVERINO_TRAY_STATE });
const forceStandardHydration = ref(!tverinoEnabled.value);

function setTVerinoActiveTarget(nextTarget: SevenTV.TVerinoActiveTarget): void {
	tverinoActiveTarget.value = nextTarget;
}
const nativeTVerinoInputStatus = computed<SevenTV.TVerinoTransportStatus>(() => {
	const chatProps = controller.value?.component?.props;
	const sendMessage = chatProps?.chatConnectionAPI?.sendMessage;
	if (typeof sendMessage === "function") {
		return {
			state: "connected",
			reason: "",
		};
	}

	if (chatProps?.initialStateLoaded === false) {
		return {
			state: "connecting",
			reason: "Connecting to Twitch chat...",
		};
	}

	return {
		state: "error",
		reason: "Twitch chat unavailable",
	};
});

// line limit
const lineLimit = useConfig("chat.line_limit", 150);
const ignoreClearChat = useConfig<boolean>("chat.ignore_clear_chat");

// Defines the current channel for hooking
const currentChannel = ref<CurrentChannel | null>(null);
const sharedChannels = new Map<string, ChannelContext>();

// get the config chat.font-april-fools
const fontAprilFools = useConfig("chat.font-april-fools", false);

watch(
	fontAprilFools,
	(value) => {
		properties.fontAprilFools = value === false ? "Comic Sans MS, Comic Sans, cursive" : "inherit";
	},
	{ immediate: true },
);

function clearRelocatedAlertNodes(restoreToSource: boolean): void {
	const nodes = relocatedAlertNodes;
	relocatedAlertNodes = [];

	alertHostEl.classList.remove("active");
	syncTVerinoInputAlertState();

	if (!nodes.length) return;

	for (let i = nodes.length - 1; i >= 0; i--) {
		const lane = nodes[i];
		if (!lane) continue;

		const { el, parent, nextSibling } = lane;
		el.classList.remove("seventv-relocated-private-callout-shell");
		el.classList.remove("seventv-relocated-native-input-tray");
		if (!restoreToSource) {
			el.remove();
			continue;
		}

		if (!parent || !("insertBefore" in parent)) {
			el.remove();
			continue;
		}

		if (nextSibling?.parentNode === parent) {
			parent.insertBefore(el, nextSibling);
			continue;
		}

		parent.appendChild(el);
	}
}

function discardRelocatedAlertNodes(): void {
	clearRelocatedAlertNodes(false);
}

function restoreRelocatedAlertNodes() {
	clearRelocatedAlertNodes(true);
}

function getTVerinoInputRoot(): HTMLElement | null {
	const inputRoot = inputHostEl.querySelector(":scope > .seventv-tverino-input");
	return inputRoot instanceof HTMLElement ? inputRoot : null;
}

function syncTVerinoInputAlertState(): void {
	const inputRoot = getTVerinoInputRoot();

	if (observedTVerinoInputRoot && observedTVerinoInputRoot !== inputRoot) {
		observedTVerinoInputRoot.classList.remove(TVERINO_INPUT_ALERT_ACTIVE_CLASS);
	}

	observedTVerinoInputRoot = inputRoot;
	inputRoot?.classList.toggle(TVERINO_INPUT_ALERT_ACTIVE_CLASS, alertHostEl.classList.contains("active"));
}

function syncAlertHostPlacement(
	fallbackParent?: HTMLElement | null,
	fallbackBefore?: Node | null,
	preferInputRoot = true,
): void {
	const inputContainer = preferInputRoot && inputHostEl.isConnected ? inputHostEl : null;
	if (inputContainer) {
		if (alertHostEl.parentElement !== inputContainer || alertHostEl !== inputContainer.firstElementChild) {
			inputContainer.insertBefore(alertHostEl, inputContainer.firstChild);
		}

		syncTVerinoInputAlertState();
		return;
	}

	const parent = fallbackParent ?? inputHostEl.parentElement;
	const insertBefore = fallbackBefore ?? inputHostEl;
	if (parent && (alertHostEl.parentElement !== parent || alertHostEl.nextSibling !== insertBefore)) {
		parent.insertBefore(alertHostEl, insertBefore);
	}

	syncTVerinoInputAlertState();
}

function disconnectAlertRelocationObserver(removeViewportClass = false) {
	alertObserver?.disconnect();
	alertObserver = null;
	observedChatRoomRoot = null;
	if (removeViewportClass) {
		observedMessageViewport?.classList.remove(TVERINO_ACTIVE_VIEWPORT_CLASS);
	}
	observedMessageViewport = null;
}

function getNativeAutocompleteInstance(
	chatInputRoot: HTMLElement | null = observedChatInputRoot,
): HookedInstance<Twitch.ChatAutocompleteComponent> | null {
	if (!(chatInputRoot instanceof HTMLElement)) return null;

	const chatInputModule = getModule<"TWITCH", "chat-input">("chat-input");
	const autocompleteInstances = chatInputModule?.instance?.component?.instances ?? [];

	for (const instance of autocompleteInstances as HookedInstance<Twitch.ChatAutocompleteComponent>[]) {
		const instanceRoot = instance.domNodes.root;
		if (!(instanceRoot instanceof Element)) continue;
		if (!chatInputRoot.contains(instanceRoot)) continue;
		if (instance.component.props?.channelID && instance.component.props.channelID !== ctx.id) continue;
		return instance;
	}

	return null;
}

function readNativeTVerinoTrayState(
	chatInputRoot: HTMLElement | null = observedChatInputRoot,
): NativeTVerinoTrayState {
	const autocompleteInstance = getNativeAutocompleteInstance(chatInputRoot);
	const tray = autocompleteInstance?.component.props?.tray as
		| Twitch.ChatTray<keyof Twitch.ChatTray.Type, keyof Twitch.ChatTray.SendMessageHandler.Type>
		| null
		| undefined;
	const trayType = typeof tray?.type === "string" ? tray.type : "";
	const sendHandlerType =
		typeof tray?.sendMessageHandler?.type === "string" ? tray.sendMessageHandler.type : "";

	if (sendHandlerType !== "share-resub" && trayType !== "share-resub") {
		return { ...EMPTY_NATIVE_TVERINO_TRAY_STATE };
	}

	return {
		active: true,
		sendHandlerType,
		placeholder: typeof tray?.placeholder === "string" ? tray.placeholder : "",
		sendButtonLabel:
			typeof tray?.sendButtonOverride === "string" && tray.sendButtonOverride.trim()
				? tray.sendButtonOverride.trim()
				: "Share",
		allowEmpty: true,
		disableChat: !!tray?.disableChat,
	};
}

function syncNativeTVerinoTrayState(chatInputRoot: HTMLElement | null = observedChatInputRoot): void {
	nativeTVerinoTrayState.value = readNativeTVerinoTrayState(chatInputRoot);
}

function canBridgeNativeTrayFlow(chatInputRoot: HTMLElement | null = observedChatInputRoot): boolean {
	const trayState = readNativeTVerinoTrayState(chatInputRoot);
	if (!trayState.active) {
		return false;
	}

	const autocompleteInstance = getNativeAutocompleteInstance(chatInputRoot);
	const sendButton = chatInputRoot?.querySelector<HTMLButtonElement>("button[data-a-target='chat-send-button']");
	return !!autocompleteInstance && !!sendButton;
}

// Keep 7TVerino active unless the native share-resub tray cannot be bridged cleanly.
function shouldUseNativeInputFlow(chatInputRoot: HTMLElement | null): boolean {
	if (!(chatInputRoot instanceof HTMLElement)) return false;

	const trayState = readNativeTVerinoTrayState(chatInputRoot);
	return trayState.active && !canBridgeNativeTrayFlow(chatInputRoot);
}

function syncTVerinoInputVisibility(): void {
	const shouldShowTVerinoInput = tverinoEnabled.value && !shouldUseNativeInputFlow(observedChatInputRoot);
	syncNativeTVerinoTrayState(observedChatInputRoot);

	inputHostEl.classList.toggle("active", shouldShowTVerinoInput);
	observedChatInputRoot?.classList.toggle("seventv-tverino-native-input-hidden", shouldShowTVerinoInput);
	observedChatRoomRoot?.classList.toggle(
		"seventv-tverino-native-input-pending",
		shouldShowTVerinoInput && !observedChatInputRoot,
	);
	syncTVerinoInputAlertState();
}

function resetTVerinoInputHost(): void {
	observedChatRoomRoot?.classList.remove("seventv-tverino-native-input-pending");
	observedChatInputRoot?.classList.remove("seventv-tverino-native-input-hidden");
	observedChatInputRoot = null;
	observedTVerinoInputRoot?.classList.remove(TVERINO_INPUT_ALERT_ACTIVE_CLASS);
	observedTVerinoInputRoot = null;
	nativeTVerinoTrayState.value = { ...EMPTY_NATIVE_TVERINO_TRAY_STATE };
	inputHostEl.classList.remove("active");
	inputHostEl.remove();
}

function syncTVerinoInputHost(chatRoomRoot: HTMLElement | null): void {
	if (!tverinoEnabled.value || !chatRoomRoot) {
		resetTVerinoInputHost();
		return;
	}

	chatRoomRoot.classList.add("seventv-tverino-native-input-pending");

	const chatInputRoot = chatRoomRoot.querySelector(".chat-input");
	if (!(chatInputRoot instanceof HTMLElement) || !chatInputRoot.parentElement) {
		observedChatInputRoot?.classList.remove("seventv-tverino-native-input-hidden");
		observedChatInputRoot = null;
		nativeTVerinoTrayState.value = { ...EMPTY_NATIVE_TVERINO_TRAY_STATE };
		inputHostEl.remove();
		return;
	}

	if (observedChatInputRoot && observedChatInputRoot !== chatInputRoot) {
		observedChatInputRoot.classList.remove("seventv-tverino-native-input-hidden");
	}

	observedChatInputRoot = chatInputRoot;

	if (inputHostEl.parentElement !== chatInputRoot.parentElement || inputHostEl.nextSibling !== chatInputRoot) {
		chatInputRoot.parentElement.insertBefore(inputHostEl, chatInputRoot);
	}

	syncAlertHostPlacement(chatInputRoot.parentElement, inputHostEl);
	syncTVerinoInputVisibility();
	chatRoomRoot.classList.remove("seventv-tverino-native-input-pending");
}

function collectRelocatableAlertNodes(messageViewport: HTMLElement): HTMLElement[] {
	const parent = messageViewport.parentElement;
	if (!parent) return [];

	const selectors = [
		"div.eIWExh",
		"div.cEllaX",
		".sticky-community-highlight",
		"[class*='community-highlight-stack__card']",
		"[class*='community-highlight-stack']",
		"[class*='community-highlight']",
		".core-error",
	];

	const matchesRelocatableModule = (el: HTMLElement): boolean =>
		selectors.some((selector) => el.matches(selector) || !!el.querySelector(selector));

	const nodes: HTMLElement[] = [];
	let current = parent.firstElementChild as HTMLElement | null;
	while (current) {
		if (current === messageViewport) break;
		if (current === headerHostEl || current === alertHostEl) {
			current = current.nextElementSibling as HTMLElement | null;
			continue;
		}
		if (matchesRelocatableModule(current)) {
			current.classList.add("seventv-relocated-viewport-alert");
			nodes.push(current);
		}

		current = current.nextElementSibling as HTMLElement | null;
	}

	return nodes;
}

function collectPrivateCalloutNodes(chatInputRoot: HTMLElement | null): HTMLElement[] {
	if (!(chatInputRoot instanceof HTMLElement)) return [];

	const nodes = new Set<HTMLElement>();
	for (const candidate of Array.from(chatInputRoot.querySelectorAll<HTMLElement>(NATIVE_PRIVATE_CALLOUT_SELECTOR))) {
		if (candidate.closest('[aria-hidden="true"]')) continue;

		let current: HTMLElement | null = candidate;
		while (current?.parentElement && current.parentElement !== chatInputRoot) {
			current = current.parentElement;
		}

		if (current?.parentElement === chatInputRoot) {
			current.classList.add("seventv-relocated-private-callout-shell");
			nodes.add(current);
		}
	}

	return Array.from(nodes);
}

function collectNativeShareResubTrayNodes(chatInputRoot: HTMLElement | null): HTMLElement[] {
	if (!(chatInputRoot instanceof HTMLElement)) return [];
	if (!readNativeTVerinoTrayState(chatInputRoot).active) return [];

	const nodes = new Set<HTMLElement>();
	for (const candidate of Array.from(chatInputRoot.querySelectorAll<HTMLElement>(NATIVE_SHARE_RESUB_TRAY_SELECTOR))) {
		if (candidate.closest('[aria-hidden="true"]')) continue;
		candidate.classList.add("seventv-relocated-native-input-tray");
		nodes.add(candidate);
	}

	return Array.from(nodes);
}

function syncAlertDock(chatRoomRoot: HTMLElement | null, messageViewport: HTMLElement | null) {
	if (!tverinoEnabled.value || !chatRoomRoot || !messageViewport) {
		restoreRelocatedAlertNodes();
		return;
	}

	const isNativeTargetActive =
		tverinoActiveTarget.value.kind === "native" && tverinoActiveTarget.value.id === ctx.id;

	observedChatRoomRoot = chatRoomRoot;
	observedMessageViewport = messageViewport;
	syncNativeTVerinoTrayState(observedChatInputRoot);
	const viewportAlertNodes = isNativeTargetActive ? collectRelocatableAlertNodes(messageViewport) : [];
	const inputLaneAlertNodes = [
		...collectPrivateCalloutNodes(observedChatInputRoot),
		...collectNativeShareResubTrayNodes(observedChatInputRoot),
	];
	const hasRelocatedInputLaneNodes = relocatedAlertNodes.some(
		(lane) =>
			alertHostEl.contains(lane.el) &&
			(lane.el.classList.contains("seventv-relocated-private-callout-shell") ||
				lane.el.classList.contains("seventv-relocated-native-input-tray")),
	);
	const hasRelocatedViewportAlertNodes = relocatedAlertNodes.some(
		(lane) =>
			lane.el.isConnected &&
			alertHostEl.contains(lane.el) &&
			lane.el.classList.contains("seventv-relocated-viewport-alert"),
	);
	const preferInputRoot = inputLaneAlertNodes.length > 0 || hasRelocatedInputLaneNodes;
	syncAlertHostPlacement(
		preferInputRoot
			? (observedChatInputRoot?.parentElement as HTMLElement | null)
			: messageViewport.parentElement,
		preferInputRoot ? inputHostEl : messageViewport,
		preferInputRoot,
	);

	const nativeAlertNodes = [...viewportAlertNodes, ...inputLaneAlertNodes];
	if (nativeAlertNodes.length) {
		const sameNodes =
			relocatedAlertNodes.length === nativeAlertNodes.length &&
			relocatedAlertNodes.every((lane, index) => lane.el === nativeAlertNodes[index]);

		if (!sameNodes) {
			discardRelocatedAlertNodes();
			relocatedAlertNodes = nativeAlertNodes.map((node) => ({
				el: node,
				parent: node.parentNode,
				nextSibling: node.nextSibling,
			}));
		}

		const needsMove =
			alertHostEl.childElementCount !== nativeAlertNodes.length ||
			nativeAlertNodes.some((node) => node.parentElement !== alertHostEl);
		if (needsMove) {
			alertHostEl.replaceChildren(...nativeAlertNodes);
		}

		alertHostEl.classList.add("active");
		syncTVerinoInputAlertState();
		return;
	}

	if (hasRelocatedInputLaneNodes || (isNativeTargetActive && hasRelocatedViewportAlertNodes)) {
		alertHostEl.classList.add("active");
		syncTVerinoInputAlertState();
		return;
	}

	discardRelocatedAlertNodes();
}

function connectAlertRelocationObserver(chatRoomRoot: HTMLElement | null, messageViewport: HTMLElement | null) {
	if (!tverinoEnabled.value || !chatRoomRoot || !messageViewport) {
		disconnectAlertRelocationObserver();
		return;
	}

	if (alertObserver && observedChatRoomRoot === chatRoomRoot && observedMessageViewport === messageViewport) {
		return;
	}

	disconnectAlertRelocationObserver();
	observedChatRoomRoot = chatRoomRoot;
	observedMessageViewport = messageViewport;
	alertObserver = new MutationObserver(() => {
		if (!observedChatInputRoot || !observedChatInputRoot.isConnected) {
			syncTVerinoInputHost(observedChatRoomRoot);
		} else {
			syncTVerinoInputVisibility();
		}

		syncAlertDock(observedChatRoomRoot, observedMessageViewport);
	});
	alertObserver.observe(chatRoomRoot, {
		childList: true,
		subtree: true,
	});
}

// Capture the chat root node
watchEffect(() => {
	if (!list.value || !list.value.domNodes) return;

	const rootNode = list.value.domNodes.root;
	if (!rootNode) return;

	rootNode.classList.add("seventv-chat-list");

	containerEl.value = rootNode as HTMLElement;

	const messageViewport =
		(rootNode.closest("div[aria-label='Chat messages'].chat-list--default") as HTMLElement | null) ??
		(rootNode as HTMLElement);
	const chatRoomRoot = rootNode.closest(
		"section[data-test-selector='chat-room-component-layout']",
	) as HTMLElement | null;

	if (observedMessageViewport && observedMessageViewport !== messageViewport) {
		observedMessageViewport.classList.remove(TVERINO_ACTIVE_VIEWPORT_CLASS);
	}
	messageViewport.classList.add(TVERINO_ACTIVE_VIEWPORT_CLASS);
	observedMessageViewport = messageViewport;

	const headerInsertionParent = messageViewport.parentElement;
	const headerInsertBefore: Node | null = messageViewport;

	if (!tverinoEnabled.value || !headerInsertionParent || !headerInsertBefore) {
		disconnectAlertRelocationObserver();
		restoreRelocatedAlertNodes();
		resetTVerinoInputHost();
		headerHostEl.remove();
		alertHostEl.remove();
		return;
	}

	if (headerHostEl.parentElement !== headerInsertionParent || headerHostEl.nextSibling !== headerInsertBefore) {
		headerInsertionParent.insertBefore(headerHostEl, headerInsertBefore);
	}

	syncTVerinoInputHost(chatRoomRoot);

	const alertInsertionParent = inputHostEl.parentElement ?? headerInsertionParent;
	const alertInsertBefore: Node | null =
		inputHostEl.parentElement === alertInsertionParent ? inputHostEl : headerInsertBefore;
	syncAlertHostPlacement(alertInsertionParent, alertInsertBefore);

	connectAlertRelocationObserver(chatRoomRoot, messageViewport);
	syncAlertDock(chatRoomRoot, messageViewport);
});

watch(
	[tverinoEnabled, tverinoActiveTarget],
	() => {
		syncTVerinoInputVisibility();
		syncAlertDock(observedChatRoomRoot, observedMessageViewport);
		void nextTick(() => {
			syncTVerinoInputVisibility();
			syncAlertDock(observedChatRoomRoot, observedMessageViewport);
		});
	},
	{ deep: true, immediate: true },
);

let standardHydrationReleaseToken = 0;

async function releaseStandardHydrationWhenReady(token: number): Promise<void> {
	if (tverinoEnabled.value) return;

	const scroller = scrollerRef.value;
	if (!scroller?.container) return;

	await nextTick();
	if (token !== standardHydrationReleaseToken || tverinoEnabled.value) return;

	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	if (token !== standardHydrationReleaseToken || tverinoEnabled.value) return;

	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	if (token !== standardHydrationReleaseToken || tverinoEnabled.value) return;

	forceStandardHydration.value = false;
}

watch(
	tverinoEnabled,
	(enabled) => {
		standardHydrationReleaseToken += 1;
		const token = standardHydrationReleaseToken;

		if (enabled) {
			forceStandardHydration.value = false;
			return;
		}

		forceStandardHydration.value = true;
		void releaseStandardHydrationWhenReady(token);
	},
	{ immediate: true },
);

watch(
	scrollerRef,
	(scroller) => {
		if (tverinoEnabled.value || !forceStandardHydration.value || !scroller?.container) return;

		void releaseStandardHydrationWhenReady(standardHydrationReleaseToken);
	},
	{ flush: "post" },
);

const messageHandler = ref<Twitch.MessageHandlerAPI | null>(null);

watch(
	list,
	(inst, old) => {
		if (!inst || !inst.component) return;

		if (old && old.component && inst !== old) {
			unsetPropertyHook(old.component, "props");
			return;
		}

		definePropertyHook(inst.component, "props", {
			value(v) {
				messageHandler.value = v.messageHandlerAPI;
			},
		});
	},
	{ immediate: true },
);

// Retrieve and convert Twitch Emotes
//
// This processed is deferred to the worker asynchronously
// in order to reduce the load on the main thread.
const twitchEmoteSets = ref<Twitch.TwitchEmoteSet[]>([]);
const twitchEmoteSetsDbc = refDebounced(twitchEmoteSets, 1000);
watch(twitchEmoteSetsDbc, async (sets) => {
	if (!sets.length) return;

	for (const set of twitchEmoteSets.value) {
		// Skip set if its injected by FFZ or BTTV for Slate autocomplete.
		if (set.id === "FrankerFaceZWasHere" || set.id === "BETTERTTV_EMOTES") continue;

		sendWorkerMessage("SYNC_TWITCH_SET", { input: toRaw(set) });
	}
});

// Keep track of user chat config
watch(
	room,
	(inst, old) => {
		if (!inst || !inst.component) return;

		if (old && old.component && inst !== old) {
			unsetPropertyHook(old.component, "props");
		}

		definePropertyHook(room.value.component, "props", {
			value(v) {
				properties.twitchBadgeSets = v.badgeSets;
				properties.primaryColorHex = v.primaryColorHex;
				primaryColor.value = `#${v.primaryColorHex ?? "755ebc"}`;
				document.body.style.setProperty("--seventv-channel-accent", primaryColor.value);

				properties.useHighContrastColors = v.useHighContrastColors;
				properties.showTimestamps = v.showTimestamps;
				properties.showModerationIcons = v.showModerationIcons;

				properties.pauseReason.clear();
				properties.pauseReason.add("SCROLL");
				switch (v.chatPauseSetting) {
					case "MOUSEOVER_ALTKEY":
						properties.pauseReason.add("ALTKEY");
						properties.pauseReason.add("MOUSEOVER");
						break;
					case "MOUSEOVER":
						properties.pauseReason.add("MOUSEOVER");
						break;
					case "ALTKEY":
						properties.pauseReason.add("ALTKEY");
						break;
				}
			},
		});
	},
	{ immediate: true },
);

function emitLocalSystemMessage(text: string): void {
	const message = new ChatMessage().setComponent(BasicSystemMessage, {
		text,
	});
	message.setTimestamp(Date.now());
	messages.add(message, true);
}

function createNativeTVerinoNonce(): string {
	return `native:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function sendNativeTVerinoMessage(
	message: string,
	reply?: NonNullable<Twitch.DisplayableMessage["reply"]>,
): boolean {
	const trayState = readNativeTVerinoTrayState(observedChatInputRoot);
	if (reply?.parentMsgId) {
		const transportStatus = getStatus();
		if (transportStatus.state !== "connected" || !ctx.username) {
			emitLocalSystemMessage(transportStatus.reason || "Reply unavailable while Twitch chat is reconnecting");
			return false;
		}

		sendTVerinoChatMessage(ctx.id, ctx.username, message, createNativeTVerinoNonce(), reply);
		return true;
	}

	const chatProps = controller.value?.component?.props as
		| {
				chatConnectionAPI?: { sendMessage?: Function };
				onSendMessage?: (value: string, reply?: NonNullable<Twitch.DisplayableMessage["reply"]>) => unknown;
		  }
		| undefined;
	const chatConnection = chatProps?.chatConnectionAPI;
	if (!chatProps || !chatConnection || typeof chatConnection.sendMessage !== "function") {
		return false;
	}

	try {
		if (trayState.active) {
			if (typeof chatProps.onSendMessage === "function") {
				chatProps.onSendMessage(message);
				return true;
			}

			const nativeAutocomplete = getNativeAutocompleteInstance(observedChatInputRoot);
			const nativeSendButton =
				observedChatInputRoot?.querySelector<HTMLButtonElement>("button[data-a-target='chat-send-button']");
			if (nativeAutocomplete && nativeSendButton) {
				nativeAutocomplete.component.setValue(message);
				nativeSendButton.click();
				return true;
			}
		}

		chatConnection.sendMessage.call(chatConnection, message);
		return true;
	} catch (error) {
		log.error("<Chat>", "Failed to send native TVerino message", String(error));
		return false;
	}
}

function createTVerinoLocalMessage(
	target: SevenTV.TVerinoActiveTarget,
	message: string,
	nonce: string,
): Twitch.ChatMessage | null {
	if (!store.identity?.id || !store.identity.username) {
		return null;
	}

	const selfState = getTVerinoSelfMessageState(target.id);
	const displayName =
		selfState?.user?.userDisplayName ||
		selfState?.user?.displayName ||
		("displayName" in store.identity && store.identity.displayName) ||
		store.identity.username;

	return {
		id: nonce,
		type: MessageType.MESSAGE,
		nonce,
		channelID: target.id,
		user: {
			color: selfState?.user?.color || "",
			isIntl: false,
			isSubscriber: !!(selfState?.badges?.subscriber || selfState?.badges?.founder),
			userDisplayName: displayName,
			displayName,
			userID: store.identity.id,
			userLogin: store.identity.username,
			userType: selfState?.user?.userType || "",
		},
		badgeDynamicData: { ...(selfState?.badgeDynamicData ?? {}) },
		badges: { ...(selfState?.badges ?? {}) },
		deleted: false,
		banned: false,
		hidden: false,
		isHistorical: false,
		isFirstMsg: false,
		isReturningChatter: false,
		isVip: false,
		messageBody: message,
		messageParts: [
			{
				type: MessagePartType.TEXT,
				content: message,
			},
		],
		messageType: 0,
		timestamp: Date.now(),
	} as Twitch.ChatMessage;
}

function handlePersonalTimeoutCommand(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) return input;

	const [command, rawUsername, rawDuration] = trimmed.split(/\s+/, 3);
	const normalizedCommand = command.toLowerCase();
	if (normalizedCommand !== "/ptimeout" && normalizedCommand !== "/puntimeout") {
		return input;
	}

	const username = rawUsername?.replace(/^@+/, "").trim().toLowerCase() ?? "";
	if (!username) {
		emitLocalSystemMessage(
			normalizedCommand === "/ptimeout"
				? "Usage: /ptimeout <username> [duration]"
				: "Usage: /puntimeout <username>",
		);
		return null;
	}

	if (!personalTimeouts.enabled.value) {
		emitLocalSystemMessage("Enable Personal Timeouts in 7TVerino settings before using /ptimeout commands.");
		return null;
	}

	if (normalizedCommand === "/puntimeout") {
		const removed = personalTimeouts.clearEntry(ctx.id, username);
		emitLocalSystemMessage(
			removed ? `Cleared personal timeout for ${username}.` : `No active personal timeout for ${username}.`,
		);
		return null;
	}

	const duration = rawDuration?.trim() || DEFAULT_PERSONAL_TIMEOUT_DURATION;
	if (!parseTimeoutDuration(duration)) {
		emitLocalSystemMessage(`Invalid personal timeout duration: ${duration}.`);
		return null;
	}

	const entry = personalTimeouts.upsertEntry(
		{ id: ctx.id, username: ctx.username } as Pick<ChannelContext, "id" | "username">,
		{
			username,
			displayName: rawUsername?.replace(/^@+/, "").trim() ?? username,
		},
		duration,
	);
	if (!entry) {
		emitLocalSystemMessage(`Unable to create a personal timeout for ${username}.`);
		return null;
	}

	emitLocalSystemMessage(formatTimeoutNotice(entry.displayName || entry.username, entry.duration, true) ?? "");
	return null;
}

watch(
	() => mod.instance,
	(instance) => {
		if (!instance) return;
		instance.messageSendMiddleware.set(personalTimeoutMiddlewareKey, handlePersonalTimeoutCommand);
	},
	{ immediate: true },
);

// Keep track of chat state
definePropertyHook(controller.value.component, "props", {
	value(v: typeof controller.value.component.props) {
		setTwitchHelixAuth({
			clientID: v.clientID,
			token: v.authToken,
		});

		if (v.channelID) {
			currentChannel.value = {
				id: v.channelID,
				username: v.channelLogin,
				displayName: v.channelDisplayName,
				active: true,
			};
		}

		const temp = new Set<ChannelRole>();
		for (const [role, ok] of [
			["VIP", v.isCurrentUserVIP],
			["EDITOR", v.isCurrentUserEditor],
			["MODERATOR", v.isCurrentUserModerator || v.channelID === v.userID],
			["BROADCASTER", v.channelID === v.userID],
		] as [ChannelRole, boolean][]) {
			if (!ok) continue;
			temp.add(role);
		}

		ctx.actor.roles = temp;

		// Keep track of chat props
		properties.isDarkTheme = v.theme;

		// Send presence upon message sent
		messages.sendMessage = v.chatConnectionAPI.sendMessage;
		defineFunctionHook(v.chatConnectionAPI, "sendMessage", function (old, ...args) {
			if (sharedChatDataByChannelID.value?.size != 0) {
				for (const [key, value] of sharedChatDataByChannelID.value?.entries() ?? []) {
					worker.sendMessage("CHANNEL_ACTIVE_CHATTER", {
						channel: {
							id: key,
							username: value.login,
							displayName: value.displayName,
							active: true,
						},
					});
				}
			} else {
				worker.sendMessage("CHANNEL_ACTIVE_CHATTER", {
					channel: toRaw(ctx.base),
				});
			}

			// Run message content patching middleware
			for (const fn of mod.instance?.messageSendMiddleware.values() ?? []) {
				const nextValue = fn(args[0]);
				if (nextValue === null) {
					return Promise.resolve(undefined);
				}

				args[0] = nextValue;
			}

			if (typeof args[0] === "string") {
				const activeTarget = tverinoActiveTarget.value;
				const nextMessage = args[0].trim();

				if (
					tverinoEnabled.value &&
					activeTarget.kind === "remote" &&
					activeTarget.id &&
					activeTarget.login &&
					activeTarget.id !== ctx.id &&
					nextMessage
				) {
					const nonce = `tverino:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
					const pending = createTVerinoLocalMessage(activeTarget, nextMessage, nonce);
					const activeTargetCtx = resolveTVerinoRemoteContext(activeTarget.id);
					if (activeTargetCtx) {
						activeTargetCtx.setCurrentChannel({
							id: activeTarget.id,
							username: activeTarget.login,
							displayName: activeTarget.displayName,
							active: true,
						});
					}
					const activeTargetEmotes = activeTargetCtx ? useChatEmotes(activeTargetCtx) : null;
					if (pending) {
						emitTVerinoLocalMessage(activeTarget.id, pending);
					}

					recentSentEmotes.recordMessage(activeTarget.id, nextMessage, activeTargetEmotes?.active ?? {});
					sendTVerinoChatMessage(activeTarget.id, activeTarget.login, nextMessage, nonce);
					return Promise.resolve(undefined);
				}

				recentSentEmotes.recordMessage(ctx.id, args[0], emotes.active);
			}

			return old?.apply(this, args);
		});

		// Parse twitch emote sets
		const data = v.emoteSetsData;
		if (!data || data.loading) return;

		twitchEmoteSets.value = data.emoteSets;
	},
});

watch(
	presentation,
	(inst, old) => {
		if (!inst || !inst.component) return;

		if (old && old.component && inst !== old) {
			unsetPropertyHook(old.component, "props");
			return;
		}

		definePropertyHook(inst.component, "props", {
			value(v) {
				sharedChatDataByChannelID.value = v.sharedChatDataByChannelID;

				for (const channelID of sharedChatDataByChannelID.value.keys()) {
					if (!sharedChannels.has(channelID) && channelID != ctx.id) {
						sharedChannels.set(channelID, useChannelContext(channelID, true));
					}
				}
			},
		});
	},
	{ immediate: true },
);

const a = awaitComponents<Twitch.MessageCardOpeners>({
	parentSelector: ".stream-chat",
	predicate: (n) => {
		return n.props && (n.props.onShowViewerCard || n.openUserCard);
	},
});

a.then(
	([c]) => {
		if (!c) return;
		tools.update("TWITCH", "onShowViewerCard", c.props.onShowViewerCard ?? c.openUserCard);
	},
	() => null,
);

tools.update(
	"TWITCH",
	"onShowViewerWarnPopover",
	(userId: string, userLogin: string, placement: Twitch.WarnUserPopoverPlacement) => {
		const props = controller.value.component.props;
		props.setWarnUserTarget({
			targetUserID: userId,
			targetUserLogin: userLogin,
		});
		props.setWarnUserPopoverPlacement(placement);
	},
);

if (a instanceof ObserverPromise) {
	until(useTimeout(1e4))
		.toBeTruthy()
		.then(() => a.disconnect());
}

const messageBufferComponent = ref<Twitch.MessageBufferComponent | null>(null);
const messageBufferComponentDbc = refDebounced(messageBufferComponent, 100);

const isLoadingHistoricalMessages = ref(true);
const didApplyHistoricalBuffer = ref(false);

function applyHistoricalBufferIfReady(): void {
	if (didApplyHistoricalBuffer.value || isLoadingHistoricalMessages.value) return;

	const buffer = messageBufferComponent.value?.buffer;
	if (!buffer) return;

	didApplyHistoricalBuffer.value = true;
	handleBuffer(buffer);
}

watch(isLoadingHistoricalMessages, (isLoading) => {
	if (isLoading) return;
	applyHistoricalBufferIfReady();
});

function handleBuffer(buffer: Twitch.MessageBufferComponent["buffer"]) {
	if (!buffer.length) return;
	const historical: ChatMessage[] = [];

	for (const msg of buffer) {
		const m = new ChatMessage(msg.id);

		// If the message is historical we add it to the array and continue
		if ((msg as Twitch.ChatMessage).isHistorical || msg.type === MessageType.CONNECTED) {
			m.historical = true;
			processor.onChatMessage(m, msg as Twitch.ChatMessage, false);

			historical.push(m);
			continue;
		}
	}

	messages.displayed = historical.concat(messages.displayed);

	nextTick(() => {
		// Instantly scroll to the bottom and stop hooking the buffer
		scroller.scrollToLive(0);
	});
}

watch(messageBufferComponentDbc, (msgBuf, old) => {
	if (old && msgBuf !== old) {
		unsetPropertyHook(old, "blockedUsers");
		unsetPropertyHook(old, "props");
	}

	if (msgBuf) {
		didApplyHistoricalBuffer.value = false;
		definePropertyHook(msgBuf, "props", {
			value(props) {
				isLoadingHistoricalMessages.value = props.isLoadingHistoricalMessages;
				if (!props.isLoadingHistoricalMessages) {
					nextTick(() => applyHistoricalBufferIfReady());
				}
			},
		});

		definePropertyHook(msgBuf, "blockedUsers", {
			value(users) {
				properties.blockedUsers = users;
			},
		});
	}
});

// Watch change of current channel
watch(
	currentChannel,
	(chan) => {
		if (!chan || !ctx.setCurrentChannel(chan)) return;

		didApplyHistoricalBuffer.value = false;
		messages.clear();
		scroller.unpause();
	},
	{ immediate: true },
);

watch(
	[tverinoEnabled, currentChannel] as const,
	([enabled, channel]) => {
		if (enabled || !channel?.id) return;

		setTVerinoActiveTarget({
			kind: "native",
			id: channel.id,
			login: channel.username ?? "",
			displayName: channel.displayName ?? channel.username ?? "",
		});
	},
	{ immediate: true },
);

// Capture the message buffer
watch(
	() => props.buffer,
	(msgBuffer) => {
		const msgBuf = msgBuffer?.component;
		if (!msgBuf) return;

		messageBufferComponent.value = msgBuf;
	},
	{ immediate: true },
);

// Capture some chat events
const chatEventsComponent = ref<Twitch.ChatEventComponent | null>(null);
watch(
	() => props.events,
	(evt) => {
		if (!evt || !evt.component) return;

		chatEventsComponent.value = evt.component;
	},
	{ immediate: true },
);

watch(
	chatEventsComponent,
	(com, old) => {
		if (old) {
			unsetPropertyHook(old, "onClearChatEvent");
		}
		if (!com) return;

		defineFunctionHook(com, "onClearChatEvent", (f) => {
			const msg = new ChatMessage().setComponent(BasicSystemMessage, {
				text: ignoreClearChat.value ? "Chat clear prevented by 7TV" : "Chat cleared by a moderator",
			});
			if (!ignoreClearChat.value) messages.clear();
			messages.add(msg);

			// send back an empty channel
			// (this will make the chat clear on twitch's end a no-op; this avoids a crash due to the way we move unrendered messages)
			return f?.apply(this, [{ channel: "" }]);
		});
	},
	{ immediate: true },
);

// Apply new boundaries when the window is resized
const resizeObserver = new ResizeObserver(() => {
	bounds.value = containerEl.value.getBoundingClientRect();
});
resizeObserver.observe(containerEl.value);

onBeforeUnmount(() => {
	messages.clear();
});

onUnmounted(() => {
	resizeObserver.disconnect();
	disconnectAlertRelocationObserver(true);
	mod.instance?.messageSendMiddleware.delete(personalTimeoutMiddlewareKey);

	el.remove();
	headerHostEl.remove();
	alertHostEl.remove();
	resetTVerinoInputHost();
	restoreRelocatedAlertNodes();

	log.debug("<ChatController> Unmounted");

	// Unset hooks
	unsetPropertyHook(controller.value.component, "props");
	if (list.value) {
		unsetPropertyHook(list.value.component.props, "messageHandlerAPI");
		unsetPropertyHook(list.value.component, "props");
	}
	if (room.value) unsetPropertyHook(room.value.component, "props");

	document.body.style.removeProperty("--seventv-channel-accent");
});
</script>

<style lang="scss">
seventv-container#seventv-tverino-header {
	display: block;
	flex: 0 0 auto;
}

seventv-container#seventv-tverino-alerts {
	display: none;
	flex: 0 0 auto;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	overflow: visible;
	background: transparent;

	&.active {
		display: block;
	}

	> * {
		display: block;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	[data-test-selector="chat-private-callout-queue__callout-container"] {
		margin: 0;
	}

	> .seventv-relocated-private-callout-shell {
		width: 100%;
		max-width: 100%;
		margin: 0;
	}

	> .seventv-relocated-native-input-tray {
		width: 100%;
		max-width: 100%;
		margin: 0;
	}

	.community-highlight,
	[class*="community-highlight-stack"],
	[class*="community-highlight"],
	.scrollable-area {
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}
}

seventv-container#seventv-tverino-input {
	display: none;
	flex: 0 0 auto;
}

seventv-container#seventv-tverino-input.active {
	display: flex;
	flex-direction: column;
	overflow: visible;
}

seventv-container#seventv-tverino-input > .seventv-tverino-input.seventv-tverino-has-native-alert {
	gap: 0.45rem;
	padding-top: 0;
	border-top: 0;
}

seventv-container#seventv-tverino-input > seventv-container#seventv-tverino-alerts {
	flex: 0 0 auto;
	margin: 0 0.8rem;
}

section[data-test-selector="chat-room-component-layout"].seventv-tverino-native-input-pending .chat-input {
	pointer-events: none !important;
	opacity: 0 !important;
}

.chat-input.seventv-tverino-native-input-hidden {
	position: absolute !important;
	right: 0 !important;
	bottom: 0 !important;
	left: 0 !important;
	height: 0 !important;
	min-height: 0 !important;
	overflow: hidden !important;
	visibility: hidden !important;
	pointer-events: none !important;
	opacity: 0 !important;
}

.chat-list--default.seventv-tverino-active-viewport {
	overflow-x: hidden !important;

	> :not(#Exit-chat-container):not(seventv-container.seventv-chat-list) {
		display: none !important;
	}

	> seventv-container.seventv-chat-list {
		display: flex;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
	}
}

seventv-container.seventv-chat-list {
	display: flex;
	flex-direction: column !important;
	-webkit-box-flex: 1 !important;
	flex-grow: 1 !important;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	min-height: 0;
	box-sizing: border-box;
	overflow: auto !important;
	overflow-x: hidden !important;

	> seventv-container {
		display: none;
	}

	.seventv-message-container {
		line-height: 1.5em;
	}

	// Chat padding
	&.custom-scrollbar {
		scrollbar-width: none;

		&::-webkit-scrollbar {
			width: 0;
			height: 0;
		}

		.seventv-scrollbar {
			$width: 1em;

			position: absolute;
			right: 0;
			width: $width;
			overflow: hidden;
			border-radius: 0.33em;
			background-color: black;

			> .seventv-scrollbar-thumb {
				position: absolute;
				width: 100%;
				background-color: rgb(77, 77, 77);
			}
		}
	}

	.seventv-message-buffer-notice {
		cursor: pointer;
		position: absolute;
		bottom: 1em;
		left: 50%;
		transform: translateX(-50%);
		display: block;
		white-space: nowrap;
		padding: 0.5em;
		border-radius: 0.33em;
		color: currentcolor;
		background-color: var(--seventv-background-transparent-1);
		outline: 0.25rem solid var(--seventv-border-transparent-1);

		span,
		svg {
			display: inline-block;
			vertical-align: middle;
		}

		svg {
			font-size: 1.5rem;
			margin-right: 0.5em;
		}

		span:nth-of-type(1) {
			margin-right: 0.25rem;

			&.capped::after {
				content: "+";
			}
		}

		@at-root .seventv-transparent & {
			backdrop-filter: blur(0.5em);
		}
	}
}

.seventv-chat-scroller {
	z-index: 1;
	height: 100%;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	overflow-x: hidden;
}

.community-highlight {
	background-color: var(--seventv-background-transparent-1) !important;

	@at-root .seventv-transparent & {
		backdrop-filter: blur(1em);
	}

	transition: background-color 0.25s;

	&:hover {
		opacity: 1;
	}
}

[data-a-target="emote-picker-button"] {
	overflow: unset !important;
	transform: translate(-2px, -3px);
}
</style>
