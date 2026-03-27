<template>
	<span
		ref="msgEl"
		class="seventv-user-message"
		:msg-id="msg.id"
		:class="{
			deleted: !hideDeletionState && (msg.moderation.banned || msg.moderation.deleted),
			'has-mention': as == 'Chat' && msg.mentions.has('#actor'),
			'has-highlight': as == 'Chat' && msg.highlight,
		}"
		:state="msg.deliveryState"
		:style="{
			'font-style': msg.slashMe && meStyle & 1 ? 'italic' : '',
			color: msg.slashMe && meStyle & 2 ? msg.author?.color : '',
		}"
		:data-highlight-style="highlightStyle"
	>
		<!-- Highlight Label -->
		<div
			v-if="msg.highlight"
			class="seventv-chat-message-highlight-label"
			:data-highlight-label="msg.highlight.label"
		/>

		<!-- Timestamp -->
		<template v-if="properties.showTimestamps || msg.historical || forceTimestamp">
			<span class="seventv-chat-message-timestamp">
				{{ timestamp }}
			</span>
		</template>

		<!-- Mod Icons -->
		<template v-if="ctx.actor.roles.has('MODERATOR') && properties.showModerationIcons && !hideModIcons">
			<ModIcons :msg="msg" />
		</template>

		<!-- Chat Author -->
		<UserTag
			v-if="msg.author && !hideAuthor"
			:user="msg.author"
			:source-data="msg.sourceData"
			:badges="msg.badges"
			:badge-data="msg.badgeData"
			:msg-id="disableUserCard ? undefined : msg.sym"
			:clickable="!disableUserCard"
			@open-native-card="openViewerCard($event, msg.author.username, msg.id)"
		/>

		<span v-if="!hideAuthor">
			{{ !msg.slashMe ? ": " : " " }}
		</span>

		<!-- Message Content -->
		<span class="seventv-chat-message-body">
			<template v-for="(token, index) of tokens" :key="index">
				<span v-if="typeof token === 'string'" class="text-token">{{ token }}</span>
				<span v-else-if="IsEmoteToken(token)">
					<Emote
						class="emote-token"
						:emote="token.content.emote"
						:format="properties.imageFormat"
						:overlaid="token.content.overlaid"
						:clickable="true"
						:inline-chat="true"
						:scale="Number(emoteScale)"
					/>
					<span v-if="token.content" :style="{ color: token.content.cheerColor }">
						{{ token.content.cheerAmount }}
					</span>
				</span>
				<template v-else>
					<component :is="getToken(token)" v-bind="{ token, msg }" />
				</template>
			</template>
		</span>

		<!-- Chat Rich Embed -->
		<RichEmbed v-if="hydrated && showRichEmbeds && msg.richEmbed.request_url" :rich-embed="msg.richEmbed" />

		<EmoteLinkEmbed v-if="hydrated && msg.emoteLinkEmbed" :emote-id="msg.emoteLinkEmbed" />

		<!-- Ban State -->
		<template v-if="!hideModeration && (msg.moderation.banned || msg.moderation.deleted)">
			<span v-if="msg.moderation.banned" class="seventv-chat-message-moderated">
				{{ msg.moderation.banDuration ? `Timed out (${msg.moderation.banDuration}s)` : "Permanently Banned" }}
			</span>
			<span v-else class="seventv-chat-message-moderated">Deleted</span>
		</template>

		<!-- Buttons (Reply, Pin) -->
		<UserMessageButtons :msg="msg" @pin="doPinMessage()" />
	</span>
</template>

<script lang="ts">
const timestampCache = new Map<string, string>();
const MAX_TIMESTAMP_CACHE_SIZE = 1024;
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, toRef, watch } from "vue";
import { SetHexAlpha } from "@/common/Color";
import { formatDateTime } from "@/common/IntlFormatter";
import { log } from "@/common/Logger";
import type { AnyToken, ChatMessage, ChatUser } from "@/common/chat/ChatMessage";
import { IsEmoteToken, IsLinkToken, IsMentionToken } from "@/common/type-predicates/MessageTokens";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatModeration } from "@/composable/chat/useChatModeration";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useChatTools } from "@/composable/chat/useChatTools";
import { useCosmetics } from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import type { TimestampFormatKey } from "@/site/twitch.tv/modules/chat/ChatModule.vue";
import ModIcons from "@/site/twitch.tv/modules/chat/components/mod/ModIcons.vue";
import Emote from "./Emote.vue";
import MessageTokenLink from "./MessageTokenLink.vue";
import MessageTokenMention from "./MessageTokenMention.vue";
import UserMessageButtons from "./UserMessageButtons.vue";
import UserTag from "./UserTag.vue";

const props = withDefaults(
	defineProps<{
		msg: ChatMessage;
		as?: "Chat" | "Reply";
		highlight?: {
			label: string;
			color: string;
		};
		emotes?: Record<string, SevenTV.ActiveEmote>;
		chatters?: Record<string, ChatUser>;
		isModerator?: boolean;
		hideAuthor?: boolean;
		hideModeration?: boolean;
		hideModIcons?: boolean;
		hideDeletionState?: boolean;
		showButtons?: boolean;
		forceTimestamp?: boolean;
		hydrated?: boolean;
		showRichEmbeds?: boolean;
		disableUserCard?: boolean;
	}>(),
	{ as: "Chat", hydrated: true, showRichEmbeds: true },
);

