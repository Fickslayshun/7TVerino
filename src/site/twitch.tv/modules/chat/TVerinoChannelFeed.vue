<template>
	<ChatData />
</template>

<script setup lang="ts">
import { onUnmounted, provide, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { CHANNEL_CTX, type ChannelContext, type ChannelRole } from "@/composable/channel/useChannelContext";
import { useChatMessageProcessor } from "@/composable/chat/useChatMessageProcessor";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useApollo } from "@/composable/useApollo";
import { twitchUserCardQuery } from "@/assets/gql/tw.user-card.gql";
import { twitchUserDisplayBadgesQuery } from "@/assets/gql/tw.user-display-badges.gql";
import {
	applyTVerinoSelfMessageStateToMessage,
	applyTVerinoSendResultToMessage,
	getTVerinoSelfMessageState,
	isTVerinoMessageMissingSelfState,
	rememberTVerinoSelfMessageState,
	storePendingTVerinoSendResult,
	toTVerinoBadgeMap,
} from "./tverinoPendingMessage";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import ChatData from "@/app/chat/ChatData.vue";
import type { TypedWorkerMessage } from "@/worker";

const props = defineProps<{
	ctx: ChannelContext;
}>();

provide(CHANNEL_CTX, props.ctx);

const apollo = useApollo();
const properties = useChatProperties(props.ctx);
const { target } = useTVerinoChatTransport();
const processor = useChatMessageProcessor(props.ctx);
const messages = useChatMessages(props.ctx);
const { identity } = storeToRefs(useStore());
const requestedBadgeUsers = new Set<string>();
let roleRequestToken = 0;

function onTverinoChatMessage(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_MESSAGE">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	const selfState = getTVerinoSelfMessageState(props.ctx.id);
	const author = detail.message.user ?? detail.message.message?.user;
	const isActorMessage =
		!!author &&
		((identity.value?.id && author.userID === identity.value.id) ||
			(!!identity.value?.username && author.userLogin === identity.value.username.toLowerCase()));
	if (isActorMessage && selfState) {
		if (
			Object.keys(detail.message.badges ?? detail.message.message?.badges ?? {}).length === 0 &&
			selfState.badges
		) {
			detail.message.badges = { ...selfState.badges };
		}
		if (
			Object.keys(detail.message.badgeDynamicData ?? detail.message.message?.badgeDynamicData ?? {}).length ===
				0 &&
			selfState.badgeDynamicData
		) {
			detail.message.badgeDynamicData = { ...selfState.badgeDynamicData };
		}
		if (detail.message.user && !detail.message.user.color && selfState.user?.color) {
			detail.message.user.color = selfState.user.color;
		}
	}

	void hydrateMessageBadges(detail.message);
	processor.onMessage(detail.message);
}

function onTverinoSendResult(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	const found = messages.find((msg) => msg.nonce === detail.nonce);
	if (!found) {
		storePendingTVerinoSendResult(detail);
		return;
	}

	applyTVerinoSendResultToMessage(found, detail);

	if (detail.ok) {
		if (detail.messageID) {
			found.setID(detail.messageID);
		}
		found.setDeliveryState("SENT");
		return;
	}

	found.setDeliveryState("BOUNCED");
}

function onTverinoRoomState(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_ROOMSTATE">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	Object.assign(props.ctx.roomState, detail.roomState);
}

async function hydrateMessageBadges(message: Twitch.AnyMessage): Promise<void> {
	const author = message.user ?? message.message?.user;
	const badges = message.badges ?? message.message?.badges ?? {};
	if (!apollo.value || !props.ctx.id || !author?.userLogin || Object.keys(badges).length === 0) return;

	const cacheKey = `${props.ctx.id}:${author.userID || author.userLogin}`;
	if (requestedBadgeUsers.has(cacheKey)) return;

	requestedBadgeUsers.add(cacheKey);

	try {
		const resp = await apollo.value.query<
			twitchUserDisplayBadgesQuery.Response,
			twitchUserDisplayBadgesQuery.Variables
		>({
			query: twitchUserDisplayBadgesQuery,
			variables: {
				channelID: props.ctx.id,
				login: author.userLogin,
			},
			fetchPolicy: "network-only",
		});

		const displayBadges = resp.data.user?.displayBadges ?? [];
		if (!displayBadges.length) return;

		properties.twitchBadgeSets = mergeBadgeSets(properties.twitchBadgeSets, displayBadges);
	} catch {
		requestedBadgeUsers.delete(cacheKey);
	}
}

