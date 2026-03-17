<template>
	<Teleport v-if="headerContainer" :to="headerContainer">
		<div class="seventv-tverino-header">
			<div class="seventv-tverino-tabs-row">
				<div ref="tabsRef" class="seventv-tverino-tabs">
					<button
						v-for="tab of tabs"
						:key="tab.id"
						:ref="(el) => setTabButtonRef(tab.id, el)"
						class="seventv-tverino-tab"
						:class="{
							active: tab.id === activeTabID,
							compact: shouldCompactTab(tab),
							closing: isClosingTab(tab.id),
							native: tab.kind === 'native',
							remote: tab.kind === 'remote',
							unread: (unreadCounts[tab.id] ?? 0) > 0,
						}"
						:style="getTabStyle(tab.id)"
						type="button"
						@click="selectTab(tab.id)"
						@mouseenter="startTabLabelAnimation(tab.id)"
						@mouseleave="stopTabLabelAnimation(tab.id)"
						@focus="startTabLabelAnimation(tab.id)"
						@blur="stopTabLabelAnimation(tab.id)"
					>
						<span class="tab-main">
							<span v-if="tab.kind === 'native'" class="live-dot"></span>
							<span
								:ref="(el) => setTabLabelViewportRef(tab.id, el)"
								class="tab-label"
								:class="{ overflow: hasOverflowingLabel(tab.id) }"
							>
								<span :ref="(el) => setTabLabelTextRef(tab.id, el)" class="tab-label-text">
									{{ tab.displayName }}
								</span>
							</span>
							<span v-if="(unreadCounts[tab.id] ?? 0) > 0" class="tab-unread">
								<span class="tab-unread-text">
									{{ unreadCounts[tab.id] >= TVERINO_INACTIVE_TAB_MESSAGE_CAP ? "50+" : unreadCounts[tab.id] }}
								</span>
							</span>
						</span>
						<span
							v-if="tab.kind === 'remote'"
							class="tab-close"
							aria-hidden="true"
							@click.stop="removeTab(tab.id)"
						>
							&times;
						</span>
					</button>
				</div>

				<div
					ref="actionsRef"
					class="seventv-tverino-actions"
					:class="{ open: showAddInput, scrollable: tabsScrollable }"
					:style="getAddPanelStyle()"
				>
					<div class="seventv-tverino-add-panel" :aria-hidden="!showAddInput">
						<form class="seventv-tverino-add-form" @submit.prevent="submitAddChannel">
							<input
								ref="addInputRef"
								v-model="addChannelValue"
								class="seventv-tverino-add-input"
								:disabled="!showAddInput"
								:tabindex="showAddInput ? 0 : -1"
								placeholder="Add channel"
								type="text"
								autocomplete="off"
								@keydown.esc.prevent="closeAddInput"
							/>
						</form>
					</div>
					<button
						class="seventv-tverino-add-button"
						type="button"
						:aria-expanded="showAddInput"
						@click="toggleAddInput"
					>
						<span class="seventv-tverino-add-button-glyph">+</span>
					</button>
				</div>
			</div>

			<div v-if="inlineStatus" class="seventv-tverino-inline-status">
				{{ inlineStatus }}
			</div>
		</div>
	</Teleport>

	<Teleport v-if="inputContainer && activeTab" :to="inputContainer">
		<TVerinoChatInput
			:key="`${activeTab.kind}:${activeTab.id}`"
			:ctx="activeTab.ctx"
			:mode="activeTab.kind"
			:input-status="activeTab.kind === 'native' ? nativeInputStatus : transportStatus"
			:native-send-message="activeTab.kind === 'native' ? nativeSendMessage : undefined"
		/>
	</Teleport>

	<div class="seventv-tverino-shell">
		<div class="seventv-tverino-body">
			<TVerinoChatPane
				v-if="activeTab?.kind === 'native'"
				:key="activeTab.id"
				:ctx="currentCtx"
				:list="list"
				:restrictions="restrictions"
				:message-handler="messageHandler"
				:shared-chat-data="sharedChatData"
				:mount-data="true"
				:force-hydrated="true"
			/>
			<TVerinoChatPane v-else-if="activeTab" :key="activeTab.id" :ctx="activeTab.ctx" :force-hydrated="true" />
		</div>

		<TVerinoChannelFeed v-for="tab of remoteTabs" :key="tab.id" :ctx="tab.ctx" />
	</div>
</template>

<script setup lang="ts">
import { ComponentPublicInstance, computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
import { onClickOutside, useEventListener, useResizeObserver } from "@vueuse/core";
import type { HookedInstance } from "@/common/ReactHooks";
import { ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useChatScroller } from "@/composable/chat/useChatScroller";
import { useApollo } from "@/composable/useApollo";
import { useConfig } from "@/composable/useSettings";
import { twitchChannelBadgesQuery } from "@/assets/gql/tw.channel-badges.gql";
import { twitchChannelLookupQuery } from "@/assets/gql/tw.channel-lookup.gql";
import TVerinoChannelFeed from "./TVerinoChannelFeed.vue";
import TVerinoChatInput from "./TVerinoChatInput.vue";
import TVerinoChatPane from "./TVerinoChatPane.vue";
import { getTwitchBadgeSets } from "./twitchBadgeSets";
import { onTwitchHelixAuthChange } from "./twitchHelixAuth";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import type { TypedWorkerMessage } from "@/worker";

interface BaseTab {
	id: string;
	displayName: string;
	login: string;
	ctx: ChannelContext;
}

interface NativeTab extends BaseTab {
	kind: "native";
}

interface RemoteTab extends BaseTab {
	kind: "remote";
}

const props = defineProps<{
	headerContainer?: HTMLElement | null;
	inputContainer?: HTMLElement | null;
	nativeInputStatus: SevenTV.TVerinoTransportStatus;
	nativeSendMessage: (message: string, reply?: NonNullable<Twitch.DisplayableMessage["reply"]>) => boolean;
	currentCtx: ChannelContext;
	list: HookedInstance<Twitch.ChatListComponent>;
	restrictions?: HookedInstance<Twitch.ChatRestrictionsComponent>;
	messageHandler: Twitch.MessageHandlerAPI | null;
	sharedChatData: Map<string, Twitch.SharedChat> | null;
}>();
const currentCtx = props.currentCtx;

const apollo = useApollo();
const { subscribeChannel, unsubscribeChannel, target, getStatus } = useTVerinoChatTransport();
const workspace = useConfig<Map<string, SevenTV.TVerinoSavedTab>>("chat.tverino.workspace", new Map());
const transportStatus = useConfig<SevenTV.TVerinoTransportStatus>("chat.tverino.transport_status", {
	state: "idle",
	reason: "",
});
const activeTarget = useConfig<SevenTV.TVerinoActiveTarget>("chat.tverino.active_target", {
	kind: "native",
	id: "",
	login: "",
	displayName: "",
});
transportStatus.value = getStatus();

const activeTabID = ref(props.currentCtx.id);
const unreadCounts = ref<Record<string, number>>({});
const showAddInput = ref(false);
const addChannelValue = ref("");
const addInputRef = ref<HTMLInputElement | null>(null);
const nativeSubscriptionChannelID = ref("");
const actionsRef = ref<HTMLElement | null>(null);
const tabsRef = ref<HTMLElement | null>(null);
const tabsScrollable = ref(false);
const addPanelWidth = ref<number | null>(null);
const activeTabWidths = ref<Record<string, number>>({});
const compactTabWidths = ref<Record<string, number>>({});
const overflowingTabLabels = ref<Record<string, number>>({});

const remoteCtxByID = new Map<string, ChannelContext>();
const unreadStops = new Map<string, () => void>();
const subscribedRemoteIDs = new Set<string>();
const hydratedRemoteBadgeIDs = new Set<string>();
const tabButtonRefs = new Map<string, HTMLElement>();
const tabLabelViewportRefs = new Map<string, HTMLElement>();
const tabLabelTextRefs = new Map<string, HTMLElement>();
const tabLabelAnimations = new Map<string, { animation: Animation; overflowDistance: number }>();
const tabLabelStartTimeouts = new Map<string, number>();
const unreadResetTimeouts = new Map<string, number>();
const closingTabTimeouts = new Map<string, number>();
const tabLabelReadyChannels = new Set<string>();
const TAB_LABEL_START_DELAY = 660;
const TAB_LABEL_HOVER_SETTLE_DELAY = 240;
const TAB_LABEL_LAYOUT_SETTLE_DELAY = 96;
const TAB_REVEAL_SETTLE_DELAY = 260;
const TAB_REMOVE_ANIMATION_DURATION = 180;
const TAB_UNREAD_RESET_DELAY = 190;
const TVERINO_INACTIVE_TAB_MESSAGE_CAP = 50;
const TVERINO_WORKSPACE_SESSION_KEY = "seventv:tverino:workspace";
const tabLabelResizeObserver =
	typeof ResizeObserver !== "undefined"
		? new ResizeObserver(() => {
				queueTabLabelMeasure(TAB_LABEL_LAYOUT_SETTLE_DELAY);
		  })
		: null;
let tabLabelMeasureFrame = 0;
let tabLabelMeasureTimeout = 0;
let activeTabRevealTimeout = 0;
const closingTabIDs = ref<Record<string, boolean>>({});

function isSavedTab(value: unknown): value is SevenTV.TVerinoSavedTab {
	if (!value || typeof value !== "object") return false;

	const candidate = value as Partial<SevenTV.TVerinoSavedTab>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.login === "string" &&
		typeof candidate.displayName === "string"
	);
}

