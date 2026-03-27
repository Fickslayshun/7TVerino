<template>
	<main ref="chatListEl" class="seventv-chat-list">
		<div v-if="topSpacerHeight" class="seventv-message-spacer" :style="{ height: `${topSpacerHeight}px` }" />
		<div
			v-for="row of renderedRows"
			:key="row.msg.sym"
			:ref="(el) => setRowRef(row.msg.sym, row.hydrated ? (el as HTMLElement | null) : null)"
			:msg-id="row.msg.id"
			class="seventv-message"
			:class="{ dehydrated: !row.hydrated }"
			:style="!row.hydrated ? { height: `${row.height}px` } : undefined"
		>
			<template v-if="row.hydrated && row.msg.instance">
				<ModSlider
					v-if="
						!props.disableModSlider &&
						isModSliderEnabled &&
						ctx.actor.roles.has('MODERATOR') &&
						row.msg.author
					"
					:msg="row.msg"
				>
					<component :is="row.msg.instance" v-slot="slotProps" v-bind="row.msg.componentProps" :msg="row.msg">
						<UserMessage
							v-bind="slotProps"
							:msg="row.msg"
							:emotes="emotes.active"
							:chatters="messages.chattersByUsername"
							:hydrated="row.hydrated"
							:show-rich-embeds="performance.richEmbedsEnabled.value"
						/>
					</component>
				</ModSlider>
				<component
					:is="row.msg.instance"
					v-else
					v-slot="slotProps"
					v-bind="row.msg.componentProps"
					:msg="row.msg"
				>
					<UserMessage
						v-bind="slotProps"
						:msg="row.msg"
						:emotes="emotes.active"
						:chatters="messages.chattersByUsername"
						:hydrated="row.hydrated"
						:show-rich-embeds="performance.richEmbedsEnabled.value"
					/>
				</component>
			</template>
			<template v-else-if="row.hydrated">
				<ChatMessageUnhandled :msg="row.msg" />
			</template>
			<template v-else>
				<span class="seventv-message-placeholder-text">{{ renderPlaceholderText(row.msg) }}</span>
			</template>
		</div>
		<div v-if="bottomSpacerHeight" class="seventv-message-spacer" :style="{ height: `${bottomSpacerHeight}px` }" />
	</main>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, toRef, watch } from "vue";
import {
	until,
	useDocumentVisibility,
	useEventListener,
	useKeyModifier,
	useTimeoutFn,
	watchDebounced,
} from "@vueuse/core";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { normalizeUsername } from "@/common/Color";
import { log } from "@/common/Logger";
import { HookedInstance } from "@/common/ReactHooks";
import { defineFunctionHook, unsetPropertyHook } from "@/common/Reflection";
import { convertCheerEmote, convertTwitchEmote } from "@/common/Transform";
import { ChatMessage, ChatMessageModeration, ChatUser, LowTrustUserProperties } from "@/common/chat/ChatMessage";
import type { NormalizedChatMessage } from "@/common/chat/PerformanceProcessor";
import { IsChatMessage, IsDisplayableMessage, IsModerationMessage } from "@/common/type-predicates/Messages";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatHighlights } from "@/composable/chat/useChatHighlights";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useChatScroller } from "@/composable/chat/useChatScroller";
import { useOpenUserCards } from "@/composable/chat/useOpenUserCards";
import { usePersonalTimeouts } from "@/composable/chat/usePersonalTimeouts";
import { useCosmetics } from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import { WorkletEvent, useWorker } from "@/composable/useWorker";
import { MessagePartType, MessageType, ModerationType } from "@/site/twitch.tv/";
import ChatMessageUnhandled from "./ChatMessageUnhandled.vue";
import ModSlider from "./components/mod/ModSlider.vue";
import UserMessage from "@/app/chat/UserMessage.vue";
import BasicSystemMessage from "@/app/chat/msg/BasicSystemMessage.vue";

const CHAT_WORKER_TIMEOUT_MS = 40;
const HYDRATION_OVERSCAN_ABOVE = 4;
const HYDRATION_OVERSCAN_BELOW = 8;

const props = defineProps<{
	list: HookedInstance<Twitch.ChatListComponent>;
	restrictions?: HookedInstance<Twitch.ChatRestrictionsComponent>;
	messageHandler: Twitch.MessageHandlerAPI | null;
	sharedChatData: Map<string, Twitch.SharedChat> | null;
	forceHydrated?: boolean;
	disableModSlider?: boolean;
}>();

