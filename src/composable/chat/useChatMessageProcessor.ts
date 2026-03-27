import { type Ref, onUnmounted, ref, watch } from "vue";
import { until, useTimeoutFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { normalizeUsername } from "@/common/Color";
import { log } from "@/common/Logger";
import { convertCheerEmote, convertTwitchEmote } from "@/common/Transform";
import { ChatMessage, ChatMessageModeration, ChatUser, LowTrustUserProperties } from "@/common/chat/ChatMessage";
import type { NormalizedChatMessage } from "@/common/chat/PerformanceProcessor";
import { IsChatMessage, IsDisplayableMessage, IsModerationMessage } from "@/common/type-predicates/Messages";
import type { ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatHighlights } from "@/composable/chat/useChatHighlights";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useCosmetics } from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import { WorkletEvent, useWorker } from "@/composable/useWorker";
import { MessagePartType, MessageType, ModerationType } from "@/site/twitch.tv";
import {
	applyTVerinoSendResultToMessage,
	consumePendingTVerinoSendResult,
	promotePendingTVerinoTypedRewardMessage,
} from "@/site/twitch.tv/modules/chat/tverinoPendingMessage";
import BasicSystemMessage from "@/app/chat/msg/BasicSystemMessage.vue";

const CHAT_WORKER_TIMEOUT_MS = 40;
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

interface ChatMessageProcessorOptions {
	sharedChatData?: Ref<Map<string, Twitch.SharedChat> | null>;
	onClearChat?: () => void;
}