function isSameWorkspace(
	currentWorkspace: Map<string, SevenTV.TVerinoSavedTab>,
	nextWorkspace: Map<string, SevenTV.TVerinoSavedTab>,
): boolean {
	if (currentWorkspace.size !== nextWorkspace.size) return false;

	for (const [channelID, currentTab] of currentWorkspace) {
		const nextTab = nextWorkspace.get(channelID);
		if (!nextTab) return false;
		if (
			nextTab.id !== currentTab.id ||
			nextTab.login !== currentTab.login ||
			nextTab.displayName !== currentTab.displayName
		) {
			return false;
		}
	}

	return true;
}

function restoreWorkspaceFromSession(): void {
	try {
		const rawWorkspace = window.sessionStorage.getItem(TVERINO_WORKSPACE_SESSION_KEY);
		if (!rawWorkspace) return;

		const parsed = JSON.parse(rawWorkspace);
		if (!(parsed instanceof Array)) return;

		const restoredWorkspace = new Map<string, SevenTV.TVerinoSavedTab>();
		for (const entry of parsed) {
			if (!isSavedTab(entry)) continue;
			restoredWorkspace.set(entry.id, {
				id: entry.id,
				login: entry.login,
				displayName: entry.displayName,
			});
		}

		if (restoredWorkspace.size > 0 && !isSameWorkspace(workspace.value, restoredWorkspace)) {
			setWorkspace(restoredWorkspace);
		}
	} catch {
		window.sessionStorage.removeItem(TVERINO_WORKSPACE_SESSION_KEY);
	}
}

function persistWorkspaceToSession(nextWorkspace: Map<string, SevenTV.TVerinoSavedTab>): void {
	try {
		if (nextWorkspace.size === 0) {
			window.sessionStorage.removeItem(TVERINO_WORKSPACE_SESSION_KEY);
			return;
		}

		window.sessionStorage.setItem(
			TVERINO_WORKSPACE_SESSION_KEY,
			JSON.stringify(Array.from(nextWorkspace.values())),
		);
	} catch {
		// Ignore session storage failures and keep the in-memory workspace active.
	}
}

function setWorkspace(nextWorkspace: Map<string, SevenTV.TVerinoSavedTab>): void {
	persistWorkspaceToSession(nextWorkspace);
	workspace.value = nextWorkspace;
}

function getTabContext(channelID: string): ChannelContext | null {
	if (channelID === props.currentCtx.id) return props.currentCtx;
	return remoteCtxByID.get(channelID) ?? null;
}

function resumeTab(channelID: string): void {
	const ctx = getTabContext(channelID);
	if (!ctx) return;

	const scroller = useChatScroller(ctx);
	scroller.setPauseBufferCap(null);
	if (scroller.paused) {
		void scroller.unpause();
	}
}

restoreWorkspaceFromSession();

watch(
	workspace,
	(nextWorkspace) => {
		persistWorkspaceToSession(nextWorkspace);
	},
	{ immediate: true },
);

function ensureRemoteCtx(saved: SevenTV.TVerinoSavedTab): ChannelContext {
	let ctx = remoteCtxByID.get(saved.id);
	if (!ctx) {
		ctx = reactive(new ChannelContext());
		ctx.platform = props.currentCtx.platform;
		remoteCtxByID.set(saved.id, ctx);
	}

	ctx.remote = true;
	ctx.setCurrentChannel({
		id: saved.id,
		username: saved.login.toLowerCase(),
		displayName: saved.displayName,
		active: true,
	});

	ensureUnreadWatcher(ctx);
	return ctx;
}

function ensureUnreadWatcher(ctx: ChannelContext): void {
	if (unreadStops.has(ctx.id)) return;

	const messages = useChatMessages(ctx);
	const scroller = useChatScroller(ctx);
	const stop = watch(
		() => messages.displayed.length,
		(next, prev) => {
			if (typeof prev !== "number" || next <= prev) return;
			if (activeTabID.value === ctx.id) return;

			const nextUnreadCount = Math.min(
				TVERINO_INACTIVE_TAB_MESSAGE_CAP,
				(unreadCounts.value[ctx.id] ?? 0) + (next - prev),
			);

			unreadCounts.value = {
				...unreadCounts.value,
				[ctx.id]: nextUnreadCount,
			};

			if (nextUnreadCount < TVERINO_INACTIVE_TAB_MESSAGE_CAP) return;

			scroller.setPauseBufferCap(TVERINO_INACTIVE_TAB_MESSAGE_CAP);
			if (!scroller.paused) {
				scroller.pause();
			}
		},
	);

	unreadStops.set(ctx.id, stop);
}

ensureUnreadWatcher(props.currentCtx);

