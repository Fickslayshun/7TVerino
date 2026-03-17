<template>
	<div
		v-if="user && user.displayName"
		ref="tagRef"
		class="seventv-chat-user"
		:style="shouldColor ? { color: user.color } : {}"
	>
		<!--Badge List -->
		<span
			v-if="
				!hideBadges && ((twitchBadges.length && twitchBadgeSets?.count) || cosmetics.badges.size || sourceData)
			"
			class="seventv-chat-user-badge-list"
		>
			<Badge
				v-if="sourceData"
				:key="sourceData.login"
				:badge="sourceData"
				:alt="sourceData.displayName"
				type="picture"
			/>
			<Badge
				v-for="badge of twitchBadges"
				:key="badge.id"
				:badge="badge"
				:alt="badge.title"
				type="twitch"
				@click="handleClick($event)"
			/>
			<template v-if="shouldRender7tvBadges">
				<Badge
					v-for="badge of activeBadges"
					:key="badge.id"
					:badge="badge"
					:alt="badge.data.tooltip"
					type="app"
				/>
			</template>
		</span>

		<!-- Message Author -->
		<span
			v-tooltip="shouldPaint ? `Paint: ${paint!.data.name}` : ''"
			ref="usernameRef"
			class="seventv-chat-user-username"
			@click="handleClick($event)"
			@mousedown="handleMiddleMouseDown"
			@auxclick="handleAuxClick"
		>
			<span v-cosmetic-paint="shouldPaint ? paint!.id : null">
				<span v-if="isMention && !hideAt">@</span>
				<span>{{ user.displayName }}</span>
				<span v-if="user.intl"> ({{ user.username }})</span>
			</span>
		</span>
	</div>

	<template v-if="showUserCard">
		<Teleport to="#seventv-float-context">
			<UiDraggable
				class="seventv-user-card-float"
				:handle="cardHandle"
				:follow-anchor="true"
				:initial-anchor="userCardAnchor"
				:initial-position="userCardPosition ?? undefined"
				initial-placement="top-end"
				:initial-middleware="userCardInitialMiddleware"
				:once="true"
			>
				<UserCard :target="props.user" @close="closeUserCard" @mount-handle="cardHandle = $event" />
			</UiDraggable>
		</Teleport>
	</template>

	<template v-if="copyToastOpen && copyToastContainer">
		<Teleport :to="copyToastContainer">
			<UiCopiedMessageToast message="Username copied" @close="copyToastOpen = false" />
		</Teleport>
	</template>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onUnmounted, ref, toRef, watch } from "vue";
import { copyText } from "@/common/Clipboard";
import type { ChatUser } from "@/common/chat/ChatMessage";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useOpenUserCards } from "@/composable/chat/useOpenUserCards";
import { useCosmetics } from "@/composable/useCosmetics";
import { useFloatScreen } from "@/composable/useFloatContext";
import { useConfig } from "@/composable/useSettings";
import Badge, { TwitchChatBadgeWithData } from "./Badge.vue";
import UiCopiedMessageToast from "@/ui/UiCopiedMessageToast.vue";
import UiDraggable from "@/ui/UiDraggable.vue";
import { type ReferenceElement, flip, offset, shift } from "@floating-ui/dom";

const props = withDefaults(
	defineProps<{
		user: ChatUser;
		sourceData?: Twitch.SharedChat;
		msgId?: symbol;
		isMention?: boolean;
		hideAt?: boolean;
		hideBadges?: boolean;
		clickable?: boolean;
		badges?: Record<string, string>;
		badgeData?: Record<string, string>;
	}>(),
	{
		clickable: true,
	},
);

const emit = defineEmits<{
	(e: "open-native-card", ev: MouseEvent): void;
}>();

enum MentionStyle {
	NONE = 0,
	COLORED = 1,
	PAINTED = 2,
}

