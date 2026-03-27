import {
	type TwitchRewardRedemptionResponse,
	extractTwitchRewardRedemptionError,
	isTwitchRewardRedemptionAccepted,
} from "@/common/TwitchRewardRedemption";
import { downloadSettingsBackupBlob } from "@/common/settingsBackup";

// Handle messaging from downstream

let shouldReloadOnUpdate = false;

chrome.runtime.onMessage.addListener((msg, _, reply) => {
	switch (msg.type) {
		case "permission-request": {
			const { id, origins, permissions } = msg.data;

			chrome.permissions.request({ origins, permissions }, (granted) => {
				reply({ granted, id });

				if (!granted) return;

				chrome.runtime.sendMessage({
					type: "permission-granted",
					data: { id },
				});
			});
			break;
		}
		case "update-check": {
			if (typeof chrome.runtime.requestUpdateCheck !== "function") return;
			shouldReloadOnUpdate = true;

			/* // sim:
			reply({
				status: "update_available",
				version: "3.0.0.12200",
				done: false,
			});

			setTimeout(() => {
				if (!shouldReloadOnUpdate) return;

				broadcastMessage("update-ready", {
					version: "3.0.0.12200",
				});

				setTimeout(() => chrome.runtime.reload(), 50);
			}, 1500);
			return;
			/// end sim */

			chrome.runtime.requestUpdateCheck((status, details) => {
				reply({
					status,
					version: details?.version ?? null,
				});
			});

			break;
		}
		case "settings-backup-download": {
			void downloadSettingsBackupBlob(
				new Blob([msg.data?.text ?? ""], {
					type: msg.data?.mimeType || "application/json",
				}),
			)
				.then(() => {
					reply({
						ok: true,
					});
				})
				.catch((error: unknown) => {
					reply({
						ok: false,
						error:
							error instanceof Error && error.message.trim()
								? error.message
								: "Settings export download failed",
					});
				});
			break;
		}
		case "twitch-redeem-custom-reward": {
			void redeemTwitchCustomReward(msg.data)
				.then(() => {
					reply({
						requestID: msg.data.requestID,
						ok: true,
					});
				})
				.catch((error: unknown) => {
					reply({
						requestID: msg.data.requestID,
						ok: false,
						error:
							error instanceof Error && error.message.trim() ? error.message : "Reward redemption failed",
					});
				});
			break;
		}
		case "twitch-select-chat-badge": {
			void selectTwitchChatBadge(msg.data)
				.then(() => {
					reply({
						requestID: msg.data.requestID,
						ok: true,
					});
				})
				.catch((error: unknown) => {
					reply({
						requestID: msg.data.requestID,
						ok: false,
						error:
							error instanceof Error && error.message.trim() ? error.message : "Badge selection failed",
					});
				});
			break;
		}
	}

	return true;
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
	if (!shouldReloadOnUpdate) return;

	// Notify page script to reload trigger a reload immediately
	broadcastMessage("update-ready", { version: details.version });

	// Reload extension after a tiny delay to allow the downstream message to be sent
	setTimeout(() => chrome.runtime.reload(), 50);
});

function broadcastMessage(type: string, data: unknown): void {
	chrome.tabs.query({}, (tabs) => {
		tabs.forEach((tab) => {
			if (!tab.id) return;

			void chrome.tabs.sendMessage(tab.id, { type, data }).catch(() => undefined);
		});
	});
}

interface TwitchRedeemCustomRewardRequest {
	requestID: string;
	channelID: string;
	rewardID: string;
	cost: number;
	title: string;
	prompt?: string | null;
	textInput?: string | null;
	clientID: string;
	token: string;
	transactionID?: string;
}

interface TwitchBadgeSelectionRequest {
	requestID: string;
	kind: "global" | "channel" | "channel_authority";
	badgeSetID: string;
	badgeSetVersion?: string;
	channelID?: string;
	clientID: string;
	token: string;
}

interface TwitchBadgeSelectionResponse {
	data?: {
		selectGlobalBadge?: {
			user?: {
				id?: string;
			} | null;
		} | null;
		selectChannelBadge?: {
			user?: {
				id?: string;
			} | null;
		} | null;
		selectChannelAuthorityBadge?: {
			user?: {
				id?: string;
			} | null;
		} | null;
	};
	errors?: {
		message?: string;
	}[];
}