watch(
	() => [props.currentCtx.id, props.currentCtx.username] as const,
	([nextID, nextLogin], prev) => {
		const [prevID] = prev ?? ["", ""];

		if (nativeSubscriptionChannelID.value && nativeSubscriptionChannelID.value !== nextID) {
			unsubscribeChannel(nativeSubscriptionChannelID.value);
			nativeSubscriptionChannelID.value = "";
		}

		if (prevID && prevID !== nextID && prevID !== nativeSubscriptionChannelID.value) {
			unsubscribeChannel(prevID);
		}

		if (!nextID || !nextLogin) return;

		subscribeChannel(props.currentCtx.base);
		nativeSubscriptionChannelID.value = nextID;
	},
	{ immediate: true },
);

const remoteTabs = computed<RemoteTab[]>(() =>
	Array.from(workspace.value.values())
		.filter((saved) => saved.id && saved.id !== props.currentCtx.id)
		.map((saved) => ({
			kind: "remote",
			id: saved.id,
			login: saved.login,
			displayName: saved.displayName,
			ctx: ensureRemoteCtx(saved),
		})),
);

const tabs = computed<(NativeTab | RemoteTab)[]>(() => [
	{
		kind: "native",
		id: props.currentCtx.id,
		login: props.currentCtx.username,
		displayName: props.currentCtx.displayName || props.currentCtx.username || "Current Stream",
		ctx: props.currentCtx,
	},
	...remoteTabs.value,
]);

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabID.value) ?? tabs.value[0] ?? null);
const inlineStatus = computed(() => {
	if (activeTab.value?.kind !== "remote") return "";
	if (transportStatus.value.state === "connected") return "";
	return transportStatus.value.reason || "Connecting to Twitch chat...";
});

watch(
	() => currentCtx.id,
	(nextID, prevID) => {
		currentCtx.remote = false;
		ensureUnreadWatcher(currentCtx);

		if (!activeTabID.value || activeTabID.value === prevID) {
			activeTabID.value = nextID;
		}
	},
	{ immediate: true },
);

watch(
	activeTabID,
	(nextID) => {
		if (!nextID) return;
		resumeTab(nextID);
	},
	{ immediate: true },
);

watch(
	remoteTabs,
	(nextTabs) => {
		const nextIDs = new Set(nextTabs.map((tab) => tab.id));

		for (const tab of nextTabs) {
			void hydrateRemoteBadgeSets(tab.ctx);

			if (subscribedRemoteIDs.has(tab.id)) continue;

			subscribedRemoteIDs.add(tab.id);
			subscribeChannel(tab.ctx.base);
		}

		for (const channelID of Array.from(subscribedRemoteIDs)) {
			if (nextIDs.has(channelID)) continue;

			subscribedRemoteIDs.delete(channelID);
			unsubscribeChannel(channelID);
			remoteCtxByID.get(channelID)?.leave();
		}

		if (activeTab.value?.kind === "remote" && !nextIDs.has(activeTab.value.id)) {
			activeTabID.value = props.currentCtx.id;
		}
	},
	{ immediate: true },
);

function selectTab(channelID: string): void {
	if (closingTabIDs.value[channelID]) return;

	activeTabID.value = channelID;

	const existingTimeout = unreadResetTimeouts.get(channelID);
	if (existingTimeout) {
		window.clearTimeout(existingTimeout);
		unreadResetTimeouts.delete(channelID);
	}

	const currentUnread = unreadCounts.value[channelID] ?? 0;
	if (currentUnread <= 0) return;

	unreadResetTimeouts.set(
		channelID,
		window.setTimeout(() => {
			unreadResetTimeouts.delete(channelID);
			unreadCounts.value = {
				...unreadCounts.value,
				[channelID]: 0,
			};
		}, TAB_UNREAD_RESET_DELAY),
	);
}

function isClosingTab(channelID: string): boolean {
	return closingTabIDs.value[channelID] === true;
}

function removeTab(channelID: string): void {
	if (closingTabIDs.value[channelID]) return;

	stopTabLabelAnimation(channelID);
	closingTabIDs.value = {
		...closingTabIDs.value,
		[channelID]: true,
	};

	if (activeTabID.value === channelID) {
		activeTabID.value = props.currentCtx.id;
	}

	closingTabTimeouts.set(
		channelID,
		window.setTimeout(() => {
			closingTabTimeouts.delete(channelID);

			const ctx = remoteCtxByID.get(channelID);
			if (ctx) {
				useChatScroller(ctx).setPauseBufferCap(null);
				useChatMessages(ctx).clear();
			}

			const nextWorkspace = new Map(workspace.value);
			nextWorkspace.delete(channelID);
			setWorkspace(nextWorkspace);

			const nextClosing = { ...closingTabIDs.value };
			delete nextClosing[channelID];
			closingTabIDs.value = nextClosing;
		}, TAB_REMOVE_ANIMATION_DURATION),
	);
}

function toggleAddInput(): void {
	showAddInput.value = !showAddInput.value;
	if (!showAddInput.value) return;

	nextTick(() => addInputRef.value?.focus());
}

function closeAddInput(): void {
	showAddInput.value = false;
	addChannelValue.value = "";
}

function setTabButtonRef(channelID: string, el: Element | ComponentPublicInstance | null): void {
	const previousEl = tabButtonRefs.get(channelID);
	if (previousEl && previousEl !== el) {
		tabLabelResizeObserver?.unobserve(previousEl);
	}

	if (el instanceof HTMLElement) {
		tabButtonRefs.set(channelID, el);
		tabLabelResizeObserver?.observe(el);
	} else {
		stopTabLabelAnimation(channelID);
		tabButtonRefs.delete(channelID);
	}

	queueTabLabelMeasure();
}

function setTabLabelViewportRef(channelID: string, el: Element | ComponentPublicInstance | null): void {
	const previousEl = tabLabelViewportRefs.get(channelID);
	if (previousEl && previousEl !== el) {
		tabLabelResizeObserver?.unobserve(previousEl);
	}

	if (el instanceof HTMLElement) {
		tabLabelViewportRefs.set(channelID, el);
		tabLabelResizeObserver?.observe(el);
	} else {
		tabLabelViewportRefs.delete(channelID);
	}

	queueTabLabelMeasure();
}

function setTabLabelTextRef(channelID: string, el: Element | ComponentPublicInstance | null): void {
	if (el instanceof HTMLElement) {
		tabLabelTextRefs.set(channelID, el);
	} else {
		stopTabLabelAnimation(channelID);
		tabLabelTextRefs.delete(channelID);
	}

	queueTabLabelMeasure();
}

function queueTabLabelMeasure(delay = 0): void {
	window.clearTimeout(tabLabelMeasureTimeout);
	cancelAnimationFrame(tabLabelMeasureFrame);

	const runMeasure = () => {
		tabLabelMeasureFrame = requestAnimationFrame(() => {
			tabLabelMeasureFrame = 0;
			measureTabLabels();
		});
	};

	if (delay > 0) {
		tabLabelMeasureTimeout = window.setTimeout(() => {
			tabLabelMeasureTimeout = 0;
			runMeasure();
		}, delay);
		return;
	}

	runMeasure();
}