const ctx = useChannelContext();
const { identity } = storeToRefs(useStore());
const emotes = useChatEmotes(ctx);
const messages = useChatMessages(ctx);
const openUserCards = useOpenUserCards();
const displayedMessages = toRef(messages, "displayed");
const personalTimeouts = usePersonalTimeouts();
const visibleMessages = computed(() =>
	displayedMessages.value.filter((message) => {
		if (openUserCards.isOpen(message.sym)) return true;

		return !personalTimeouts.shouldHideMessage(ctx, message);
	}),
);
const scroller = useChatScroller(ctx);
const performance = useChatPerformance(ctx);
const properties = useChatProperties(ctx);
const chatHighlights = useChatHighlights(ctx);
const { sendMessage: sendWorkerMessage, target: workerTarget } = useWorker();
const pageVisibility = useDocumentVisibility();
const isHovering = toRef(properties, "hovering");
const pausedByVisibility = ref(false);

const hideSharedChat = useConfig<boolean>("chat.hide_shared_chat");
const isModSliderEnabled = useConfig<boolean>("chat.mod_slider");
const showModerationMessages = useConfig<boolean>("chat.mod_messages");
const showMentionHighlights = useConfig("highlights.basic.mention");
const showFirstTimeChatter = useConfig<boolean>("highlights.basic.first_time_chatter");
const showSelfHighlights = useConfig<boolean>("highlights.basic.self");
const shouldFlashTitleOnHighlight = useConfig<boolean>("highlights.basic.mention_title_flash");
const showRestrictedLowTrustUser = useConfig<boolean>("highlights.basic.restricted_low_trust_user");
const showMonitoredLowTrustUser = useConfig<boolean>("highlights.basic.monitored_low_trust_user");
const showModifiers = useConfig<boolean>("chat.show_emote_modifiers");

const messageHandler = toRef(props, "messageHandler");
const list = toRef(props, "list");
const sharedChatData = toRef(props, "sharedChatData");
const restrictions = toRef(props, "restrictions");

// Unrender messages out of view
const chatListEl = ref<HTMLElement>();
const rowHeights = new Map<symbol, number>();
const rowElements = new Map<symbol, HTMLElement>();
const rowLookup = new WeakMap<HTMLElement, symbol>();
const visibleRange = reactive({ start: 0, end: 0 });
const renderedRange = reactive({ start: 0, end: 0 });
const topSpacerHeight = ref(0);
const bottomSpacerHeight = ref(0);
const estimatedRowHeight = ref(32);

const rowObserver = new ResizeObserver((entries) => {
	const shouldStick = shouldStickToBottom();
	let updated = false;

	for (const entry of entries) {
		const element = entry.target as HTMLElement;
		const sym = rowLookup.get(element);
		if (!sym) continue;

		const height = Math.ceil(entry.contentRect.height);
		if (!height || rowHeights.get(sym) === height) continue;

		rowHeights.set(sym, height);
		estimatedRowHeight.value = Math.max(estimatedRowHeight.value, Math.min(height, 72));
		updated = true;
	}

	if (updated) {
		queueVirtualLayout(shouldStick);
	}
});

const types = import.meta.glob<object>("@/app/chat/msg/*.vue", { eager: true, import: "default" });
const typeMap = {} as Record<number, ComponentFactory>;

const componentRegexp = /src\/app\/chat\/msg\/(\d+)\.(\w+)\.vue$/;
for (const [path, component] of Object.entries(types)) {
	const [, type] = path.match(componentRegexp) ?? [];
	if (!type) continue;

	const t = parseInt(type);
	if (Number.isNaN(t)) continue;

	typeMap[t] = component as ComponentFactory;
}

function getMessageComponent(type: MessageType) {
	return typeMap[type] ?? null;
}

function getTwitchAuthorData(msgData: Twitch.AnyMessage): Twitch.ChatUser | null {
	return msgData.user ?? msgData.message?.user ?? (msgData as Twitch.RestrictedLowTrustUserMessage).sender ?? null;
}

function hydrateLowTrustUserFromMessage(msgData: Twitch.AnyMessage, authorID: string): void {
	const monitored = msgData.message?.monitored;
	if (!monitored) return;

	const existing = messages.lowTrustUsers[authorID];
	messages.lowTrustUsers[authorID] = {
		id: existing?.id ?? `${ctx.id}:${authorID}`,
		types: monitored.types ?? existing?.types ?? [],
		banEvasion: {
			likelihood:
				(monitored.ban_evasion_evaluation as LowTrustUserProperties["banEvasion"]["likelihood"]) ??
				existing?.banEvasion.likelihood ??
				"POSSIBLE",
			evaluatedAt: existing?.banEvasion.evaluatedAt ?? null,
		},
		sharedBanChannels: existing?.sharedBanChannels ?? [],
		treatment: {
			type:
				monitored.treatment === "NO_TREATMENT"
					? "NONE"
					: (monitored.treatment as LowTrustUserProperties["treatment"]["type"]),
			updatedAt: existing?.treatment.updatedAt ?? null,
			updatedBy: monitored.updated_by?.userLogin ?? existing?.treatment.updatedBy ?? null,
		},
		channelSharedBansUpdatedAt: existing?.channelSharedBansUpdatedAt ?? null,
	};
}