const msg = toRef(props, "msg");
const msgEl = ref<HTMLSpanElement | null>();

const ctx = useChannelContext();
const performance = useChatPerformance();
const properties = useChatProperties(ctx);
const { openViewerCard } = useChatTools(ctx);
const { pinChatMessage } = useChatModeration(ctx, msg.value.author?.username ?? "");

const emoteScale = useConfig<number>("chat.emote_scale");

// TODO: css variables
const meStyle = useConfig<number>("chat.slash_me_style");
const highlightStyle = useConfig<number>("highlights.display_style");
const highlightOpacity = useConfig<number>("highlights.opacity");
const displaySecondsInTimestamp = useConfig<boolean>("chat.timestamp_with_seconds");
const showModifiers = useConfig<boolean>("chat.show_emote_modifiers");
const timestampFormat = useConfig<TimestampFormatKey>("chat.timestamp_format");
// Get the locale to format the timestamp
const locale = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language ?? "en";
const loadRichEmbed = () => import("./RichEmbed.vue");
const loadEmoteLinkEmbed = () => import("./EmoteLinkEmbed.vue");
const RichEmbed = defineAsyncComponent(loadRichEmbed);
const EmoteLinkEmbed = defineAsyncComponent(loadEmoteLinkEmbed);

watch(
	() => performance.asyncHydrationEnabled.value,
	(enabled) => {
		if (!enabled) {
			void loadRichEmbed();
			void loadEmoteLinkEmbed();
		}
	},
	{ immediate: true },
);

// Personal Emotes
const cosmetics = props.msg.author ? useCosmetics(props.msg.author.id) : { emotes: {} };

// Timestamp
const timestamp = ref("");

// Tokenize the message
type MessageTokenOrText = AnyToken | string;
const tokenizer = props.msg.getTokenizer();
const tokens = ref<MessageTokenOrText[]>([]);
const uniqueMessageParts = computed(() => getUniqueMessageParts(props.msg.body));
const relevantLocalEmoteMap = computed(() =>
	buildRelevantLocalEmoteMap(uniqueMessageParts.value, cosmetics.emotes, props.msg.nativeEmotes),
);
const tokenizationSignature = computed(() => buildTokenizationSignature(uniqueMessageParts.value));

function doTokenize() {
	if (!tokenizer) return;
	const signature = tokenizationSignature.value;

	const newTokens =
		props.msg.tokenizationSignature === signature && props.msg.tokens.length
			? props.msg.tokens
			: tokenizer.tokenize({
					chatterMap: props.chatters ?? {},
					emoteMap: props.emotes ?? {},
					localEmoteMap: relevantLocalEmoteMap.value,
					showModifiers: showModifiers.value,
			  });
	// eslint-disable-next-line vue/no-mutating-props
	props.msg.tokenizationSignature = signature;

	const result: MessageTokenOrText[] = [];
	const text = props.msg.body;

	let lastOffset = 0;
	for (const tok of newTokens) {
		const start = tok.range[0];
		const end = tok.range[1];

		const before = text.substring(lastOffset, start);
		if (before) {
			result.push(before);
		}

		result.push(tok);

		lastOffset = end + 1;
	}

	const after = text.substring(lastOffset);
	if (after) {
		result.push(after);
	}

	tokens.value = result;
}

function doPinMessage(): void {
	pinChatMessage(msg.value.id, 1200)?.catch((err) => log.error("failed to pin chat message", err));
}

watch(tokenizationSignature, () => doTokenize(), { immediate: true });

// eslint-disable-next-line vue/no-mutating-props
props.msg.refresh = doTokenize;

function getToken(token: AnyToken): AnyInstanceType {
	if (IsMentionToken(token)) {
		return MessageTokenMention;
	} else if (IsLinkToken(token)) {
		return MessageTokenLink;
	}
}

const useTimestampFormat = () => {
	switch (timestampFormat.value) {
		case "infer":
			return undefined;
		case "12":
			return "h12";
		case "24":
			return "h23";
	}
};

watch(
	() => [msgEl.value, msg.value.highlight?.color, highlightOpacity.value],
	() => {
		if (!msgEl.value) return;
		if (!msg.value.highlight) {
			msgEl.value.style.removeProperty("--seventv-highlight-color");
			msgEl.value.style.removeProperty("--seventv-highlight-dim-color");
			return;
		}

		msgEl.value.style.setProperty("--seventv-highlight-color", msg.value.highlight.color);
		msgEl.value.style.setProperty(
			"--seventv-highlight-dim-color",
			msg.value.highlight.color.concat(SetHexAlpha(highlightOpacity.value / 100)),
		);
	},
	{ immediate: true },
);