function measureTabLabels(): void {
	const nextActiveWidths: Record<string, number> = {};
	const nextCompactWidths: Record<string, number> = {};
	const nextOverflowing: Record<string, number> = {};
	let defaultTabWidth = 0;

	for (const tab of tabs.value) {
		const button = tabButtonRefs.get(tab.id);
		const viewport = tabLabelViewportRefs.get(tab.id);
		const text = tabLabelTextRefs.get(tab.id);
		if (!button || !viewport || !text) continue;

		const overflowDistance = Math.ceil(text.scrollWidth - viewport.clientWidth);
		if (overflowDistance > 4) {
			nextOverflowing[tab.id] = overflowDistance;
		}

		const main = button.querySelector<HTMLElement>(".tab-main");
		const liveDot = button.querySelector<HTMLElement>(".live-dot");
		const unread = button.querySelector<HTMLElement>(".tab-unread");
		const buttonStyle = getComputedStyle(button);
		const mainStyle = main ? getComputedStyle(main) : null;
		const gap = mainStyle ? parseFloat(mainStyle.columnGap || mainStyle.gap || "0") : 0;
		const visibleParts = [liveDot, text, unread].filter(Boolean).length;
		const horizontalChrome =
			(parseFloat(buttonStyle.paddingLeft) || 0) +
			(parseFloat(buttonStyle.paddingRight) || 0) +
			(parseFloat(buttonStyle.borderLeftWidth) || 0) +
			(parseFloat(buttonStyle.borderRightWidth) || 0);
		const contentWidth =
			text.scrollWidth +
			(liveDot?.offsetWidth ?? 0) +
			(unread?.offsetWidth ?? 0) +
			Math.max(0, visibleParts - 1) * gap;
		const measuredWidth = Math.ceil(horizontalChrome + contentWidth);

		if (!defaultTabWidth) {
			defaultTabWidth = resolveCSSWidth(button, buttonStyle.getPropertyValue("--tverino-tab-width"));
		}

		if (tab.id === activeTabID.value) {
			nextActiveWidths[tab.id] = measuredWidth;
			continue;
		}

		if (tab.kind === "remote" && (unreadCounts.value[tab.id] ?? 0) === 0 && measuredWidth < defaultTabWidth) {
			nextCompactWidths[tab.id] = measuredWidth;
		}
	}

	activeTabWidths.value = nextActiveWidths;
	compactTabWidths.value = nextCompactWidths;
	overflowingTabLabels.value = nextOverflowing;
	syncTabsScrollable();
	syncTabLabelAnimations();
}

function hasOverflowingLabel(channelID: string): boolean {
	return (overflowingTabLabels.value[channelID] ?? 0) > 0;
}

function getTabStyle(channelID: string): Record<string, string> | undefined {
	const style: Record<string, string> = {};
	const activeWidth = activeTabWidths.value[channelID];
	const compactWidth = compactTabWidths.value[channelID];

	if (activeWidth) {
		style["--tverino-tab-active-width"] = `${activeWidth}px`;
	}

	if (compactWidth) {
		style["--tverino-tab-compact-width"] = `${compactWidth}px`;
	}

	if (!Object.keys(style).length) return undefined;

	return style;
}

function getAddPanelStyle(): Record<string, string> | undefined {
	if (!addPanelWidth.value) return undefined;

	return {
		"--tverino-add-panel-width": `${addPanelWidth.value}px`,
	};
}

function cancelRunningTabLabelAnimation(channelID: string): void {
	const animationState = tabLabelAnimations.get(channelID);
	if (animationState) {
		animationState.animation.cancel();
		tabLabelAnimations.delete(channelID);
	}

	const textEl = tabLabelTextRefs.get(channelID);
	if (textEl) {
		textEl.style.transform = "";
	}
}

function syncTabLabelAnimations(): void {
	const channelIDs = new Set([...tabButtonRefs.keys(), ...tabLabelAnimations.keys()]);
	for (const channelID of channelIDs) {
		syncTabLabelAnimation(channelID);
	}
}

function syncTabLabelAnimation(channelID: string, forceRestart = false): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		stopTabLabelAnimation(channelID);
		return;
	}

	const overflowDistance = overflowingTabLabels.value[channelID];
	const textEl = tabLabelTextRefs.get(channelID);
	const buttonEl = tabButtonRefs.get(channelID);
	const currentAnimation = tabLabelAnimations.get(channelID);
	const isInteractionLive = !!buttonEl && !buttonEl.classList.contains("active") && isTabInteractionLive(buttonEl);

	if (!overflowDistance || !textEl || !buttonEl || !isInteractionLive) {
		stopTabLabelAnimation(channelID);
		return;
	}

	if (!tabLabelReadyChannels.has(channelID)) {
		cancelRunningTabLabelAnimation(channelID);
		return;
	}

	if (!forceRestart && currentAnimation && Math.abs(currentAnimation.overflowDistance - overflowDistance) <= 1) {
		return;
	}

	cancelRunningTabLabelAnimation(channelID);

	const startHoldDuration = 1000;
	const forwardDuration = Math.max(1600, 700 + overflowDistance * 18);
	const endHoldDuration = 1000;
	const returnDuration = Math.max(620, 250 + overflowDistance * 6);
	const totalDuration = startHoldDuration + forwardDuration + endHoldDuration + returnDuration;
	const startHoldOffset = startHoldDuration / totalDuration;
	const forwardOffset = (startHoldDuration + forwardDuration) / totalDuration;
	const endHoldOffset = (startHoldDuration + forwardDuration + endHoldDuration) / totalDuration;

	const animation = textEl.animate(
		[
			{ transform: "translateX(0)", offset: 0 },
			{ transform: "translateX(0)", offset: startHoldOffset, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
			{ transform: `translateX(-${overflowDistance}px)`, offset: forwardOffset },
			{ transform: `translateX(-${overflowDistance}px)`, offset: endHoldOffset, easing: "linear" },
			{ transform: "translateX(0)", offset: 1 },
		],
		{
			duration: totalDuration,
			fill: "both",
			iterations: Infinity,
		},
	);
	animation.pause();
	animation.currentTime = startHoldDuration;
	animation.play();

	tabLabelAnimations.set(channelID, {
		animation,
		overflowDistance,
	});
}

function startTabLabelAnimation(channelID: string): void {
	const existingTimeout = tabLabelStartTimeouts.get(channelID);
	if (existingTimeout) {
		window.clearTimeout(existingTimeout);
	}

	tabLabelReadyChannels.delete(channelID);
	queueTabLabelMeasure(TAB_LABEL_HOVER_SETTLE_DELAY);

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	tabLabelStartTimeouts.set(
		channelID,
		window.setTimeout(() => {
			tabLabelStartTimeouts.delete(channelID);
			const buttonEl = tabButtonRefs.get(channelID);
			if (!buttonEl || buttonEl.classList.contains("active")) return;
			if (!isTabInteractionLive(buttonEl)) return;

			tabLabelReadyChannels.add(channelID);
			syncTabLabelAnimation(channelID, true);
		}, TAB_LABEL_START_DELAY),
	);
}

function matchesSelectorSafely(el: Element, selector: string): boolean {
	try {
		return el.matches(selector);
	} catch {
		return false;
	}
}