function mapDisplayBadgesToRoles(badges: Twitch.ChatBadge[]): Set<ChannelRole> {
	const nextRoles = new Set<ChannelRole>();

	for (const badge of badges) {
		switch (badge.setID) {
			case "broadcaster":
				nextRoles.add("BROADCASTER");
				nextRoles.add("MODERATOR");
				break;
			case "moderator":
				nextRoles.add("MODERATOR");
				break;
			case "vip":
				nextRoles.add("VIP");
				break;
			case "subscriber":
			case "founder":
				nextRoles.add("SUBSCRIBER");
				break;
		}
	}

	return nextRoles;
}

function patchKnownSelfMessages(): void {
	const actorID = identity.value?.id;
	const selfState = getTVerinoSelfMessageState(props.ctx.id);
	if (!actorID || !selfState) return;

	for (const message of messages.find(
		(msg) => msg.author?.id === actorID && isTVerinoMessageMissingSelfState(msg),
		true,
	)) {
		applyTVerinoSelfMessageStateToMessage(message, selfState);
	}
}

async function syncActorRoles(): Promise<void> {
	const viewerLogin = identity.value?.username?.trim().toLowerCase();
	const channelID = props.ctx.id?.trim();
	if (!apollo.value || !viewerLogin || !channelID) {
		props.ctx.actor.roles = new Set();
		return;
	}

	const token = ++roleRequestToken;

	try {
		const resp = await apollo.value.query<twitchUserCardQuery.Response, twitchUserCardQuery.Variables>({
			query: twitchUserCardQuery,
			variables: {
				channelID,
				channelIDStr: channelID,
				channelLogin: props.ctx.username,
				targetLogin: viewerLogin,
				isViewerBadgeCollectionEnabled: false,
				withStandardGifting: false,
			},
			fetchPolicy: "network-only",
		});

		if (token !== roleRequestToken) return;
		const displayBadges = resp.data.targetUser?.displayBadges ?? [];
		const nextRoles = mapDisplayBadgesToRoles(displayBadges);
		const displayName = resp.data.targetUser?.displayName || identity.value?.username || viewerLogin;

		if (displayBadges.length) {
			properties.twitchBadgeSets = mergeBadgeSets(properties.twitchBadgeSets, displayBadges);
		}

		rememberTVerinoSelfMessageState(props.ctx.id, {
			badges: toTVerinoBadgeMap(displayBadges),
			displayBadges: displayBadges.map((badge) => ({ ...badge })),
			user: {
				color: resp.data.targetUser?.chatColor || "",
				userID: resp.data.targetUser?.id || resp.data.currentUser?.id || identity.value?.id || "",
				userLogin: viewerLogin,
				userDisplayName: displayName,
				displayName,
				userType: "",
				isIntl: false,
				isSubscriber: nextRoles.has("SUBSCRIBER"),
			},
		});
		patchKnownSelfMessages();

		if (resp.data.targetUser?.isModerator || resp.data.channelUser?.self?.isModerator) {
			nextRoles.add("MODERATOR");
		}
		if (resp.data.currentUser?.id === channelID) {
			nextRoles.add("BROADCASTER");
			nextRoles.add("MODERATOR");
		}
		props.ctx.actor.roles = nextRoles;
	} catch {
		if (token !== roleRequestToken) return;
		props.ctx.actor.roles = new Set();
	}
}

function mergeBadgeSets(current: Twitch.BadgeSets | null | undefined, badges: Twitch.ChatBadge[]): Twitch.BadgeSets {
	const globalsBySet = cloneBadgeSetMap(current?.globalsBySet);
	const channelsBySet = cloneBadgeSetMap(current?.channelsBySet);

	for (const badge of badges) {
		let versions = channelsBySet.get(badge.setID);
		if (!versions) {
			versions = new Map();
			channelsBySet.set(badge.setID, versions);
		}

		versions.set(badge.version, badge);
	}

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function cloneBadgeSetMap(
	source: Map<string, Map<string, Twitch.ChatBadge>> | null | undefined,
): Map<string, Map<string, Twitch.ChatBadge>> {
	const cloned = new Map<string, Map<string, Twitch.ChatBadge>>();
	if (!source) return cloned;

	for (const [setID, versions] of source) {
		cloned.set(setID, new Map(versions));
	}

	return cloned;
}

target.addEventListener("tverino_chat_message", onTverinoChatMessage);
target.addEventListener("tverino_chat_roomstate", onTverinoRoomState);
target.addEventListener("tverino_chat_send_result", onTverinoSendResult);

watch(
	() => [props.ctx.id, identity.value?.username] as const,
	() => {
		void syncActorRoles();
	},
	{ immediate: true },
);

onUnmounted(() => {
	target.removeEventListener("tverino_chat_message", onTverinoChatMessage);
	target.removeEventListener("tverino_chat_roomstate", onTverinoRoomState);
	target.removeEventListener("tverino_chat_send_result", onTverinoSendResult);
});
</script>