async function redeemTwitchCustomReward(input: TwitchRedeemCustomRewardRequest): Promise<void> {
	const body = JSON.stringify([
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
					transactionID: input.transactionID ?? createHexToken(16),
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

	let bearerError: unknown = null;
	if (input.token?.trim()) {
		try {
			const bearerPayload = await postTwitchRewardRedemptionRequest(body, input.clientID, input.token, false);
			if (isTwitchRewardRedemptionAccepted(bearerPayload)) {
				return;
			}

			const bearerMessage = extractTwitchRewardRedemptionError(bearerPayload);
			if (bearerMessage) {
				throw new Error(bearerMessage);
			}
		} catch (error) {
			bearerError = error;
		}
	}

	const cookiePayload = await postTwitchRewardRedemptionRequest(body, input.clientID, undefined, true).catch(
		(error) => {
			if (bearerError instanceof Error && bearerError.message.trim()) throw bearerError;
			throw error;
		},
	);
	if (isTwitchRewardRedemptionAccepted(cookiePayload)) {
		return;
	}

	const cookieMessage = extractTwitchRewardRedemptionError(cookiePayload);
	if (cookieMessage) {
		throw new Error(cookieMessage);
	}

	if (bearerError instanceof Error && bearerError.message.trim()) {
		throw bearerError;
	}

	throw new Error("Reward redemption was not accepted");
}

async function selectTwitchChatBadge(input: TwitchBadgeSelectionRequest): Promise<void> {
	const isGlobalSelection = input.kind === "global";
	const isAuthoritySelection = input.kind === "channel_authority";
	const body = JSON.stringify({
		operationName: isGlobalSelection
			? "SelectGlobalBadge"
			: isAuthoritySelection
			  ? "SelectChannelAuthorityBadge"
			  : "SelectChannelBadge",
		variables: {
			input: buildBadgeSelectionInput(input),
		},
		query: isGlobalSelection
			? "mutation SelectGlobalBadge($input: SelectGlobalBadgeInput!) { selectGlobalBadge(input: $input) { user { id } } }"
			: isAuthoritySelection
			  ? "mutation SelectChannelAuthorityBadge($input: SelectChannelAuthorityBadgeInput!) { selectChannelAuthorityBadge(input: $input) { user { id } } }"
			  : "mutation SelectChannelBadge($input: SelectChannelBadgeInput!) { selectChannelBadge(input: $input) { user { id } } }",
	});

	let bearerError: unknown = null;
	if (input.token?.trim()) {
		try {
			const bearerPayload = await postTwitchBadgeSelectionRequest(body, input.clientID, input.token, false);
			if (isBadgeSelectionAccepted(bearerPayload, input.kind)) {
				return;
			}

			const bearerMessage = extractTwitchBadgeSelectionError(bearerPayload);
			if (bearerMessage) {
				throw new Error(bearerMessage);
			}
		} catch (error) {
			bearerError = error;
		}
	}

	const cookiePayload = await postTwitchBadgeSelectionRequest(body, input.clientID, undefined, true).catch(
		(error) => {
			if (bearerError instanceof Error && bearerError.message.trim()) throw bearerError;
			throw error;
		},
	);
	if (isBadgeSelectionAccepted(cookiePayload, input.kind)) {
		return;
	}

	const cookieMessage = extractTwitchBadgeSelectionError(cookiePayload);
	if (cookieMessage) {
		throw new Error(cookieMessage);
	}

	if (bearerError instanceof Error && bearerError.message.trim()) {
		throw bearerError;
	}

	throw new Error("Badge selection was not accepted");
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
	});

	if (!response.ok) {
		throw new Error(`Reward redemption failed: ${response.status}`);
	}

	return (await response.json()) as TwitchRewardRedemptionResponse[];
}

async function postTwitchBadgeSelectionRequest(
	body: string,
	clientID: string,
	token?: string,
	includeCredentials = false,
): Promise<TwitchBadgeSelectionResponse> {
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
	});

	if (!response.ok) {
		throw new Error(`Badge selection failed: ${response.status}`);
	}

	return (await response.json()) as TwitchBadgeSelectionResponse;
}

function extractTwitchBadgeSelectionError(payload: TwitchBadgeSelectionResponse): string {
	return (payload.errors ?? [])
		.map((error) => error.message || "Unknown Twitch error")
		.filter(Boolean)
		.join("; ");
}

function isBadgeSelectionAccepted(
	payload: TwitchBadgeSelectionResponse,
	kind: TwitchBadgeSelectionRequest["kind"],
): boolean {
	if (kind === "global") {
		return !!payload.data?.selectGlobalBadge?.user?.id;
	}

	if (kind === "channel_authority") {
		return !!payload.data?.selectChannelAuthorityBadge?.user?.id;
	}

	return !!payload.data?.selectChannelBadge?.user?.id;
}

function buildBadgeSelectionInput(input: TwitchBadgeSelectionRequest): Record<string, string> {
	const badgeSelectionInput = {
		badgeSetID: input.badgeSetID.trim(),
	} as Record<string, string>;

	if (input.badgeSetVersion?.trim()) {
		badgeSelectionInput.badgeSetVersion = input.badgeSetVersion.trim();
	}

	if (input.kind !== "global" && input.channelID?.trim()) {
		badgeSelectionInput.channelID = input.channelID.trim();
	}

	return badgeSelectionInput;
}

function createHexToken(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