function isTabInteractionLive(buttonEl: HTMLElement): boolean {
	return (
		matchesSelectorSafely(buttonEl, ":hover, :focus") ||
		document.activeElement === buttonEl ||
		buttonEl.contains(document.activeElement)
	);
}

function stopTabLabelAnimation(channelID: string): void {
	const pendingTimeout = tabLabelStartTimeouts.get(channelID);
	if (pendingTimeout) {
		window.clearTimeout(pendingTimeout);
		tabLabelStartTimeouts.delete(channelID);
	}

	tabLabelReadyChannels.delete(channelID);
	cancelRunningTabLabelAnimation(channelID);
}

function shouldCompactTab(tab: NativeTab | RemoteTab): boolean {
	return tab.kind === "remote" && tab.id !== activeTabID.value && (compactTabWidths.value[tab.id] ?? 0) > 0;
}

function resolveCSSWidth(el: HTMLElement, width: string): number {
	const trimmedWidth = width.trim();
	if (!trimmedWidth) return 0;
	if (trimmedWidth.endsWith("px")) return parseFloat(trimmedWidth) || 0;

	const probe = document.createElement("div");
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.pointerEvents = "none";
	probe.style.inset = "0 auto auto 0";
	probe.style.width = trimmedWidth;
	(el.parentElement ?? el).appendChild(probe);
	const pixels = probe.getBoundingClientRect().width;
	probe.remove();

	return pixels;
}

function syncTabsScrollable(): void {
	const tabsEl = tabsRef.value;
	if (!tabsEl) {
		tabsScrollable.value = false;
		return;
	}

	tabsScrollable.value = tabsEl.scrollWidth - tabsEl.clientWidth > 1;
}

function syncAddPanelWidth(): void {
	const inputEl = addInputRef.value;
	if (!inputEl) return;

	const computedStyle = window.getComputedStyle(inputEl);
	const placeholderText = inputEl.placeholder || "";
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return;

	context.font =
		computedStyle.font ||
		`${computedStyle.fontStyle} ${computedStyle.fontWeight} ${computedStyle.fontSize} / ${computedStyle.lineHeight} ${computedStyle.fontFamily}`;

	const horizontalChrome =
		(parseFloat(computedStyle.paddingLeft) || 0) +
		(parseFloat(computedStyle.paddingRight) || 0) +
		(parseFloat(computedStyle.borderLeftWidth) || 0) +
		(parseFloat(computedStyle.borderRightWidth) || 0);

	addPanelWidth.value = Math.ceil(context.measureText(placeholderText).width + horizontalChrome + 8);
}

function onTabsWheel(event: WheelEvent): void {
	const tabsEl = tabsRef.value;
	if (!tabsEl) return;
	if (tabsEl.scrollWidth <= tabsEl.clientWidth) return;

	const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
	if (!delta) return;
	const maxScrollLeft = tabsEl.scrollWidth - tabsEl.clientWidth;
	const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, tabsEl.scrollLeft + delta));
	if (Math.abs(nextScrollLeft - tabsEl.scrollLeft) < 1) return;

	event.preventDefault();
	tabsEl.scrollTo({
		left: nextScrollLeft,
		behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
	});
}

function revealActiveTab(channelID: string | null | undefined): void {
	if (!channelID) return;

	const tabsEl = tabsRef.value;
	const tabButton = tabButtonRefs.get(channelID);
	if (!tabsEl || !tabButton) return;

	const computedStyle = window.getComputedStyle(tabsEl);
	const gap = parseFloat(computedStyle.columnGap || computedStyle.gap || "0") || 0;
	const revealPadding = Math.max(6, Math.round(gap));
	const currentScrollLeft = tabsEl.scrollLeft;
	const viewportRect = tabsEl.getBoundingClientRect();
	const buttonRect = tabButton.getBoundingClientRect();
	const viewportStart = viewportRect.left;
	const viewportEnd = viewportRect.right;
	const buttonStart = buttonRect.left;
	const buttonEnd = buttonRect.right;

	let nextScrollLeft = currentScrollLeft;
	if (buttonStart < viewportStart + revealPadding) {
		nextScrollLeft -= viewportStart + revealPadding - buttonStart;
	} else if (buttonEnd > viewportEnd - revealPadding) {
		nextScrollLeft += buttonEnd - (viewportEnd - revealPadding);
	}

	const maxScrollLeft = Math.max(0, tabsEl.scrollWidth - tabsEl.clientWidth);
	nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
	if (Math.abs(nextScrollLeft - currentScrollLeft) < 1) return;

	tabsEl.scrollTo({
		left: nextScrollLeft,
		behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
	});
}

onClickOutside(actionsRef, () => {
	if (!showAddInput.value) return;

	closeAddInput();
});

useEventListener(tabsRef, "wheel", onTabsWheel, { passive: false });

useResizeObserver(tabsRef, () => {
	queueTabLabelMeasure(TAB_LABEL_LAYOUT_SETTLE_DELAY);
	syncTabsScrollable();
});

useEventListener(window, "resize", () => {
	queueTabLabelMeasure(TAB_LABEL_LAYOUT_SETTLE_DELAY);
	syncTabsScrollable();
	syncAddPanelWidth();
});

watch(
	[tabs, unreadCounts, activeTabID, showAddInput],
	() =>
		nextTick(() => {
			queueTabLabelMeasure();
			syncAddPanelWidth();
		}),
	{
		immediate: true,
		deep: true,
	},
);

const EMPTY_BADGE_SETS: Twitch.BadgeSets = {
	globalsBySet: new Map(),
	channelsBySet: new Map(),
	count: 0,
};

async function hydrateRemoteBadgeSets(ctx: ChannelContext, force = false): Promise<void> {
	if (!ctx.id || (!force && hydratedRemoteBadgeIDs.has(ctx.id))) return;

	hydratedRemoteBadgeIDs.add(ctx.id);

	try {
		const badgeSets = await loadRemoteBadgeSets(ctx);
		const properties = useChatProperties(ctx);
		properties.twitchBadgeSets = mergeBadgeSets(properties.twitchBadgeSets ?? EMPTY_BADGE_SETS, badgeSets);
	} catch {
		hydratedRemoteBadgeIDs.delete(ctx.id);
	}
}

async function loadRemoteBadgeSets(ctx: ChannelContext): Promise<Twitch.BadgeSets> {
	const apolloBadgeSets = apollo.value
		? await fetchRemoteBadgeSetsViaApollo(ctx).catch(() => EMPTY_BADGE_SETS)
		: EMPTY_BADGE_SETS;
	const helixBadgeSets = await getTwitchBadgeSets(ctx.id).catch(() => EMPTY_BADGE_SETS);

	return mergeBadgeSets(apolloBadgeSets, helixBadgeSets);
}

