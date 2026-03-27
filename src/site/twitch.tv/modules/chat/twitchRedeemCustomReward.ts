import { APP_BROADCAST_CHANNEL } from "@/common/Constant";
import {
	TWITCH_REDEEM_UNAUTHENTICATED_MESSAGE,
	type TwitchRewardRedemptionResponse,
	extractTwitchRewardRedemptionError,
	isTwitchRewardRedemptionAccepted,
	normalizeTwitchRewardRedemptionErrorMessage,
} from "@/common/TwitchRewardRedemption";
import { twitchRedeemCustomRewardMut } from "@/assets/gql/tw.chat-redeem-custom-reward.gql";
import { getTwitchHelixAuth } from "./twitchHelixAuth";

const bc = new BroadcastChannel(APP_BROADCAST_CHANNEL);
const pending = new Map<string, { resolve: () => void; reject: (reason?: unknown) => void }>();

bc.addEventListener("message", (ev) => {
	if (ev.data?.type !== "seventv-twitch-redeem-custom-reward-result") return;

	const detail = ev.data.data as { requestID: string; ok: boolean; error?: string };
	const listener = pending.get(detail.requestID);
	if (!listener) return;

	pending.delete(detail.requestID);
	if (detail.ok) {
		listener.resolve();
		return;
	}

	listener.reject(new Error(normalizeRewardRedemptionErrorMessage(detail.error, "Reward redemption failed")));
});

export interface TwitchRedeemCustomRewardInput {
	channelID: string;
	rewardID: string;
	cost: number;
	title: string;
	prompt?: string | null;
	textInput?: string | null;
	transactionID?: string;
}

interface ApolloMutationErrorLike {
	message?: string;
}

interface ApolloMutationResultLike {
	data?: twitchRedeemCustomRewardMut.Response | null;
	errors?: ApolloMutationErrorLike[] | null;
}

export async function redeemTwitchCustomReward(input: TwitchRedeemCustomRewardInput, client?: unknown): Promise<void> {
	const transactionID = input.transactionID ?? createTransactionID();
	const mutationClient = isApolloMutationClient(client) ? client : null;
	const requestBody = buildRewardRedemptionRequestBody(input, transactionID);

	if (mutationClient) {
		try {
			const response = (await mutationClient.mutate({
				mutation: twitchRedeemCustomRewardMut,
				fetchPolicy: "no-cache",
				errorPolicy: "all",
				variables: {
					input: {
						channelID: input.channelID,
						cost: input.cost,
						prompt: input.prompt ?? null,
						rewardID: input.rewardID,
						textInput: input.textInput ?? null,
						title: input.title,
						transactionID,
					},
				},
			})) as ApolloMutationResultLike;

			if (response.data?.redeemCommunityPointsCustomReward?.redemption?.id) {
				return;
			}

			const payloadError = extractTwitchRewardRedemptionError({
				data: response.data
					? {
							redeemCommunityPointsCustomReward: response.data.redeemCommunityPointsCustomReward,
					  }
					: undefined,
				errors: null,
			});
			if (payloadError) {
				throw new Error(payloadError);
			}

			const apolloError = extractApolloMutationError(response);
			if (apolloError) {
				throw new Error(normalizeRewardRedemptionErrorMessage(apolloError, "Reward redemption failed"));
			}
		} catch (error) {
			if (!shouldFallbackApolloRedeem(error)) {
				throw toError(error, "Reward redemption failed");
			}
		}
	}

	const auth = getTwitchHelixAuth();
	if (auth.clientID) {
		try {
			await redeemTwitchRewardViaPageRequest(requestBody, auth.clientID, auth.token);
			return;
		} catch (error) {
			if (!shouldFallbackApolloRedeem(error)) {
				throw toError(error, "Reward redemption failed");
			}
		}
	}

	if (!auth.clientID || !auth.token) {
		throw new Error(TWITCH_REDEEM_UNAUTHENTICATED_MESSAGE);
	}

	const requestID = `reward-redeem:${input.channelID}:${input.rewardID}:${Date.now()}:${Math.random()
		.toString(36)
		.slice(2, 8)}`;

	return new Promise((resolve, reject) => {
		pending.set(requestID, { resolve, reject });
		bc.postMessage({
			type: "seventv-twitch-redeem-custom-reward",
			data: {
				requestID,
				channelID: input.channelID,
				rewardID: input.rewardID,
				cost: input.cost,
				title: input.title,
				prompt: input.prompt ?? null,
				textInput: input.textInput ?? null,
				clientID: auth.clientID,
				token: auth.token,
				transactionID,
			},
		});
	});
}