export function useChatMessageProcessor(ctx: ChannelContext, options: ChatMessageProcessorOptions = {}) {
	const { identity } = storeToRefs(useStore());
	const emotes = useChatEmotes(ctx);
	const messages = useChatMessages(ctx);
	const performance = useChatPerformance(ctx);
	const properties = useChatProperties(ctx);
	const chatHighlights = useChatHighlights(ctx);
	const { sendMessage: sendWorkerMessage, target: workerTarget } = useWorker();
	const sharedChatData = options.sharedChatData ?? ref<Map<string, Twitch.SharedChat> | null>(null);
	const hideSharedChat = useConfig<boolean>("chat.hide_shared_chat");
	const showModerationMessages = useConfig<boolean>("chat.mod_messages");
	const showMentionHighlights = useConfig("highlights.basic.mention");
	const showFirstTimeChatter = useConfig<boolean>("highlights.basic.first_time_chatter");
	const showSelfHighlights = useConfig<boolean>("highlights.basic.self");
	const shouldFlashTitleOnHighlight = useConfig<boolean>("highlights.basic.mention_title_flash");
	const showRestrictedLowTrustUser = useConfig<boolean>("highlights.basic.restricted_low_trust_user");
	const showMonitoredLowTrustUser = useConfig<boolean>("highlights.basic.monitored_low_trust_user");
	const showModifiers = useConfig<boolean>("chat.show_emote_modifiers");

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

	const onMessage = (msgData: Twitch.AnyMessage): boolean => {
		const resolvedMsgData = promotePendingTVerinoTypedRewardMessage(msgData, ctx.id, identity.value?.id);
		const authorData = getTwitchAuthorData(resolvedMsgData);
		const messageBody = IsDisplayableMessage(resolvedMsgData)
			? (resolvedMsgData.messageBody ?? resolvedMsgData.message?.messageBody ?? "").replace("\n", " ")
			: "";
		const messageTimestamp = IsChatMessage(resolvedMsgData)
			? resolvedMsgData.timestamp
			: resolvedMsgData.message?.timestamp ?? 0;
		const replacementTarget =
			typeof resolvedMsgData.nonce === "string"
				? messages.find(
						(message) => message.nonce === resolvedMsgData.nonce && message.id !== resolvedMsgData.id,
				  )
				: identity.value && authorData && authorData.userID === identity.value.id && messageBody
				  ? messages.find(
							(message) =>
								message.nonce === message.id &&
								message.author?.id === identity.value?.id &&
								message.body === messageBody &&
								Math.abs(message.timestamp - messageTimestamp) <= 15000,
				    )
				  : null;
		const msg = new ChatMessage(resolvedMsgData.id);
		msg.channelID = ctx.id;

		messages.handlers.forEach((h) => h(resolvedMsgData));

		switch (resolvedMsgData.type) {
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
				onChatMessage(msg, resolvedMsgData, true, replacementTarget);
				break;
			case MessageType.CHANNEL_POINTS_REWARD:
				if (!(resolvedMsgData as Twitch.ChannelPointsRewardMessage).animationID) {
					onChatMessage(msg, resolvedMsgData, true, replacementTarget);
				} else {
					return false;
				}
				break;
			case MessageType.MODERATION:
				if (!IsModerationMessage(resolvedMsgData)) break;
				onModerationMessage(resolvedMsgData);
				break;
			case MessageType.MESSAGE_ID_UPDATE:
				onMessageIdUpdate(resolvedMsgData as Twitch.IDUpdateMessage);
				break;
			case MessageType.CLEAR:
				onClearChat();
				break;
			default:
				return false;
		}

		return true;
	};

	function onChatMessage(
		msg: ChatMessage,
		msgData: Twitch.AnyMessage,
		shouldRender = true,
		replacementTarget: ChatMessage | null = null,
	) {
		const isSyntheticPendingMessage = typeof msgData.nonce === "string" && msgData.id === msgData.nonce;
		const component = getMessageComponent(msgData.type);
		if (component) {
			msg.setComponent(component, { msgData });
		}

		if (!msg.instance) {
			msg.setComponent(typeMap[0], { msgData });
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
					username:
						authorData.userLogin ?? (authorData.userDisplayName ?? authorData.displayName)?.toLowerCase(),
					displayName: authorData.userDisplayName ?? authorData.displayName ?? authorData.userLogin,
					intl: authorData.isIntl,
					color,
				},
			);

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

		const pendingSendResult =
			typeof msgData.nonce === "string" ? consumePendingTVerinoSendResult(msgData.nonce) : null;

		if (IsDisplayableMessage(msgData)) {
			msg.body = (msgData.messageBody ?? msgData.message?.messageBody ?? "").replace("\n", " ");
			msg.first = msgData.isFirstMsg;

			if (typeof msgData.nonce === "string") msg.setNonce(msgData.nonce);

			if (msgData.isFirstMsg && showFirstTimeChatter.value) {
				msg.setHighlight("#c832c8", "First Message");
			}

			if (msg.author) {
				const lowTrust = messages.lowTrustUsers[msg.author.id];
				if (lowTrust && lowTrust.treatment.type === "ACTIVE_MONITORING" && showMonitoredLowTrustUser.value) {
					msg.setHighlight("#ff7d00", "Monitored Suspicious User");
				}
			}

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

			if (msgData.messageType === 1) {
				msg.slashMe = true;
			}

			for (const part of msgData.messageParts ?? msgData.message?.messageParts ?? []) {
				switch (part.type) {
					case MessagePartType.EMOTE: {
						const e = part.content as Twitch.ChatMessage.EmotePart["content"];
						if (!e.alt) continue;
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
						if (e.cheerAmount) {
							msg.nativeEmotes[emoteName.toLowerCase()] = nativeEmote;
						}
						break;
					}
					case MessagePartType.FLAGGEDSEGMENT: {
						const e = part as Twitch.ChatMessage.FlaggedSegmentPart;
						if (!e.originalText) continue;

						msg.body = msg.body.replace(e.originalText, "*".repeat(e.originalText.length));
						break;
					}
				}
			}
		}

		if (msgData.nonce) {
			msg.setDeliveryState("IN_FLIGHT");

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
				msg.tokenizationSignature = buildMessageWorkerSignature(
					msg,
					emotes.active,
					messages.chattersByUsername,
					showModifiers.value,
				);
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

			if (pendingSendResult) {
				applyTVerinoSendResultToMessage(msg, pendingSendResult);
				if (pendingSendResult.messageID) {
					msg.setID(pendingSendResult.messageID);
				}
				msg.setDeliveryState(pendingSendResult.ok ? "SENT" : "BOUNCED");
			}

			if (replacementTarget) {
				if (!messages.replace(replacementTarget, msg) && shouldRender) {
					messages.add(msg);
				}
				return;
			}

			if (shouldRender) messages.add(msg);
		};

		if (performance.workerPathEnabled.value && IsDisplayableMessage(msgData) && !isSyntheticPendingMessage) {
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
						performance.disableWorkerPath(
							"worker preprocessing response did not match the requested message",
						);
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

			messages.moderated.unshift({
				id: Symbol("seventv-moderation-message"),
				messages: msgList.reverse().slice(0, 10),
				mod: action,
				victim: victim || {
					id: msgData.userLogin,
					username: msgData.userLogin,
					displayName: msgData.userLogin,
					color: "",
				},
			});

			if (messages.moderated.length > 125) {
				while (messages.moderated.length > 100) messages.moderated.pop();
			}

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

	function onClearChat() {
		messages.clear();
		const m = new ChatMessage().setComponent(BasicSystemMessage, {
			text: "Chat cleared by a moderator",
		});
		messages.add(m);
		options.onClearChat?.();
	}

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
		{ immediate: true },
	);

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
						? (msg: ChatMessage) => `[Mention] @${msg.author?.username ?? "A user"} mentioned you`
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
						? (msg: ChatMessage) => `[Reply] @${msg.author?.username ?? "A user"} replied to you`
						: undefined,
					flashTitle: true,
					phrase: true,
				});
			} else {
				chatHighlights.remove("~mention");
				chatHighlights.remove("~reply");
			}
		},
		{ immediate: true },
	);

	return {
		onMessage,
		onChatMessage,
		onClearChat,
	};
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

function buildMessageWorkerSignature(
	msg: ChatMessage,
	activeEmotes: Record<string, SevenTV.ActiveEmote>,
	chattersByUsername: Record<string, ChatUser>,
	showModifiers: boolean,
): string {
	const parts = getUniqueMessageParts(msg.body);
	const cosmetics = msg.author ? useCosmetics(msg.author.id) : null;

	return [
		msg.body,
		showModifiers ? 1 : 0,
		buildRelevantEmoteSignature(parts, activeEmotes),
		buildRelevantEmoteSignature(parts, msg.nativeEmotes),
		buildRelevantEmoteSignature(parts, cosmetics?.emotes ?? {}),
		buildRelevantChatterSignature(parts, chattersByUsername),
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