async function fetchRemoteBadgeSetsViaApollo(ctx: ChannelContext): Promise<Twitch.BadgeSets> {
	if (!apollo.value || !ctx.username) {
		return Promise.reject(new Error("Apollo client unavailable"));
	}

	const resp = await apollo.value.query<twitchChannelBadgesQuery.Response, twitchChannelBadgesQuery.Variables>({
		query: twitchChannelBadgesQuery,
		variables: {
			login: ctx.username,
		},
		fetchPolicy: "network-only",
	});

	return mapBadgeSetsFromApollo(resp.data.badges ?? [], resp.data.user?.broadcastBadges ?? []);
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

const stopHelixAuthListener = onTwitchHelixAuthChange(() => {
	for (const tab of remoteTabs.value) {
		void hydrateRemoteBadgeSets(tab.ctx, true);
	}
});

async function submitAddChannel(): Promise<void> {
	const login = addChannelValue.value.trim().replace(/^@+/, "").toLowerCase();
	if (!login) return;
	if (!apollo.value) {
		transportStatus.value = {
			state: "error",
			reason: "Twitch GraphQL client unavailable",
		};
		return;
	}

	for (const saved of workspace.value.values()) {
		if (saved.login.toLowerCase() === login) {
			selectTab(saved.id);
			closeAddInput();
			return;
		}
	}

	if (login === props.currentCtx.username?.toLowerCase()) {
		const nextWorkspace = new Map(workspace.value);
		nextWorkspace.set(props.currentCtx.id, {
			id: props.currentCtx.id,
			login: props.currentCtx.username?.toLowerCase() ?? login,
			displayName: props.currentCtx.displayName || props.currentCtx.username || login,
		});
		setWorkspace(nextWorkspace);
		closeAddInput();
		return;
	}

	const resp = await apollo.value
		.query<twitchChannelLookupQuery.Response, twitchChannelLookupQuery.Variables>({
			query: twitchChannelLookupQuery,
			variables: {
				login,
			},
			fetchPolicy: "network-only",
		})
		.catch(() => null);

	const user = resp?.data?.user;
	if (!user) {
		transportStatus.value = {
			state: "error",
			reason: `Unable to resolve #${login}`,
		};
		return;
	}

	const nextWorkspace = new Map(workspace.value);
	nextWorkspace.set(user.id, {
		id: user.id,
		login: user.login.toLowerCase(),
		displayName: user.displayName || user.login,
	});
	setWorkspace(nextWorkspace);
	activeTabID.value = user.id;
	unreadCounts.value = {
		...unreadCounts.value,
		[user.id]: 0,
	};
	closeAddInput();
}

function onTransportStatus(ev: Event): void {
	transportStatus.value = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_STATUS">>).detail;
}

target.addEventListener("tverino_chat_status", onTransportStatus);

watch(
	activeTab,
	(tab) => {
		activeTarget.value = {
			kind: tab?.kind ?? "native",
			id: tab?.id ?? props.currentCtx.id,
			login: tab?.login ?? props.currentCtx.username ?? "",
			displayName: tab?.displayName ?? props.currentCtx.displayName ?? props.currentCtx.username ?? "",
		};

		void nextTick(() => {
			revealActiveTab(tab?.id);

			window.clearTimeout(activeTabRevealTimeout);
			activeTabRevealTimeout = window.setTimeout(() => {
				revealActiveTab(tab?.id);
			}, TAB_REVEAL_SETTLE_DELAY);
		});
	},
	{ immediate: true },
);

onUnmounted(() => {
	if (nativeSubscriptionChannelID.value) {
		unsubscribeChannel(nativeSubscriptionChannelID.value);
	}

	window.clearTimeout(tabLabelMeasureTimeout);
	window.clearTimeout(activeTabRevealTimeout);
	for (const timeout of tabLabelStartTimeouts.values()) {
		window.clearTimeout(timeout);
	}
	tabLabelStartTimeouts.clear();
	for (const timeout of unreadResetTimeouts.values()) {
		window.clearTimeout(timeout);
	}
	unreadResetTimeouts.clear();
	for (const timeout of closingTabTimeouts.values()) {
		window.clearTimeout(timeout);
	}
	closingTabTimeouts.clear();
	tabLabelReadyChannels.clear();
	cancelAnimationFrame(tabLabelMeasureFrame);
	tabLabelResizeObserver?.disconnect();
	for (const { animation } of tabLabelAnimations.values()) {
		animation.cancel();
	}
	tabLabelAnimations.clear();
	stopHelixAuthListener();
	target.removeEventListener("tverino_chat_status", onTransportStatus);
	activeTarget.value = {
		kind: "native",
		id: props.currentCtx.id,
		login: props.currentCtx.username ?? "",
		displayName: props.currentCtx.displayName ?? props.currentCtx.username ?? "",
	};

	for (const channelID of Array.from(subscribedRemoteIDs)) {
		unsubscribeChannel(channelID);
		remoteCtxByID.get(channelID)?.leave();
	}

	for (const stop of unreadStops.values()) {
		stop();
	}
});
</script>

<style scoped lang="scss">
.seventv-tverino-header {
	display: flex;
	flex-direction: column;
	background: var(--seventv-background-shade-1);
}

.seventv-tverino-shell {
	--tverino-twitch-purple: #9146ff;
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	background: var(--seventv-background-shade-1);
}

.seventv-tverino-tabs-row {
	--tverino-tab-width: 6.5rem;
	--tverino-native-tab-width: 7.4rem;
	--tverino-tab-compact-hover-space: 1.35rem;
	--tverino-tab-active-hover-space: calc(1.7rem - 2px);
	--tverino-tab-remote-hover-space: 1.5rem;
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0.8rem;
	padding: 0.8rem;
	border-top: 0.1rem solid var(--seventv-border-transparent-1);
	border-bottom: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-transparent-2);
}

.seventv-tverino-tabs {
	display: flex;
	align-items: stretch;
	gap: 0.45rem;
	min-width: 0;
	overflow-x: auto;
	overflow-y: hidden;
	padding-bottom: 0.3rem;
	margin-bottom: -0.08rem;
	overscroll-behavior-x: contain;
	scroll-behavior: smooth;
	scrollbar-gutter: stable;
	scrollbar-width: thin;
	scrollbar-color: var(--seventv-border-transparent-1) transparent;

	&::-webkit-scrollbar {
		height: 0.63rem;
	}

	&::-webkit-scrollbar-button {
		width: 0;
		height: 0;
		display: none;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
		border-radius: 999px;
	}

	&::-webkit-scrollbar-thumb {
		border: 0.2rem solid transparent;
		border-radius: 999px;
		background: var(--seventv-border-transparent-1);
		background-clip: padding-box;
	}

	&::-webkit-scrollbar-thumb:hover {
		background: var(--seventv-text-color-secondary);
		background-clip: padding-box;
	}
}

