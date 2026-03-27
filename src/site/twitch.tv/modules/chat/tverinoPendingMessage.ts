import type { ChatMessage } from "@/common/chat/ChatMessage";
import { MessageType } from "@/site/twitch.tv";
import type { TypedWorkerMessage } from "@/worker";

const pendingSendResults = new Map<string, TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">>();
const selfMessageStates = new Map<string, TVerinoSelfMessageState>();
const PENDING_TYPED_REWARD_TTL_MS = 30_000;
const pendingTypedRewardRedemptions: PendingTypedRewardRedemption[] = [];

export interface TVerinoSelfMessageState {
	badges?: Record<string, string>;
	badgeDynamicData?: Record<string, string>;
	displayBadges?: Twitch.ChatBadge[];
	user?: Partial<Twitch.ChatUser>;
}

interface PendingTypedRewardRedemption {
	channelID: string;
	actorID: string;
	createdAt: number;
	messageBody: string;
	reward: Twitch.ChannelPointsRewardMessage["reward"];
}

export function applyTVerinoSendResultToMessage(
	message: ChatMessage,
	detail: TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">,
): void {
	if (message.channelID) {
		rememberTVerinoSelfMessageState(message.channelID, {
			user: detail.user,
			badges: detail.badges,
			badgeDynamicData: detail.badgeDynamicData,
		});
	}

	applyTVerinoSelfMessageStateToMessage(message, {
		user: detail.user,
		badges: detail.badges,
		badgeDynamicData: detail.badgeDynamicData,
	});
}

export function applyTVerinoSelfMessageStateToMessage(
	message: ChatMessage,
	state: TVerinoSelfMessageState | null | undefined,
): void {
	if (!state) return;

	const detailUser = state.user;
	if (detailUser) {
		const username = detailUser.userLogin || message.author?.username || "";
		const displayName = detailUser.userDisplayName || detailUser.displayName || username;
		const nextColor = detailUser.color || message.author?.color || "";

		if (message.author) {
			message.author.id = detailUser.userID || message.author.id;
			message.author.username = username;
			message.author.displayName = displayName;
			message.author.color = nextColor;
			message.author.intl = detailUser.isIntl;
		} else {
			message.setAuthor({
				id: detailUser.userID || username,
				username,
				displayName,
				color: nextColor,
				intl: detailUser.isIntl,
			});
		}
	}

	if (state.badges && Object.keys(state.badges).length > 0) {
		message.badges = { ...state.badges };
	}

	if (state.badgeDynamicData && Object.keys(state.badgeDynamicData).length > 0) {
		message.badgeData = { ...state.badgeDynamicData };
	}
}

export function rememberTVerinoSelfMessageState(channelID: string, state: TVerinoSelfMessageState): void {
	if (!channelID) return;

	const current = selfMessageStates.get(channelID);
	selfMessageStates.set(channelID, {
		user: state.user ? { ...(current?.user ?? {}), ...state.user } : current?.user,
		badges: state.badges && Object.keys(state.badges).length > 0 ? { ...state.badges } : current?.badges,
		badgeDynamicData:
			state.badgeDynamicData && Object.keys(state.badgeDynamicData).length > 0
				? { ...state.badgeDynamicData }
				: current?.badgeDynamicData,
		displayBadges:
			state.displayBadges && state.displayBadges.length > 0
				? state.displayBadges.map((badge) => ({ ...badge }))
				: current?.displayBadges,
	});
}

export function getTVerinoSelfMessageState(channelID: string): TVerinoSelfMessageState | null {
	const state = selfMessageStates.get(channelID);
	if (!state) return null;

	return {
		user: state.user ? { ...state.user } : undefined,
		badges: state.badges ? { ...state.badges } : undefined,
		badgeDynamicData: state.badgeDynamicData ? { ...state.badgeDynamicData } : undefined,
		displayBadges: state.displayBadges?.map((badge) => ({ ...badge })),
	};
}

export function toTVerinoBadgeMap(badges: Array<Pick<Twitch.ChatBadge, "setID" | "version">>): Record<string, string> {
	const mapped = {} as Record<string, string>;
	for (const badge of badges) {
		if (!badge.setID || !badge.version) continue;
		mapped[badge.setID] = badge.version;
	}

	return mapped;
}

export function hasTVerinoBadgeData(state: TVerinoSelfMessageState | null | undefined): boolean {
	return !!(
		state &&
		((state.badges && Object.keys(state.badges).length > 0) ||
			(state.displayBadges && state.displayBadges.length > 0) ||
			(state.badgeDynamicData && Object.keys(state.badgeDynamicData).length > 0) ||
			state.user)
	);
}

