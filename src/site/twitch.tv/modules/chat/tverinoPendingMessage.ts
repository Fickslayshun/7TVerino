import type { ChatMessage } from "@/common/chat/ChatMessage";
import type { TypedWorkerMessage } from "@/worker";

const pendingSendResults = new Map<string, TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">>();
const selfMessageStates = new Map<string, TVerinoSelfMessageState>();

export interface TVerinoSelfMessageState {
	badges?: Record<string, string>;
	badgeDynamicData?: Record<string, string>;
	displayBadges?: Twitch.ChatBadge[];
	user?: Partial<Twitch.ChatUser>;
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