.seventv-tverino-tab {
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	flex: 0 0 var(--tverino-tab-width);
	width: var(--tverino-tab-width);
	min-width: var(--tverino-tab-width);
	max-width: var(--tverino-tab-width);
	height: 3rem;
	padding: 0 0.7rem;
	border: 0.1rem solid rgb(255 255 255 / 0.1);
	border-radius: 0.25rem;
	background:
		linear-gradient(180deg, rgb(255 255 255 / 0.02), rgb(255 255 255 / 0.008)),
		color-mix(in srgb, var(--seventv-background-shade-1) 93%, rgb(255 255 255 / 0.02) 7%);
	color: var(--seventv-text-color-normal);
	outline: none;
	box-shadow:
		inset 0 1px 0 rgb(255 255 255 / 0.03),
		inset 0 0 0 1px rgb(255 255 255 / 0.02);
	transition:
		width 180ms cubic-bezier(0.16, 1, 0.3, 1),
		min-width 180ms cubic-bezier(0.16, 1, 0.3, 1),
		max-width 180ms cubic-bezier(0.16, 1, 0.3, 1),
		padding-left 180ms cubic-bezier(0.16, 1, 0.3, 1),
		padding-right 180ms cubic-bezier(0.16, 1, 0.3, 1),
		margin-right 180ms cubic-bezier(0.16, 1, 0.3, 1),
		background-color 140ms ease,
		border-color 140ms ease,
		box-shadow 140ms ease,
		opacity 140ms ease,
		transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
	overflow: hidden;
	--tverino-tab-close-space: 0rem;

	&.active {
		flex: 0 0 var(--tverino-tab-active-width);
		width: var(--tverino-tab-active-width);
		min-width: var(--tverino-tab-active-width);
		max-width: var(--tverino-tab-active-width);
	}

	&.active.remote:hover,
	&.active.remote:focus-visible {
		--tverino-tab-close-space: var(--tverino-tab-active-hover-space);
		flex: 0 0 calc(var(--tverino-tab-active-width) + var(--tverino-tab-active-hover-space));
		width: calc(var(--tverino-tab-active-width) + var(--tverino-tab-active-hover-space));
		min-width: calc(var(--tverino-tab-active-width) + var(--tverino-tab-active-hover-space));
		max-width: calc(var(--tverino-tab-active-width) + var(--tverino-tab-active-hover-space));
	}

	&.remote:hover:not(.active):not(.compact),
	&.remote:focus-visible:not(.active):not(.compact) {
		--tverino-tab-close-space: var(--tverino-tab-remote-hover-space);
		flex: 0 0 calc(var(--tverino-tab-width) + var(--tverino-tab-remote-hover-space));
		width: calc(var(--tverino-tab-width) + var(--tverino-tab-remote-hover-space));
		min-width: calc(var(--tverino-tab-width) + var(--tverino-tab-remote-hover-space));
		max-width: calc(var(--tverino-tab-width) + var(--tverino-tab-remote-hover-space));
	}

	&.compact {
		flex: 0 0 var(--tverino-tab-compact-width);
		width: var(--tverino-tab-compact-width);
		min-width: var(--tverino-tab-compact-width);
		max-width: var(--tverino-tab-compact-width);
	}

	&.unread {
		padding-right: calc(0.7rem - 4px);
	}

	&.active.remote.unread:hover,
	&.active.remote.unread:focus-visible {
		flex: 0 0 var(--tverino-tab-active-width);
		width: var(--tverino-tab-active-width);
		min-width: var(--tverino-tab-active-width);
		max-width: var(--tverino-tab-active-width);
	}

	&.remote.unread:hover:not(.active):not(.compact),
	&.remote.unread:focus-visible:not(.active):not(.compact) {
		flex: 0 0 var(--tverino-tab-width);
		width: var(--tverino-tab-width);
		min-width: var(--tverino-tab-width);
		max-width: var(--tverino-tab-width);
	}

	&.native:not(.active) {
		flex: 0 0 var(--tverino-native-tab-width);
		width: var(--tverino-native-tab-width);
		min-width: var(--tverino-native-tab-width);
		max-width: var(--tverino-native-tab-width);
	}

	&.native {
		color: var(--seventv-text-color-normal);
	}

	&.native:hover,
	&.native:focus-visible {
		background:
			linear-gradient(180deg, rgb(255 255 255 / 0.04), rgb(255 255 255 / 0.015)),
			color-mix(in srgb, var(--seventv-background-shade-1) 88%, rgb(255 255 255 / 0.035) 12%);
	}

	&.native.active {
		background:
			linear-gradient(180deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0.018)),
			color-mix(in srgb, var(--seventv-background-shade-1) 86%, rgb(255 255 255 / 0.04) 14%);
		border-color: rgb(255 255 255 / 0.14);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.045),
			inset 0 0 0 1px rgb(255 255 255 / 0.03),
			0 0.5rem 1.1rem rgb(0 0 0 / 0.14);
	}

	&.remote.active {
		background:
			linear-gradient(180deg, rgb(255 255 255 / 0.03), rgb(255 255 255 / 0.012)),
			color-mix(in srgb, var(--seventv-background-shade-1) 90%, rgb(255 255 255 / 0.03) 10%);
		border-color: rgb(255 255 255 / 0.13);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.04),
			inset 0 0 0 1px rgb(255 255 255 / 0.025),
			0 0.5rem 1.1rem rgb(0 0 0 / 0.12);
	}

	&.compact:hover,
	&.compact:focus-visible {
		--tverino-tab-close-space: var(--tverino-tab-compact-hover-space);
		flex: 0 0 calc(var(--tverino-tab-compact-width) + var(--tverino-tab-compact-hover-space));
		width: calc(var(--tverino-tab-compact-width) + var(--tverino-tab-compact-hover-space));
		min-width: calc(var(--tverino-tab-compact-width) + var(--tverino-tab-compact-hover-space));
		max-width: calc(var(--tverino-tab-compact-width) + var(--tverino-tab-compact-hover-space));
	}

	&:hover:not(.active) {
		background: var(--seventv-highlight-neutral-1);
	}

	&:focus-visible {
		border-color: var(--tverino-twitch-purple);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--tverino-twitch-purple) 78%, transparent 22%);
	}

	&:not(.active) {
		color: var(--seventv-text-color-secondary);
	}

	&.closing {
		pointer-events: none;
		opacity: 0;
		padding-left: 0;
		padding-right: 0;
		margin-right: -0.45rem;
		border-color: transparent;
		box-shadow: none;
		transform: scale(0.94);
		flex: 0 0 0 !important;
		width: 0 !important;
		min-width: 0 !important;
		max-width: 0 !important;
	}
}

.tab-main {
	display: flex;
	align-items: center;
	gap: var(--tverino-tab-main-gap, 0.45rem);
	min-width: 0;
	flex: 1 1 auto;
	padding-right: var(--tverino-tab-close-space);
	transition: padding-right 180ms cubic-bezier(0.16, 1, 0.3, 1);
	overflow: visible;
}

.seventv-tverino-tab.active .tab-main {
	flex: 0 0 auto;
}

.live-dot {
	width: 0.7rem;
	height: 0.7rem;
	border-radius: 999px;
	background: #ff5454;
	box-shadow: 0 0 0.75rem rgb(255 84 84 / 45%);
	flex: 0 0 auto;
}

