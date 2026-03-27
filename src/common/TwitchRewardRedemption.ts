export const TWITCH_REDEEM_UNAUTHENTICATED_MESSAGE = "Log in to Twitch to redeem channel point rewards.";

export interface TwitchRewardRedemptionGraphQLError {
	message?: string;
}

export interface TwitchRewardRedemptionPayload {
	error?: {
		code?: string | null;
	} | null;
	redemption?: {
		id?: string;
	} | null;
}

export interface TwitchRewardRedemptionResponse {
	data?: {
		redeemCommunityPointsCustomReward?: TwitchRewardRedemptionPayload | null;
	};
	errors?: TwitchRewardRedemptionGraphQLError[] | null;
}

export function isTwitchRewardRedemptionAccepted(
	payload: TwitchRewardRedemptionResponse[] | TwitchRewardRedemptionResponse | null | undefined,
): boolean {
	return !!getTwitchRewardRedemptionPayload(payload)?.redemption?.id;
}

export function extractTwitchRewardRedemptionError(
	payload: TwitchRewardRedemptionResponse[] | TwitchRewardRedemptionResponse | null | undefined,
): string {
	const payloadErrorCode = getTwitchRewardRedemptionPayload(payload)?.error?.code?.trim() ?? "";
	if (payloadErrorCode) {
		return normalizeTwitchRewardRedemptionErrorMessage(payloadErrorCode, "Reward redemption failed");
	}

	const graphQLErrorMessage = toTwitchRewardRedemptionResponses(payload)
		.flatMap((entry) => entry.errors ?? [])
		.map((error) => error.message || "Unknown Twitch error")
		.filter(Boolean)
		.join("; ");

	return graphQLErrorMessage
		? normalizeTwitchRewardRedemptionErrorMessage(graphQLErrorMessage, "Reward redemption failed")
		: "";
}

export function normalizeTwitchRewardRedemptionErrorMessage(
	message: unknown,
	fallback = "Reward redemption failed",
): string {
	const normalized =
		typeof message === "string"
			? message.trim()
			: message instanceof Error && message.message.trim()
			  ? message.message.trim()
			  : "";

	if (!normalized) return fallback;

	const mappedCodeMessage = mapTwitchRewardRedemptionErrorCode(normalized);
	if (mappedCodeMessage) {
		return mappedCodeMessage;
	}

	if (/unauthenticated|auth unavailable|oauth/i.test(normalized)) {
		return TWITCH_REDEEM_UNAUTHENTICATED_MESSAGE;
	}

	return normalized;
}

function getTwitchRewardRedemptionPayload(
	payload: TwitchRewardRedemptionResponse[] | TwitchRewardRedemptionResponse | null | undefined,
): TwitchRewardRedemptionPayload | null {
	return toTwitchRewardRedemptionResponses(payload)[0]?.data?.redeemCommunityPointsCustomReward ?? null;
}

function toTwitchRewardRedemptionResponses(
	payload: TwitchRewardRedemptionResponse[] | TwitchRewardRedemptionResponse | null | undefined,
): TwitchRewardRedemptionResponse[] {
	if (!payload) return [];
	return Array.isArray(payload) ? payload : [payload];
}

function mapTwitchRewardRedemptionErrorCode(value: string): string | null {
	const code = value.trim().toUpperCase();
	if (!/^[A-Z_]+$/.test(code)) return null;

	switch (code) {
		case "NOT_FOUND":
			return "Reward no longer exists.";
		case "FORBIDDEN":
			return "You can't redeem that reward in this channel.";
		case "NOT_ENOUGH_POINTS":
			return "Not enough channel points.";
		case "PROPERTIES_MISMATCH":
			return "Reward details are out of date. Reopen the reward and try again.";
		case "DUPLICATE_TRANSACTION":
			return "This reward redemption was already submitted.";
		case "TRANSACTION_IN_PROGRESS":
			return "Reward redemption already in progress.";
		case "DISABLED":
			return "That reward is disabled right now.";
		case "STREAM_NOT_LIVE":
			return "That reward can only be redeemed while the stream is live.";
		case "MAX_PER_STREAM":
			return "That reward has reached its per-stream limit.";
		case "USER_BANNED":
			return "Banned users can't redeem channel point rewards.";
		case "CHANNEL_SETTINGS":
			return "Reward text violates this channel's blocked phrase settings.";
		case "MESSAGE_IS_COMMAND":
			return "Reward text can't start with '/'.";
		case "MAX_PER_USER_PER_STREAM":
			return "You've already reached the limit for that reward this stream.";
		case "GLOBAL_COOLDOWN":
			return "That reward is on cooldown right now.";
		case "UNKNOWN":
			return "Reward redemption failed.";
		default:
			return `Reward redemption failed: ${formatScreamingSnakeCase(code)}.`;
	}
}

function formatScreamingSnakeCase(value: string): string {
	return value
		.toLowerCase()
		.split("_")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}