const ctx = useChannelContext();
const openUserCards = useOpenUserCards();
const performance = useChatPerformance();
const properties = useChatProperties(ctx);
const cosmetics = useCosmetics(props.user.id);
const shouldRenderPaint = useConfig<boolean>("vanity.nametag_paints");
const shouldRender7tvBadges = useConfig<boolean>("vanity.7tv_Badges");
const betterUserCardEnabled = useConfig<boolean>("chat.user_card");
const middleClickToProfileEnabled = useConfig<boolean>("chat.middle_click_profile");
const clickCopyUsernameEnabled = useConfig<boolean>("chat.click_copy_username");
const twitchBadges = ref<TwitchChatBadgeWithData[]>([]);
const twitchBadgeSets = toRef(properties, "twitchBadgeSets");
const mentionStyle = useConfig<MentionStyle>("chat.colored_mentions");

const tagRef = ref<HTMLDivElement>();
const usernameRef = ref<HTMLSpanElement>();
const userCardAnchor = ref<ReferenceElement>();
const showUserCard = ref(false);
const cardHandle = ref<HTMLDivElement>();
const copyToastOpen = ref(false);
const userCardPosition = ref<[number, number] | null>(null);
const paint = ref<SevenTV.Cosmetic<"PAINT"> | null>(null);
const activeBadges = ref<SevenTV.Cosmetic<"BADGE">[]>([]);
let copyToastTimer: number | null = null;
const copyToastContainer = useFloatScreen(tagRef, {
	enabled: () => copyToastOpen.value,
	placement: "top",
	middleware: [shift({ padding: 8 })],
});
const userCardInitialMiddleware = [
	offset(4),
	flip({ fallbackPlacements: ["bottom-end"] }),
	shift({ mainAxis: true, crossAxis: true, padding: 8 }),
];

const shouldPaint = computed(() => {
	if (!shouldRenderPaint.value) return false;
	if (!paint.value) return false;
	if (!props.isMention) return true;
	return mentionStyle.value === MentionStyle.PAINTED;
});

const shouldColor = computed(() => {
	return !props.isMention || mentionStyle.value === MentionStyle.COLORED;
});

const userCardKey = computed(() => props.user.id || props.user.username);

const loadUserCard = () => import("./UserCard.vue");
const UserCard = defineAsyncComponent(loadUserCard);

watch(
	() => performance.asyncHydrationEnabled.value,
	(enabled) => {
		if (!enabled) {
			void loadUserCard();
		}
	},
	{ immediate: true },
);

function handleClick(ev: MouseEvent) {
	if (!props.clickable) return;
	if (shouldCopyUsername(ev)) {
		ev.preventDefault();
		ev.stopPropagation();
		void copyUsername();
		return;
	}

	if (!betterUserCardEnabled.value) {
		emit("open-native-card", ev);
		return;
	}

	if (!showUserCard.value) {
		userCardAnchor.value = createUserCardAnchor();

		const lineRect =
			tagRef.value?.closest(".seventv-chat-message-background")?.getBoundingClientRect() ??
			tagRef.value?.closest(".seventv-chat-message-container")?.getBoundingClientRect() ??
			tagRef.value?.getBoundingClientRect();
		const usernameRect = usernameRef.value?.getBoundingClientRect() ?? tagRef.value?.getBoundingClientRect();
		userCardPosition.value =
			lineRect && usernameRect ? [lineRect.right, usernameRect.bottom] : [ev.clientX, ev.clientY];
		if (props.msgId) openUserCards.open(props.msgId, userCardKey.value);
		showUserCard.value = true;
		return;
	}

	closeUserCard();
}

async function copyUsername(): Promise<void> {
	const ok = await copyText(props.user.username);
	if (!ok) return;

	if (copyToastTimer !== null) {
		clearTimeout(copyToastTimer);
	}

	copyToastOpen.value = true;
	copyToastTimer = window.setTimeout(() => {
		copyToastOpen.value = false;
		copyToastTimer = null;
	}, 1000);
}

function closeUserCard(): void {
	showUserCard.value = false;
	userCardAnchor.value = undefined;
	userCardPosition.value = null;
	if (props.msgId) openUserCards.close(props.msgId);
}

function shouldCopyUsername(ev: MouseEvent): boolean {
	return (
		!!props.user.username &&
		props.clickable &&
		clickCopyUsernameEnabled.value &&
		ev.button === 0 &&
		(ev.altKey || ev.ctrlKey)
	);
}

function shouldOpenProfileWithMiddleClick(ev: MouseEvent): boolean {
	return props.clickable && middleClickToProfileEnabled.value && ev.button === 1 && !!props.user.username;
}

