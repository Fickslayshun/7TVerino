import { APP_BROADCAST_CHANNEL } from "@/common/Constant";
import {
	twitchSelectChannelAuthorityBadgeMut,
	twitchSelectChannelBadgeMut,
	twitchSelectGlobalBadgeMut,
} from "@/assets/gql/tw.chat-badge-select.gql";
import { getTwitchHelixAuth } from "./twitchHelixAuth";

const bc = new BroadcastChannel(APP_BROADCAST_CHANNEL);
const pending = new Map<string, { resolve: () => void; reject: (reason?: unknown) => void }>();

bc.addEventListener("message", (ev) => {
	if (ev.data?.type !== "seventv-twitch-select-chat-badge-result") return;

	const detail = ev.data.data as { requestID: string; ok: boolean; error?: string };
	const listener = pending.get(detail.requestID);
	if (!listener) return;

	pending.delete(detail.requestID);
	if (detail.ok) {
		listener.resolve();
		return;
	}

	listener.reject(new Error(detail.error || "Badge selection failed"));
});

export interface TwitchGlobalBadgeSelectionInput {
	badgeSetID: string;
	badgeSetVersion?: string;
}

export interface TwitchChannelBadgeSelectionInput extends TwitchGlobalBadgeSelectionInput {
	channelID: string;
}

interface ApolloMutationErrorLike {
	message?: string;
}

interface ApolloMutationResultLike<TData> {
	data?: TData | null;
	errors?: ApolloMutationErrorLike[] | null;
}

interface ApolloMutationClientLike {
	mutate: (options: {
		mutation: unknown;
		variables: Record<string, unknown>;
		fetchPolicy?: string;
		errorPolicy?: string;
	}) => Promise<unknown>;
}

export async function selectTwitchGlobalBadge(input: TwitchGlobalBadgeSelectionInput, client?: unknown): Promise<void> {
	const mutationClient = isApolloMutationClient(client) ? client : null;

	if (mutationClient) {
		try {
			const response = (await mutationClient.mutate({
				mutation: twitchSelectGlobalBadgeMut,
				fetchPolicy: "no-cache",
				errorPolicy: "all",
				variables: {
					input: buildGlobalBadgeInput(input),
				},
			})) as ApolloMutationResultLike<twitchSelectGlobalBadgeMut.Response>;

			if (response.data?.selectGlobalBadge?.user?.id) {
				return;
			}

			const apolloError = extractApolloMutationError(response);
			if (apolloError) {
				throw new Error(apolloError);
			}
		} catch (error) {
			if (!shouldFallbackApolloBadgeSelection(error)) {
				throw toError(error, "Badge selection failed");
			}
		}
	}

	return requestBadgeSelection("global", input);
}

export async function selectTwitchChannelBadge(
	input: TwitchChannelBadgeSelectionInput,
	client?: unknown,
): Promise<void> {
	const mutationClient = isApolloMutationClient(client) ? client : null;

	if (mutationClient) {
		try {
			const response = (await mutationClient.mutate({
				mutation: twitchSelectChannelBadgeMut,
				fetchPolicy: "no-cache",
				errorPolicy: "all",
				variables: {
					input: buildChannelBadgeInput(input),
				},
			})) as ApolloMutationResultLike<twitchSelectChannelBadgeMut.Response>;

			if (response.data?.selectChannelBadge?.user?.id) {
				return;
			}

			const apolloError = extractApolloMutationError(response);
			if (apolloError) {
				throw new Error(apolloError);
			}
		} catch (error) {
			if (!shouldFallbackApolloBadgeSelection(error)) {
				throw toError(error, "Badge selection failed");
			}
		}
	}

	return requestBadgeSelection("channel", input);
}

export async function selectTwitchChannelAuthorityBadge(
	input: TwitchChannelBadgeSelectionInput,
	client?: unknown,
): Promise<void> {
	const mutationClient = isApolloMutationClient(client) ? client : null;

	if (mutationClient) {
		try {
			const response = (await mutationClient.mutate({
				mutation: twitchSelectChannelAuthorityBadgeMut,
				fetchPolicy: "no-cache",
				errorPolicy: "all",
				variables: {
					input: buildChannelBadgeInput(input),
				},
			})) as ApolloMutationResultLike<twitchSelectChannelAuthorityBadgeMut.Response>;

			if (response.data?.selectChannelAuthorityBadge?.user?.id) {
				return;
			}

			const apolloError = extractApolloMutationError(response);
			if (apolloError) {
				throw new Error(apolloError);
			}
		} catch (error) {
			if (!shouldFallbackApolloBadgeSelection(error)) {
				throw toError(error, "Badge selection failed");
			}
		}
	}

	return requestBadgeSelection("channel_authority", input);
}

function requestBadgeSelection(
	kind: "global" | "channel" | "channel_authority",
	input: TwitchGlobalBadgeSelectionInput | TwitchChannelBadgeSelectionInput,
): Promise<void> {
	const auth = getTwitchHelixAuth();
	if (!auth.clientID || !auth.token) {
		return Promise.reject(new Error("Twitch badge auth unavailable"));
	}

	const requestID = `badge-select:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

	return new Promise((resolve, reject) => {
		pending.set(requestID, { resolve, reject });
		bc.postMessage({
			type: "seventv-twitch-select-chat-badge",
			data: {
				requestID,
				kind,
				clientID: auth.clientID,
				token: auth.token,
				badgeSetID: input.badgeSetID,
				badgeSetVersion: input.badgeSetVersion ?? "",
				channelID: "channelID" in input ? input.channelID : "",
			},
		});
	});
}

function buildGlobalBadgeInput(input: TwitchGlobalBadgeSelectionInput): {
	badgeSetID: string;
	badgeSetVersion?: string;
} {
	const built = {
		badgeSetID: input.badgeSetID.trim(),
	} as {
		badgeSetID: string;
		badgeSetVersion?: string;
	};

	if (input.badgeSetVersion?.trim()) {
		built.badgeSetVersion = input.badgeSetVersion.trim();
	}

	return built;
}

function buildChannelBadgeInput(input: TwitchChannelBadgeSelectionInput): {
	channelID: string;
	badgeSetID: string;
	badgeSetVersion?: string;
} {
	const built = {
		channelID: input.channelID.trim(),
		badgeSetID: input.badgeSetID.trim(),
	} as {
		channelID: string;
		badgeSetID: string;
		badgeSetVersion?: string;
	};

	if (input.badgeSetVersion?.trim()) {
		built.badgeSetVersion = input.badgeSetVersion.trim();
	}

	return built;
}

function extractApolloMutationError<TData>(result: ApolloMutationResultLike<TData>): string {
	return (result.errors ?? [])
		.map((error) => error.message || "")
		.filter(Boolean)
		.join("; ");
}

function shouldFallbackApolloBadgeSelection(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	if (!message.trim()) return true;

	return /network|fetch|client unavailable/i.test(message);
}

function toError(error: unknown, fallback: string): Error {
	if (error instanceof Error && error.message.trim()) return error;
	if (typeof error === "string" && error.trim()) return new Error(error);
	return new Error(fallback);
}

function isApolloMutationClient(value: unknown): value is ApolloMutationClientLike {
	return !!value && typeof value === "object" && "mutate" in value && typeof value.mutate === "function";
}