const pendingWorkerMessages = new Map<
	string,
	{
		resolve: (result: NormalizedChatMessage | null) => void;
		timeout: number;
	}
>();

function onWorkerChatMessageProcessed(ev: WorkletEvent<"chat_message_processed">) {
	const pending = pendingWorkerMessages.get(ev.detail.requestID);
	if (!pending) return;

	clearTimeout(pending.timeout);
	pendingWorkerMessages.delete(ev.detail.requestID);

	if (ev.detail.error || !ev.detail.result) {
		performance.disableWorkerPath(ev.detail.error ?? "invalid worker preprocessing result");
		pending.resolve(null);
		return;
	}

	pending.resolve(ev.detail.result);
}

workerTarget.addEventListener("chat_message_processed", onWorkerChatMessageProcessed);

onUnmounted(() => {
	workerTarget.removeEventListener("chat_message_processed", onWorkerChatMessageProcessed);

	for (const pending of pendingWorkerMessages.values()) {
		clearTimeout(pending.timeout);
		pending.resolve(null);
	}

	pendingWorkerMessages.clear();
});

let virtualLayoutFrame: number | null = null;
let forceStickToBottom = false;

const renderedRows = computed(() => {
	if (props.forceHydrated) {
		return visibleMessages.value.map((msg, index) => ({
			msg,
			index,
			height: getRowHeight(msg),
			hydrated: true,
		}));
	}

	return visibleMessages.value.slice(renderedRange.start, renderedRange.end).map((msg, offset) => {
		const index = renderedRange.start + offset;
		return {
			msg,
			index,
			height: getRowHeight(msg),
			hydrated: !performance.virtualizationEnabled.value || isHydratedIndex(index),
		};
	});
});

useEventListener(
	() => scroller.container,
	"scroll",
	() => queueVirtualLayout(false),
	{ passive: true },
);

watch(
	() => displayedMessages.value.map((message) => message.sym),
	(messageSyms) => {
		pruneRowMeasurements(new Set(messageSyms));
	},
	{ immediate: true },
);

watch(
	() => visibleMessages.value.map((message) => message.sym),
	() => queueVirtualLayout(shouldStickToBottom()),
	{ immediate: true },
);

watch([() => scroller.bounds?.height, performance.virtualizationEnabled], () => queueVirtualLayout(false), {
	immediate: true,
});

watch(openUserCards.version, () => queueVirtualLayout(false));

onUnmounted(() => {
	if (virtualLayoutFrame !== null) {
		cancelAnimationFrame(virtualLayoutFrame);
		virtualLayoutFrame = null;
	}

	rowObserver.disconnect();
	rowElements.clear();
	rowHeights.clear();
});

// Determine if the message should perform some action or be sent to the chatAPI for rendering
const onMessage = (msgData: Twitch.AnyMessage): boolean => {
	const msg = new ChatMessage(msgData.id);

	msg.channelID = ctx.id;

	// Send message to our registered message handlers
	messages.handlers.forEach((h) => h(msgData));

	switch (msgData.type) {
		case MessageType.MESSAGE:
		case MessageType.SUBSCRIPTION:
		case MessageType.RESUBSCRIPTION:
		case MessageType.SUB_GIFT:
		case MessageType.RAID:
		case MessageType.SUB_MYSTERY_GIFT:
		case MessageType.ANNOUNCEMENT_MESSAGE:
		case MessageType.RESTRICTED_LOW_TRUST_USER_MESSAGE:
		case MessageType.BITS_BADGE_TIER_MESSAGE:
		case MessageType.VIEWER_MILESTONE:
		case MessageType.CONNECTED:
			onChatMessage(msg, msgData);
			break;

		case MessageType.CHANNEL_POINTS_REWARD:
			if (!(msgData as Twitch.ChannelPointsRewardMessage).animationID) {
				onChatMessage(msg, msgData);
			} else {
				return false;
			}
			break;

		case MessageType.MODERATION:
			if (!IsModerationMessage(msgData)) break;

			onModerationMessage(msgData);
			break;
		case MessageType.MESSAGE_ID_UPDATE:
			onMessageIdUpdate(msgData as Twitch.IDUpdateMessage);
			break;
		default:
			return false;
	}

	return true;
};