export function isTVerinoMessageMissingSelfState(message: ChatMessage): boolean {
	return Object.keys(message.badges).length === 0 || !message.author?.color;
}

export function storePendingTVerinoSendResult(detail: TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">): void {
	const previous = pendingSendResults.get(detail.nonce);
	pendingSendResults.set(detail.nonce, {
		...(previous ?? {}),
		...detail,
		user: detail.user ?? previous?.user,
		badges: detail.badges ?? previous?.badges,
		badgeDynamicData: detail.badgeDynamicData ?? previous?.badgeDynamicData,
	} as TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">);
}

export function consumePendingTVerinoSendResult(nonce: string): TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT"> | null {
	const detail = pendingSendResults.get(nonce) ?? null;
	if (detail) {
		pendingSendResults.delete(nonce);
	}

	return detail;
}

export function rememberPendingTVerinoTypedRewardRedemption(
	channelID: string,
	actorID: string,
	reward: Pick<Twitch.ChannelPointsRewardMessage["reward"], "cost" | "name">,
	messageBody: string,
): void {
	const normalizedChannelID = channelID.trim();
	const normalizedActorID = actorID.trim();
	const normalizedMessageBody = normalizePendingTypedRewardMessageBody(messageBody);
	if (!normalizedChannelID || !normalizedActorID || !normalizedMessageBody) return;

	prunePendingTypedRewardRedemptions();
	pendingTypedRewardRedemptions.push({
		channelID: normalizedChannelID,
		actorID: normalizedActorID,
		createdAt: Date.now(),
		messageBody: normalizedMessageBody,
		reward: {
			cost: reward.cost,
			isHighlighted: false,
			name: reward.name,
		},
	});
}

export function promotePendingTVerinoTypedRewardMessage(
	msgData: Twitch.AnyMessage,
	channelID: string,
	actorID: string | null | undefined,
): Twitch.AnyMessage {
	if (msgData.type !== MessageType.MESSAGE || !actorID) return msgData;

	prunePendingTypedRewardRedemptions();

	const message = msgData as Twitch.ChatMessage;
	const author = message.user;
	const normalizedChannelID = channelID.trim();
	const normalizedActorID = actorID.trim();
	const normalizedMessageBody = normalizePendingTypedRewardMessageBody(message.messageBody ?? "");
	if (!normalizedChannelID || !normalizedActorID || !normalizedMessageBody) return msgData;
	if (!author || author.userID !== normalizedActorID) return msgData;

	const matchIndex = pendingTypedRewardRedemptions.findIndex(
		(entry) =>
			entry.channelID === normalizedChannelID &&
			entry.actorID === normalizedActorID &&
			entry.messageBody === normalizedMessageBody,
	);
	if (matchIndex === -1) return msgData;

	const [match] = pendingTypedRewardRedemptions.splice(matchIndex, 1);
	const displayName = author.userDisplayName ?? author.displayName ?? author.userLogin ?? "";

	const promotedMessage: Twitch.ChannelPointsRewardMessage = {
		id: message.id,
		type: MessageType.CHANNEL_POINTS_REWARD,
		sourceRoomID: message.sourceRoomID,
		sourceData: message.sourceData,
		sharedChat: message.sharedChat,
		badges: message.badges ? { ...message.badges } : undefined,
		badgeDynamicData: message.badgeDynamicData ? { ...message.badgeDynamicData } : undefined,
		isHistorical: message.isHistorical,
		nonce: message.nonce,
		seventv: message.seventv,
		t: message.t,
		element: message.element,
		sendState: message.sendState,
		channelID: message.channelID,
		notifySent: message.notifySent,
		displayName,
		login: author.userLogin ?? "",
		userID: author.userID,
		reward: {
			...match.reward,
		},
		message: {
			...message,
			user: { ...message.user },
			badges: message.badges ? { ...message.badges } : {},
			badgeDynamicData: message.badgeDynamicData ? { ...message.badgeDynamicData } : {},
			messageParts: Array.isArray(message.messageParts) ? [...message.messageParts] : [],
			reply: message.reply ? { ...message.reply } : undefined,
		},
	};

	return promotedMessage;
}

function normalizePendingTypedRewardMessageBody(messageBody: string): string {
	return messageBody.replace("\n", " ").trim();
}

function prunePendingTypedRewardRedemptions(now = Date.now()): void {
	for (let index = pendingTypedRewardRedemptions.length - 1; index >= 0; index--) {
		if (now - pendingTypedRewardRedemptions[index].createdAt <= PENDING_TYPED_REWARD_TTL_MS) continue;
		pendingTypedRewardRedemptions.splice(index, 1);
	}
}