.tab-label {
	position: relative;
	display: block;
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	mask-image: linear-gradient(90deg, #000 0, #000 81%, transparent 100%);
}

.tab-label.overflow {
	mask-image: linear-gradient(90deg, #000 0, #000 79%, transparent 100%);
}

.tab-label-text {
	display: inline-block;
	min-width: 0;
	width: max-content;
	white-space: nowrap;
	font-weight: 700;
	color: inherit;
	transition: color 140ms ease;
	will-change: transform;
}

.seventv-tverino-tab.active .tab-label {
	mask-image: none;
}

.seventv-tverino-tab.active .tab-label-text {
	animation: none !important;
	transform: translateX(0);
}

.tab-unread {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.8rem;
	max-width: 2.8rem;
	height: 1.8rem;
	padding: 0.1rem 0.5rem;
	border-radius: 999px;
	background: var(--seventv-highlight-neutral-1);
	color: var(--seventv-text-color-normal);
	font-size: 1.1rem;
	font-weight: 700;
	flex: 0 0 auto;
	transform: translateX(-1px);
	overflow: hidden;
	white-space: nowrap;
	transition:
		opacity 120ms ease,
		max-width 150ms ease,
		padding 150ms ease,
		margin 150ms ease,
		transform 150ms ease;
}

.tab-unread-text {
	font-size: 0.9em;
	transform: translateY(1px);
}

.seventv-tverino-tab.remote:hover .tab-unread,
.seventv-tverino-tab.remote:focus-visible .tab-unread {
	opacity: 0;
	flex-basis: 0;
	min-width: 0;
	max-width: 0;
	padding-left: 0;
	padding-right: 0;
	margin-left: -0.15rem;
}

.seventv-tverino-tab.remote:hover,
.seventv-tverino-tab.remote:focus-visible {
	--tverino-tab-main-gap: 0rem;
}

.tab-close {
	position: absolute;
	top: calc(50% - 1px);
	right: calc(0.65rem - 2px);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.45rem;
	height: 1.45rem;
	padding: 0;
	border-radius: 999px;
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
	font-weight: 400;
	line-height: 1;
	opacity: 0;
	pointer-events: none;
	transform: translate(0.35rem, -50%) scale(0.88);
	transition:
		opacity 144ms ease,
		transform 144ms ease,
		background-color 144ms ease;
	transition-delay: 0s, 0s, 0s;
	user-select: none;

	&:hover {
		background: var(--seventv-highlight-neutral-1);
		color: var(--seventv-text-color-normal);
	}
}

.seventv-tverino-tab.remote:hover .tab-close,
.seventv-tverino-tab.remote:focus-visible .tab-close {
	opacity: 1;
	pointer-events: auto;
	transform: translate(0, -50%) scale(1);
	transition-delay: 180ms, 180ms, 0s;
}

.seventv-tverino-actions {
	position: relative;
	flex: 0 0 3.4rem;
	width: 3.4rem;
	min-width: 3.4rem;
	top: -0.2rem;
	display: flex;
	align-items: center;
	justify-content: flex-end;

	&.scrollable {
		top: -0.6rem;
	}
}

.seventv-tverino-add-panel {
	position: absolute;
	top: 50%;
	right: calc(100% + 0.45rem);
	z-index: 1;
	width: var(--tverino-add-panel-width, 12rem);
	max-width: 0;
	opacity: 0;
	overflow: hidden;
	pointer-events: none;
	transform: translate(0.6rem, -50%) scale(0.96);
	transform-origin: right center;
	transition:
		max-width 220ms cubic-bezier(0.16, 1, 0.3, 1),
		opacity 160ms ease,
		transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.seventv-tverino-actions.open .seventv-tverino-add-panel {
	max-width: var(--tverino-add-panel-width, 12rem);
	opacity: 1;
	pointer-events: auto;
	transform: translate(0, -50%) scale(1);
}

.seventv-tverino-add-form {
	width: var(--tverino-add-panel-width, 12rem);
	min-width: var(--tverino-add-panel-width, 12rem);
}

.seventv-tverino-add-input,
.seventv-tverino-add-button {
	height: 3.2rem;
	border-radius: 0.25rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-shade-1);
	color: var(--seventv-text-color-normal);
}

.seventv-tverino-add-input {
	width: 100%;
	padding: 0 1rem;
	outline: none;
	border-color: rgb(255 255 255 / 0.1);
	background:
		linear-gradient(180deg, rgb(255 255 255 / 0.02), rgb(255 255 255 / 0.008)),
		color-mix(in srgb, var(--seventv-background-shade-1) 93%, rgb(255 255 255 / 0.02) 7%);
	box-shadow:
		inset 0 1px 0 rgb(255 255 255 / 0.03),
		inset 0 0 0 1px rgb(255 255 255 / 0.02);
	transition:
		outline 140ms ease,
		border-color 140ms ease,
		box-shadow 140ms ease,
		background-color 140ms ease;

	&:focus {
		outline: 1px solid var(--tverino-twitch-purple);
		border-color: var(--tverino-twitch-purple);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.045),
			inset 0 0 0 1px rgb(255 255 255 / 0.03),
			0 0.5rem 1.1rem rgb(0 0 0 / 0.14);
	}
}

.seventv-tverino-add-button {
	appearance: none;
	position: relative;
	top: 0;
	width: 3.4rem;
	padding: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 2rem;
	line-height: 1;
	border-color: rgb(255 255 255 / 0.1);
	background:
		linear-gradient(180deg, rgb(255 255 255 / 0.02), rgb(255 255 255 / 0.008)),
		color-mix(in srgb, var(--seventv-background-shade-1) 93%, rgb(255 255 255 / 0.02) 7%);
	box-shadow:
		inset 0 1px 0 rgb(255 255 255 / 0.03),
		inset 0 0 0 1px rgb(255 255 255 / 0.02);
	transform: translateY(0);
	transition:
		background-color 140ms ease,
		border-color 140ms ease,
		box-shadow 140ms ease;

	&:hover {
		background:
			linear-gradient(180deg, rgb(255 255 255 / 0.04), rgb(255 255 255 / 0.015)),
			color-mix(in srgb, var(--seventv-background-shade-1) 88%, rgb(255 255 255 / 0.035) 12%);
	}

	&:focus-visible {
		outline: none;
		border-color: rgb(255 255 255 / 0.14);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.045),
			inset 0 0 0 1px rgb(255 255 255 / 0.03),
			0 0.5rem 1.1rem rgb(0 0 0 / 0.14);
	}

	&:active {
		top: 0;
		transform: translateY(0);
	}
}

.seventv-tverino-add-button-glyph {
	display: block;
	transform: translateY(-0.2rem);
}

.seventv-tverino-actions.open .seventv-tverino-add-button {
	background:
		linear-gradient(180deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0.018)),
		color-mix(in srgb, var(--seventv-background-shade-1) 86%, rgb(255 255 255 / 0.04) 14%);
	border-color: rgb(255 255 255 / 0.14);
	box-shadow:
		inset 0 1px 0 rgb(255 255 255 / 0.045),
		inset 0 0 0 1px rgb(255 255 255 / 0.03),
		0 0.5rem 1.1rem rgb(0 0 0 / 0.14);
}

.seventv-tverino-inline-status {
	padding: 0.65rem 0.8rem 0.8rem;
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
}

.seventv-tverino-body {
	display: flex;
	flex: 1 1 auto;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	box-sizing: border-box;
	background: var(--seventv-background-shade-1);
}

@media (prefers-reduced-motion: reduce) {
	.seventv-tverino-tabs {
		scroll-behavior: auto;
	}

	.seventv-tverino-tab,
	.tab-close,
	.seventv-tverino-add-panel,
	.seventv-tverino-add-input,
	.seventv-tverino-add-button,
	.tab-label-text {
		transition: none;
		animation: none !important;
	}
}
</style>