function onChatMessage(msg: ChatMessage, msgData: Twitch.AnyMessage, shouldRender = true) {
	const c = getMessageComponent(msgData.type);
	if (c) {
		msg.setComponent(c, { msgData: msgData });
	}

	if (!msg.instance) {
		msg.setComponent(typeMap[0], { msgData: msgData });
	}

	if (msgData.type === MessageType.RESTRICTED_LOW_TRUST_USER_MESSAGE && showRestrictedLowTrustUser.value) {
		msg.setHighlight("#ff7d00", "Restricted Suspicious User");
	}

	let sourceRoomID =
		msgData.sourceRoomID ?? msgData.sharedChat?.sourceRoomID ?? msgData.message?.sourceRoomID ?? null;
	if (!sourceRoomID && msgData.nonce) {
		sourceRoomID = msg.channelID;
	}

	if (hideSharedChat.value && msg.channelID != sourceRoomID) {
		return;
	}

	if (sourceRoomID && !hideSharedChat.value) {
		msgData.sourceData = sharedChatData.value?.get(sourceRoomID);
		msg.setSourceData(msgData.sourceData);
	}

	// define message author
	const authorData = getTwitchAuthorData(msgData);
	if (authorData) {
		const knownChatter = messages.chatters[authorData.userID];
		const color = authorData.color
			? properties.useHighContrastColors
				? normalizeUsername(authorData.color, properties.isDarkTheme as 0 | 1)
				: authorData.color
			: null;

		if (knownChatter) {
			knownChatter.username = authorData.userLogin;
			knownChatter.displayName = authorData.userDisplayName ?? authorData.displayName ?? authorData.userLogin;
			knownChatter.color = color ?? knownChatter.color;
			knownChatter.intl = authorData.isIntl;
		}

		msg.setAuthor(
			knownChatter ?? {
				id: authorData.userID,
				username: authorData.userLogin ?? (authorData.userDisplayName ?? authorData.displayName)?.toLowerCase(),
				displayName: authorData.userDisplayName ?? authorData.displayName ?? authorData.userLogin,
				intl: authorData.isIntl,
				color,
			},
		);

		// check blocked state and ignore if blocked
		if (msg.author && properties.blockedUsers.has(msg.author.id)) {
			if (!ctx.actor.roles.has("MODERATOR")) {
				log.debug("Ignored message from blocked user", msg.author.id);
				return;
			}

			msg.setHighlight("#9488855A", "You Blocked This User");
		}

		if (identity.value && msg.author && msg.author.id === identity.value.id) {
			msg.author.isActor = true;
		}

		msg.badges = msgData.badges ?? msgData.message?.badges ?? {};
		msg.badgeData = msgData.badgeDynamicData ?? {};
		hydrateLowTrustUserFromMessage(msgData, authorData.userID);
	}

	if (IsDisplayableMessage(msgData)) {
		msg.body = (msgData.messageBody ?? msgData.message?.messageBody ?? "").replace("\n", " ");
		msg.first = msgData.isFirstMsg;

		if (typeof msgData.nonce === "string") msg.setNonce(msgData.nonce);

		// assign highlight
		if (msgData.isFirstMsg && showFirstTimeChatter.value) {
			msg.setHighlight("#c832c8", "First Message");
		}

		if (msg.author) {
			const lowTrust = messages.lowTrustUsers[msg.author.id];

			if (lowTrust && lowTrust.treatment.type === "ACTIVE_MONITORING" && showMonitoredLowTrustUser.value) {
				msg.setHighlight("#ff7d00", "Monitored Suspicious User");
			}
		}

		// assign parent message data
		if (msgData.reply) {
			const parentMsgAuthor =
				msgData.reply.parentUserLogin && msgData.reply.parentDisplayName
					? {
							username: msgData.reply.parentUserLogin,
							displayName: msgData.reply.parentDisplayName,
					  }
					: null;
			const parentMsgThread =
				msgData.reply && msgData.reply.threadParentMsgId && msgData.reply.threadParentUserLogin
					? {
							deleted: msgData.reply.threadParentDeleted,
							id: msgData.reply.threadParentMsgId,
							login: msgData.reply.threadParentUserLogin,
					  }
					: null;

			msg.parent = {
				id: msgData.reply.parentMsgId ?? "",
				uid: msgData.reply.parentUid ?? "",
				deleted: msgData.reply.parentDeleted ?? false,
				body: msgData.reply.parentMessageBody ?? "",
				author: parentMsgAuthor,
				thread: parentMsgThread,
			};
		}

		// message is /me
		if (msgData.messageType === 1) {
			msg.slashMe = true;
		}

		// assign native emotes
		for (const part of msgData.messageParts ?? msgData.message?.messageParts ?? []) {
			switch (part.type) {
				// capture native emotes
				case MessagePartType.EMOTE: {
					const e = part.content as Twitch.ChatMessage.EmotePart["content"];
					if (!e.alt) continue;

					// skip over emotes patched in by FFZ and BTTV
					if (e.emoteID?.startsWith("__FFZ__") || e.emoteID?.startsWith("__BTTV__")) continue;

					const nativeEmote: SevenTV.ActiveEmote = {
						id: e.emoteID ?? "",
						name: e.alt,
						flags: 0,
						provider: "PLATFORM",
						isTwitchCheer: {
							amount: e.cheerAmount!,
							color: e.cheerColor!,
						},
						data: e.cheerAmount
							? convertCheerEmote({
									alt: e.alt,
									cheerAmount: e.cheerAmount,
									cheerColor: e.cheerColor,
									images: e.images,
							  })
							: convertTwitchEmote({
									id: e.emoteID,
									token: e.alt,
							  } as Partial<Twitch.TwitchEmote>),
					};
					const emoteName = e.alt + (e.cheerAmount ?? "");

					msg.nativeEmotes[emoteName] = nativeEmote;

					// if it's a cheer we also want to support it's lowercase variant (e.g. Cheer1 & cheer1)
					if (e.cheerAmount) {
						msg.nativeEmotes[emoteName.toLowerCase()] = nativeEmote;
					}
					break;
				}
				// replace flagged segments
				case MessagePartType.FLAGGEDSEGMENT: {
					const e = part as Twitch.ChatMessage.FlaggedSegmentPart;
					if (!e.originalText) continue;

					msg.body = msg.body.replace(e.originalText, "*".repeat(e.originalText.length));
					break;
				}
			}
		}
	}

	// message is sent by the current user
	if (msgData.nonce) {
		msg.setDeliveryState("IN_FLIGHT");

		// Set a timeout, beyond which we'll consider the message failed to send
		const { stop } = useTimeoutFn(() => {
			msg.setDeliveryState("BOUNCED");
		}, 1e4);

		until(ref(msg.deliveryState)).toBe("SENT").then(stop);
	}

	if (IsChatMessage(msgData)) msg.setTimestamp(msgData.timestamp);
	else if (msgData.message) msg.setTimestamp(msgData.message.timestamp ?? 0);

	const finalize = (processed: NormalizedChatMessage | null) => {
		if (processed) {
			msg.tokens = processed.tokens;
			msg.tokenizationSignature = buildMessageWorkerSignature(msg);
			msg.mentions = new Set(processed.mentions);
			msg.emoteLinkEmbed = processed.emoteLinkEmbed;

			for (const highlightID of processed.matchedHighlightIDs) {
				chatHighlights.checkMatch(highlightID, msg);
			}

			if (!processed.matchedHighlightIDs.length && processed.highlight) {
				msg.setHighlight(processed.highlight.color, processed.highlight.label);
			}
		} else {
			chatHighlights.checkAll(msg);
		}

		if (ctx.actor.roles.has("MODERATOR")) {
			msg.pinnable = true;
			msg.deletable = true;
		}

		if (shouldRender) messages.add(msg);
	};

	if (performance.workerPathEnabled.value && IsDisplayableMessage(msgData)) {
		void preprocessMessage(msg, sourceRoomID).then(finalize);
		return;
	}

	finalize(null);
}