watch(
	() => [
		properties.showTimestamps,
		msg.value.historical,
		props.forceTimestamp,
		props.msg.timestamp,
		displaySecondsInTimestamp.value,
		timestampFormat.value,
	],
	() => {
		if (!properties.showTimestamps && !msg.value.historical && !props.forceTimestamp) {
			timestamp.value = "";
			return;
		}

		timestamp.value = formatTimestamp(
			props.msg.timestamp,
			locale,
			useTimestampFormat(),
			displaySecondsInTimestamp.value,
		);
	},
	{ immediate: true },
);

function getUniqueMessageParts(message: string): string[] {
	return [...new Set(message.split(" ").filter(Boolean))];
}

function buildRelevantLocalEmoteMap(
	parts: string[],
	personalEmotes: Record<string, SevenTV.ActiveEmote>,
	nativeEmotes: Record<string, SevenTV.ActiveEmote>,
): Record<string, SevenTV.ActiveEmote> {
	const local = {} as Record<string, SevenTV.ActiveEmote>;

	for (const part of parts) {
		const personal = personalEmotes[part];
		if (personal && Object.hasOwn(personalEmotes, part)) {
			local[part] = personal;
		}

		const native = nativeEmotes[part];
		if (native && Object.hasOwn(nativeEmotes, part)) {
			local[part] = native;
		}
	}

	return local;
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

function buildRelevantChatterSignature(parts: string[], chatterMap: Record<string, ChatUser> | undefined): string {
	if (!chatterMap) return "";

	return parts
		.map((part) => {
			const normalized = part.toLowerCase();
			const user = chatterMap[normalized];
			return user && Object.hasOwn(chatterMap, normalized) ? `${normalized}:${user.id}` : "";
		})
		.filter(Boolean)
		.join("|");
}

function buildTokenizationSignature(parts: string[]): string {
	return [
		props.msg.body,
		showModifiers.value ? 1 : 0,
		buildRelevantEmoteSignature(parts, props.emotes),
		buildRelevantEmoteSignature(parts, props.msg.nativeEmotes),
		buildRelevantEmoteSignature(parts, cosmetics.emotes),
		buildRelevantChatterSignature(parts, props.chatters),
	].join("::");
}

function formatTimestamp(
	time: number,
	activeLocale: string,
	hourCycle: "h12" | "h23" | undefined,
	showSeconds: boolean,
): string {
	const key = `${time}|${activeLocale}|${hourCycle ?? "infer"}|${showSeconds ? 1 : 0}`;
	const cached = timestampCache.get(key);
	if (cached) return cached;

	const formatted = formatDateTime(time, activeLocale, {
		localeMatcher: "lookup",
		hour: "2-digit",
		minute: "2-digit",
		second: showSeconds ? "numeric" : undefined,
		...(hourCycle ? { hourCycle } : {}),
	});

	if (!timestampCache.has(key) && timestampCache.size >= MAX_TIMESTAMP_CACHE_SIZE) {
		const oldestKey = timestampCache.keys().next().value;
		if (oldestKey) {
			timestampCache.delete(oldestKey);
		}
	}

	timestampCache.set(key, formatted);
	return formatted;
}
</script>

<style scoped lang="scss">
.seventv-user-message {
	display: block;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	overflow-wrap: anywhere;

	&.has-highlight {
		padding: 1rem calc(var(--seventv-chat-padding, 1rem) - 0.25rem);
		margin: -0.5rem;
		margin-left: calc(var(--seventv-chat-padding, 1rem) * -1);
		margin-right: calc(-1 * var(--seventv-chat-padding, 1rem) + 0.25rem);
		border: 0.25rem solid transparent;
		border-top: none;
		border-bottom: none;

		&[data-highlight-style="0"] {
			border-color: var(--seventv-highlight-color);
			background-color: var(--seventv-highlight-dim-color);

			.seventv-chat-message-highlight-label {
				&::after {
					height: 0;
					content: attr(data-highlight-label);
					display: grid;
					width: 100%;
					justify-content: end;
					color: var(--seventv-highlight-color);
					transform: translateY(-1.5em);
					font-weight: 600;
					text-transform: uppercase;
					font-size: 0.88rem;
				}
			}
		}

		&[data-highlight-style="1"] {
			background-color: var(--seventv-highlight-dim-color);
		}
	}

	.emote-token {
		display: inline-grid;
		vertical-align: middle;
		margin: var(--seventv-emote-margin);
		margin-left: 0 !important;
		margin-right: 0 !important;
	}
}

.seventv-chat-message-body {
	max-width: 100%;
	overflow-wrap: anywhere;
	word-break: break-word;
}

.seventv-chat-message-moderated {
	&::before {
		content: "—";
	}

	display: inline-block;
	font-style: italic;
	vertical-align: center;
	color: var(--seventv-muted);
}

.deleted {
	&:not(:hover) > .seventv-chat-message-body {
		display: var(--seventv-chat-deleted-display);
		opacity: var(--seventv-chat-deleted-opacity);
		text-decoration: var(--seventv-chat-deleted-decoration);
	}

	&:hover {
		.seventv-chat-message-moderated {
			visibility: hidden;
		}
	}
}

.seventv-chat-message-timestamp {
	margin-right: 0.5rem;
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.1rem;
	color: var(--seventv-muted);
}
</style>
