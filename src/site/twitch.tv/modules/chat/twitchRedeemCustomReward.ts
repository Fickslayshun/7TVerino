import { twitchRedeemCustomRewardMut } from "@/assets/gql/tw.chat-redeem-custom-reward.gql";
import { APP_BROADCAST_CHANNEL } from "@/common/Constant";
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

	listener.reject(new Error(detail.error || "Reward redemption failed"));
});

export interface TwitchRedeemCustomRewardInput {
	channelID: string;
	rewardID: string;
	cost: number;
	title: string;
	prompt?: string | null;
	transactionID?: string;
}

interface ApolloMutationErrorLike {
	message?: string;
}

interface ApolloMutationResultLike {
	data?: twitchRedeemCustomRewardMut.Response | null;
	errors?: ApolloMutationErrorLike[] | null;
}

export async function redeemTwitchCustomReward(
	input: TwitchRedeemCustomRewardInput,
	client?: unknown,
): Promise<void> {
	const transactionID = input.transactionID ?? createTransactionID();
	const mutationClient = isApolloMutationClient(client) ? client : null;

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
						title: input.title,
						transactionID,
					},
				},
			})) as ApolloMutationResultLike;

			if (response.data?.redeemCommunityPointsCustomReward?.redemption?.id) {
				return;
			}

			const apolloError = extractApolloMutationError(response);
			if (apolloError) {
				throw new Error(apolloError);
			}
		} catch (error) {
			if (!shouldFallbackApolloRedeem(error)) {
				throw toError(error, "Reward redemption failed");
			}
		}
	}

	const auth = getTwitchHelixAuth();
	if (!auth.clientID || !auth.token) {
		throw new Error("Twitch reward auth unavailable");
	}

	const requestID = `reward-redeem:${input.channelID}:${input.rewardID}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

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
				clientID: auth.clientID,
				token: auth.token,
				transactionID,
			},
		});
	});
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
	if (error instanceof Error && error.message.trim()) return error;
	if (typeof error === "string" && error.trim()) return new Error(error);
	return new Error(fallback);
}

function isApolloMutationClient(value: unknown): value is { mutate: (...args: unknown[]) => Promise<unknown> } {
	return !!value && typeof value === "object" && "mutate" in value && typeof value.mutate === "function";
}

function createTransactionID(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