function preprocessMessage(msg: ChatMessage, sourceRoomID: string | null): Promise<NormalizedChatMessage | null> {
	const parts = getUniqueMessageParts(msg.body);
	const cosmetics = msg.author ? useCosmetics(msg.author.id) : null;
	const requestID = `${msg.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

	return new Promise((resolve) => {
		const timeout = window.setTimeout(() => {
			pendingWorkerMessages.delete(requestID);
			performance.disableWorkerPath("chat preprocessing timed out");
			resolve(null);
		}, CHAT_WORKER_TIMEOUT_MS);

		pendingWorkerMessages.set(requestID, {
			resolve: (result) => {
				if (result && result.id !== msg.id) {
					performance.disableWorkerPath("worker preprocessing response did not match the requested message");
					resolve(null);
					return;
				}

				resolve(result);
			},
			timeout,
		});

		sendWorkerMessage("PROCESS_CHAT_MESSAGE", {
			requestID,
			message: {
				id: msg.id,
				body: msg.body,
				author: msg.author
					? {
							id: msg.author.id,
							username: msg.author.username,
							displayName: msg.author.displayName,
							color: msg.author.color,
							intl: msg.author.intl,
							isActor: msg.author.isActor,
					  }
					: null,
				badges: { ...msg.badges },
				sourceRoomID,
				currentChannelID: msg.channelID,
				hideSharedChat: hideSharedChat.value,
				parentAuthorUsername: msg.parent?.author?.username ?? null,
				actorID: identity.value?.id ?? null,
				actorUsername: identity.value?.username ?? null,
				showModifiers: showModifiers.value,
				chatterMap: pickRelevantChatters(parts, messages.chattersByUsername),
				emoteMap: pickRelevantEmotes(parts, emotes.active),
				localEmoteMap: {
					...pickRelevantEmotes(parts, cosmetics?.emotes ?? {}),
					...pickRelevantEmotes(parts, msg.nativeEmotes),
				},
				highlights: chatHighlights.getWorkerHighlights(),
			},
		});
	});
}

function getUniqueMessageParts(message: string): string[] {
	return [...new Set(message.split(" ").filter(Boolean))];
}

function pickRelevantEmotes(
	parts: string[],
	source: Record<string, SevenTV.ActiveEmote>,
): Record<string, SevenTV.ActiveEmote> {
	const selected = {} as Record<string, SevenTV.ActiveEmote>;

	for (const part of parts) {
		if (source[part] && Object.hasOwn(source, part)) {
			selected[part] = source[part];
		}
	}

	return selected;
}

function pickRelevantChatters(parts: string[], source: Record<string, ChatUser>): Record<string, ChatUser> {
	const selected = {} as Record<string, ChatUser>;

	for (const part of parts) {
		const normalized = part.toLowerCase();
		if (source[normalized] && Object.hasOwn(source, normalized)) {
			selected[normalized] = source[normalized];
		}
	}

	return selected;
}

function buildMessageWorkerSignature(msg: ChatMessage): string {
	const parts = getUniqueMessageParts(msg.body);
	const cosmetics = msg.author ? useCosmetics(msg.author.id) : null;

	return [
		msg.body,
		showModifiers.value ? 1 : 0,
		buildRelevantEmoteSignature(parts, emotes.active),
		buildRelevantEmoteSignature(parts, msg.nativeEmotes),
		buildRelevantEmoteSignature(parts, cosmetics?.emotes ?? {}),
		buildRelevantChatterSignature(parts, messages.chattersByUsername),
	].join("::");
}

function buildRelevantEmoteSignature(
	parts: string[],
	emoteMap: Record<string, SevenTV.ActiveEmote> | undefined,
): string {
	if (!emoteMap) return "";

	return parts
		.map((part) => {
			const emote = emoteMap[part];
			return emote && Object.hasOwn(emoteMap, part) ? `${part}:${emote.id}:${emote.name}` : "";
		})
		.filter(Boolean)
		.join("|");
}

function buildRelevantChatterSignature(parts: string[], chatterMap: Record<string, ChatUser>): string {
	return parts
		.map((part) => {
			const normalized = part.toLowerCase();
			const user = chatterMap[normalized];
			return user && Object.hasOwn(chatterMap, normalized) ? `${normalized}:${user.id}` : "";
		})
		.filter(Boolean)
		.join("|");
}

function getRowHeight(msg: ChatMessage): number {
	return rowHeights.get(msg.sym) ?? estimatedRowHeight.value;
}

function pruneRowMeasurements(activeMessageSyms: Set<symbol>): void {
	for (const [sym, element] of Array.from(rowElements.entries())) {
		if (activeMessageSyms.has(sym)) continue;

		rowObserver.unobserve(element);
		rowLookup.delete(element);
		rowElements.delete(sym);
	}

	for (const sym of Array.from(rowHeights.keys())) {
		if (activeMessageSyms.has(sym)) continue;
		rowHeights.delete(sym);
	}
}

function setRowRef(sym: symbol, element: HTMLElement | null): void {
	const previous = rowElements.get(sym);
	if (previous && previous !== element) {
		rowObserver.unobserve(previous);
		rowLookup.delete(previous);
		rowElements.delete(sym);
	}

	if (!element) return;
	if (rowElements.get(sym) === element) return;

	rowElements.set(sym, element);
	rowLookup.set(element, sym);
	rowObserver.observe(element);
}

function queueVirtualLayout(stickToBottom = false): void {
	forceStickToBottom ||= stickToBottom;
	if (virtualLayoutFrame !== null) return;

	virtualLayoutFrame = requestAnimationFrame(() => {
		virtualLayoutFrame = null;
		const shouldStick = forceStickToBottom;
		forceStickToBottom = false;
		try {
			recalculateVirtualLayout();
			if (shouldStick && !scroller.paused) {
				void scroller.scrollToLive(0);
			}
		} catch (err) {
			performance.disableVirtualization(err instanceof Error ? err.message : String(err));
			visibleRange.start = 0;
			visibleRange.end = visibleMessages.value.length;
			renderedRange.start = 0;
			renderedRange.end = visibleMessages.value.length;
			topSpacerHeight.value = 0;
			bottomSpacerHeight.value = 0;
		}
	});
}

function shouldStickToBottom(): boolean {
	if (scroller.paused) return false;
	if (scroller.live) return true;

	const container = scroller.container;
	if (!container) return true;

	return container.scrollHeight - (container.scrollTop + container.clientHeight) <= 4;
}

function isHydratedIndex(index: number): boolean {
	const msg = visibleMessages.value[index];
	if (msg && openUserCards.isOpen(msg.sym)) return true;

	return (
		index >= Math.max(0, visibleRange.start - HYDRATION_OVERSCAN_ABOVE) &&
		index < Math.min(visibleMessages.value.length, visibleRange.end + HYDRATION_OVERSCAN_BELOW)
	);
}

function recalculateVirtualLayout(): void {
	if (props.forceHydrated || !performance.virtualizationEnabled.value) {
		visibleRange.start = 0;
		visibleRange.end = visibleMessages.value.length;
		renderedRange.start = 0;
		renderedRange.end = visibleMessages.value.length;
		topSpacerHeight.value = 0;
		bottomSpacerHeight.value = 0;
		return;
	}

	const container = scroller.container;
	if (!container) return;

	const viewportHeight = scroller.bounds?.height ?? container.clientHeight;
	const scrollTop = container.scrollTop;
	const scrollBottom = scrollTop + viewportHeight;
	const messagesToRender = visibleMessages.value;

	let offset = 0;
	let visibleStartIndex = -1;
	let visibleEndIndex = messagesToRender.length;

	for (let index = 0; index < messagesToRender.length; index++) {
		const msg = messagesToRender[index];
		if (!msg) continue;

		const height = getRowHeight(msg);
		const nextOffset = offset + height;

		if (visibleStartIndex === -1 && nextOffset >= scrollTop) {
			visibleStartIndex = index;
		}

		if (nextOffset >= scrollBottom) {
			visibleEndIndex = index + 1;
			break;
		}

		offset = nextOffset;
	}

	if (!messagesToRender.length) {
		visibleStartIndex = 0;
		visibleEndIndex = 0;
	} else if (visibleStartIndex === -1) {
		visibleStartIndex = 0;
	}

	if (visibleEndIndex < visibleStartIndex) {
		visibleEndIndex = visibleStartIndex;
	}

	visibleRange.start = visibleStartIndex;
	visibleRange.end = visibleEndIndex;
	let renderedStart = Math.max(0, visibleStartIndex - 30);
	let renderedEnd = Math.min(messagesToRender.length, visibleEndIndex + 50);

	for (let index = 0; index < messagesToRender.length; index++) {
		const msg = messagesToRender[index];
		if (!msg || !openUserCards.isOpen(msg.sym)) continue;

		renderedStart = Math.min(renderedStart, index);
		renderedEnd = Math.max(renderedEnd, index + 1);
	}

	renderedRange.start = renderedStart;
	renderedRange.end = renderedEnd;

	let topHeight = 0;
	for (let index = 0; index < renderedRange.start; index++) {
		const msg = messagesToRender[index];
		if (!msg) continue;
		topHeight += getRowHeight(msg);
	}

	let bottomHeight = 0;
	for (let index = renderedRange.end; index < messagesToRender.length; index++) {
		const msg = messagesToRender[index];
		if (!msg) continue;
		bottomHeight += getRowHeight(msg);
	}

	topSpacerHeight.value = topHeight;
	bottomSpacerHeight.value = bottomHeight;
}

function renderPlaceholderText(msg: ChatMessage): string {
	if (msg.author && msg.body) {
		return `${msg.author.displayName}: ${msg.body}`;
	}

	return msg.body || msg.author?.displayName || "";
}

function onModerationMessage(msgData: Twitch.ModerationMessage) {
	if (msgData.moderationType === ModerationType.DELETE) {
		const found = messages.find((m) => m.id == msgData.targetMessageID);
		if (found) {
			found.moderation.deleted = true;
		}
	} else {
		const prev = messages.moderated[0];
		if (
			prev &&
			prev.victim &&
			prev.victim.username === msgData.userLogin &&
			prev.mod.banDuration === msgData.duration
		) {
			// skip duplicate moderation messages
			return;
		}

		const msgList = messages.messagesByUser(msgData.userLogin);

		const action = {
			actionType: msgData.duration > 0 ? "TIMEOUT" : "BAN",
			banDuration: msgData.duration,
			banReason: msgData.reason,
			actor: null,
			banned: true,
			deleted: false,
			timestamp: Date.now(),
		} as ChatMessageModeration;

		let victim: null | ChatUser = null;
		for (const m of msgList) {
			m.moderation = action;

			if (!victim) {
				victim = m.author as ChatUser;
			}
		}

		// add to moderation log
		messages.moderated.unshift({
			id: Symbol("seventv-moderation-message"),
			messages: msgList.reverse().slice(0, 10), // last 10 messages
			mod: action,
			victim: victim || {
				id: msgData.userLogin,
				username: msgData.userLogin,
				displayName: msgData.userLogin,
				color: "",
			},
		});

		// cleanup old logs
		if (messages.moderated.length > 125) {
			nextTick(() => {
				while (messages.moderated.length > 100) messages.moderated.pop();
			});
		}

		// basic timeout/ban message in the chat
		if (showModerationMessages.value && !ctx.actor.roles.has("MODERATOR")) {
			const m = new ChatMessage().setComponent(BasicSystemMessage, {
				text:
					msgData.userLogin +
					(msgData.duration > 0 ? ` was timed out (${msgData.duration}s)` : " was permanently banned"),
			});
			messages.add(m);
		}
	}
}

function onMessageIdUpdate(msg: Twitch.IDUpdateMessage) {
	const found = messages.find((m) => m.nonce == msg.nonce);
	if (found) {
		found.setID(msg.id);
		found.setDeliveryState("SENT");
	}
}

// Keep track of props

// The message handler is hooked to render messages and prevent
// the native twitch renderer from rendering them
watch(
	messageHandler,
	(handler, old) => {
		if (handler !== old && old) {
			if (restrictions.value?.component.onChatEvent) {
				messages.handlers.delete(restrictions.value.component.onChatEvent);
			}

			unsetPropertyHook(old, "handleMessage");
		} else if (handler) {
			if (restrictions.value?.component.onChatEvent) {
				messages.handlers.add(restrictions.value.component.onChatEvent);
			}

			defineFunctionHook(handler, "handleMessage", function (old, msg: Twitch.AnyMessage) {
				const ok = onMessage(msg);
				if (ok) return ""; // message was rendered by the extension

				// message was not rendered by the extension
				unhandled.set(msg.id, msg);
				return old?.call(this, msg);
			});
		}
	},
	{ immediate: true },
);

// Keep track of unhandled nodes
const unhandled = reactive<Map<string, Twitch.AnyMessage>>(new Map());
const unhandledNodeMap = new Map<string, Element>();

watchDebounced(
	list.value.domNodes,
	(nodes) => {
		const missingIds = new Set<string>(unhandledNodeMap.keys()); // ids of messages that are no longer rendered

		for (const [nodeId, node] of Object.entries(nodes)) {
			if (nodeId === "root") continue;
			missingIds.delete(nodeId);
			if (unhandledNodeMap.has(nodeId) || !unhandled.has(nodeId)) continue;

			const m = new ChatMessage(nodeId);
			m.wrappedNode = node;
			messages.add(m);

			unhandledNodeMap.set(nodeId, node);
			unhandled.delete(nodeId);
		}

		for (const nodeId of missingIds) {
			unhandledNodeMap.delete(nodeId);
			unhandled.delete(nodeId);
		}
	},
	{ debounce: 100, immediate: true },
);

// Scroll Pausing on hotkey / hover
const alt = useKeyModifier("Alt");

let pausedByHotkey = false;
watch([alt, isHovering], ([isAlt, isHover]) => {
	if (!scroller.paused) {
		if (isHover && properties.pauseReason.has("MOUSEOVER")) {
			scroller.pause();
			pausedByHotkey = true;
		} else if (isHover && isAlt && properties.pauseReason.has("ALTKEY")) {
			scroller.pause();
			pausedByHotkey = true;
		}
	} else if (pausedByHotkey) {
		scroller.unpause();
		pausedByHotkey = false;
	}
});

// Assign highlight to your own message
watch(
	[identity, showSelfHighlights],
	([identity, enabled]) => {
		if (enabled && identity) {
			chatHighlights.define("~self", {
				test: (msg) => !!(msg.author && identity) && msg.author.id === identity.id,
				label: "You",
				color: "#3ad3e0",
			});
		} else {
			chatHighlights.remove("~self");
		}
	},
	{
		immediate: true,
	},
);

// Pause scrolling when page is not visible
watch(pageVisibility, (state) => {
	if (state === "hidden" && !scroller.paused) {
		scroller.pause();
		pausedByVisibility.value = true;
	} else if (pausedByVisibility.value) {
		scroller.unpause();
		pausedByVisibility.value = false;
	}
});

watch(
	[identity, showMentionHighlights, shouldFlashTitleOnHighlight],
	([identity, enabled, flash]) => {
		const rxs = identity ? `\\b${identity.username}\\b` : null;
		if (!rxs) return;

		const rx = new RegExp(rxs, "i");

		if (enabled) {
			chatHighlights.define("~mention", {
				test: (msg) =>
					!!(identity && msg.author && msg.author.username !== identity.username && rx.test(msg.body)),
				label: "Mentions You",
				color: "#e13232",
				flashTitleFn: flash
					? (msg: ChatMessage) => `🔔 @${msg.author?.username ?? "A user"} mentioned you`
					: undefined,
				flashTitle: true,
				phrase: true,
			});

			chatHighlights.define("~reply", {
				test: (msg) =>
					!!(
						msg.parent &&
						msg.parent.author &&
						msg.author &&
						msg.author.username !== msg.parent.author.username &&
						rx.test(msg.parent.author.username)
					),
				label: "Replying to You",
				color: "#e13232",
				flashTitleFn: flash
					? (msg: ChatMessage) => `🔔 @${msg.author?.username ?? "A user"} replied to you`
					: undefined,
				flashTitle: true,
				phrase: true,
			});
		} else {
			chatHighlights.remove("~mention");
			chatHighlights.remove("~reply");
		}
	},
	{
		immediate: true,
	},
);

defineExpose({
	onMessage,
	onChatMessage,
});
</script>
<style scoped lang="scss">
.seventv-chat-list {
	padding: 1rem 0;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	font-size: var(--seventv-chat-font-size, inherit);
	line-height: 1.5em;

	.seventv-message {
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.seventv-message.dehydrated {
		overflow: hidden;
		opacity: 0.72;
	}

	.seventv-message-placeholder-text {
		display: block;
		padding: 0 1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--seventv-muted);
	}

	.seventv-message-spacer {
		pointer-events: none;
	}
}
</style>