function buildRewardRedemptionRequestBody(input: TwitchRedeemCustomRewardInput, transactionID: string): string {
	return JSON.stringify([
		{
			operationName: "RedeemCustomReward",
			variables: {
				input: {
					channelID: input.channelID,
					cost: input.cost,
					prompt: input.prompt ?? null,
					rewardID: input.rewardID,
					textInput: input.textInput ?? null,
					title: input.title,
					transactionID,
				},
			},
			extensions: {
				persistedQuery: {
					version: 1,
					sha256Hash: "d56249a7adb4978898ea3412e196688d4ac3cea1c0c2dfd65561d229ea5dcc42",
				},
			},
		},
	]);
}

async function redeemTwitchRewardViaPageRequest(body: string, clientID: string, token?: string): Promise<void> {
	let cookieError: unknown = null;

	try {
		const cookiePayload = await postTwitchRewardRedemptionRequest(body, clientID, undefined, true);
		if (isRewardRedemptionAccepted(cookiePayload)) {
			return;
		}

		const cookieMessage = extractTwitchRewardRedemptionError(cookiePayload);
		if (cookieMessage) {
			throw new Error(normalizeRewardRedemptionErrorMessage(cookieMessage, "Reward redemption failed"));
		}
	} catch (error) {
		cookieError = error;
	}

	if (token?.trim()) {
		const bearerPayload = await postTwitchRewardRedemptionRequest(body, clientID, token, true);
		if (isRewardRedemptionAccepted(bearerPayload)) {
			return;
		}

		const bearerMessage = extractTwitchRewardRedemptionError(bearerPayload);
		if (bearerMessage) {
			throw new Error(normalizeRewardRedemptionErrorMessage(bearerMessage, "Reward redemption failed"));
		}
	}

	if (cookieError instanceof Error && cookieError.message.trim()) {
		throw cookieError;
	}

	throw new Error("Reward redemption was not accepted");
}

async function postTwitchRewardRedemptionRequest(
	body: string,
	clientID: string,
	token?: string,
	includeCredentials = false,
): Promise<TwitchRewardRedemptionResponse[]> {
	const headers = {
		"Client-Id": clientID.trim(),
		"Content-Type": "application/json",
	} as Record<string, string>;

	if (token?.trim()) {
		headers.Authorization = `Bearer ${token.trim().replace(/^oauth:/i, "")}`;
	}

	const response = await fetch("https://gql.twitch.tv/gql#origin=twilight", {
		method: "POST",
		headers,
		body,
		credentials: includeCredentials ? "include" : "omit",
		referrer: location.origin,
		referrerPolicy: "origin",
	});

	if (!response.ok) {
		throw new Error(`Reward redemption failed: ${response.status}`);
	}

	return (await response.json()) as TwitchRewardRedemptionResponse[];
}

function extractApolloMutationError(result: ApolloMutationResultLike): string {
	return (result.errors ?? [])
		.map((error) => error.message || "")
		.filter(Boolean)
		.join("; ");
}

function shouldFallbackApolloRedeem(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	if (!message.trim()) return true;

	return /not accepted|unauthenticated|network|fetch/i.test(message);
}

function toError(error: unknown, fallback: string): Error {
	if (error instanceof Error && error.message.trim()) {
		return new Error(normalizeRewardRedemptionErrorMessage(error.message, fallback));
	}
	if (typeof error === "string" && error.trim()) {
		return new Error(normalizeRewardRedemptionErrorMessage(error, fallback));
	}
	return new Error(fallback);
}

function isApolloMutationClient(value: unknown): value is { mutate: (...args: unknown[]) => Promise<unknown> } {
	return !!value && typeof value === "object" && "mutate" in value && typeof value.mutate === "function";
}

function isRewardRedemptionAccepted(payload: TwitchRewardRedemptionResponse[]): boolean {
	return isTwitchRewardRedemptionAccepted(payload);
}

function normalizeRewardRedemptionErrorMessage(message: unknown, fallback = "Reward redemption failed"): string {
	return normalizeTwitchRewardRedemptionErrorMessage(message, fallback);
}

function createTransactionID(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