function handleMiddleMouseDown(ev: MouseEvent): void {
	if (!shouldOpenProfileWithMiddleClick(ev)) return;

	ev.preventDefault();
}

function handleAuxClick(ev: MouseEvent): void {
	if (!shouldOpenProfileWithMiddleClick(ev)) return;

	ev.preventDefault();
	ev.stopPropagation();

	window.open(`https://www.twitch.tv/${props.user.username}`, "_blank", "noopener,noreferrer");
}

watch(
	() => [props.badges, props.badgeData, props.sourceData, twitchBadgeSets.value],
	() => {
		twitchBadges.value = resolveTwitchBadges(
			props.badges,
			props.badgeData,
			props.sourceData,
			twitchBadgeSets.value,
		);
	},
	{ immediate: true },
);

watch([showUserCard, () => props.msgId, () => openUserCards.version.value], ([isOpen, msgId]) => {
	if (!isOpen || !msgId) return;
	if (openUserCards.isOpen(msgId)) return;

	closeUserCard();
});

const t = Date.now();
const stop = watch(
	[() => cosmetics.paint, () => cosmetics.badgeList],
	([nextPaint, badgeList]) => {
		// condition to ignore
		// msg is not the last message, or is older than a second
		if (props.msgId && props.user.lastMsgId && props.msgId !== props.user.lastMsgId && Date.now() - t > 5000) {
			nextTick(() => stop());
			return;
		}

		paint.value = nextPaint ?? null;
		activeBadges.value = badgeList ?? [];
	},
	{ immediate: true },
);

onUnmounted(() => {
	if (copyToastTimer !== null) {
		clearTimeout(copyToastTimer);
		copyToastTimer = null;
	}

	if (props.msgId) {
		openUserCards.close(props.msgId);
	}
});

function createUserCardAnchor(): ReferenceElement | undefined {
	const lineAnchor =
		tagRef.value?.closest(".seventv-chat-message-background") ??
		tagRef.value?.closest(".seventv-chat-message-container") ??
		tagRef.value;
	const usernameAnchor = usernameRef.value ?? tagRef.value;

	if (!lineAnchor || !usernameAnchor) return undefined;

	return {
		contextElement: lineAnchor,
		getBoundingClientRect() {
			const lineRect = lineAnchor.getBoundingClientRect();
			const usernameRect = usernameAnchor.getBoundingClientRect();
			const x = lineRect.right;
			const y = usernameRect.bottom;

			return {
				width: 0,
				height: 0,
				x,
				y,
				top: y,
				left: x,
				right: x,
				bottom: y,
			};
		},
	};
}

function resolveTwitchBadges(
	badges: Record<string, string> | undefined,
	badgeData: Record<string, string> | undefined,
	sourceData: Twitch.SharedChat | undefined,
	badgeSets: NonNullable<typeof twitchBadgeSets.value> | null | undefined,
): TwitchChatBadgeWithData[] {
	if (!badges || !badgeSets) return [];

	const resolved: TwitchChatBadgeWithData[] = [];
	for (const [setID, badgeID] of Object.entries(badges)) {
		for (const setGroup of [sourceData?.badges.channelsBySet ?? badgeSets.channelsBySet, badgeSets.globalsBySet]) {
			if (!setGroup) continue;

			const set = setGroup.get(setID);
			if (!set) continue;

			const badge = set.get(badgeID);
			if (!badge) continue;

			resolved.push({ ...badge, data: badgeData?.[badge.setID] });
			break;
		}
	}

	return resolved;
}
</script>

<style scoped lang="scss">
.seventv-chat-user {
	display: inline-block;
	cursor: pointer;
	word-break: break-all;
	vertical-align: baseline;
	margin: -0.2rem;
	padding: 0.2rem;

	.seventv-chat-user-badge-list {
		margin-right: 0.25em;

		:deep(img) {
			vertical-align: middle;
		}

		.seventv-chat-badge ~ .seventv-chat-badge {
			margin-left: 0.25em;
		}
	}

	.seventv-chat-user-username {
		font-weight: 700;
	}
}

.seventv-user-card-float {
	position: fixed;
}
</style>
