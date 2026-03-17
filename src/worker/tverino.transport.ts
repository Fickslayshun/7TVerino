import { MessagePartType, MessageType, ModerationType } from "@/site/twitch.tv";
import type { WorkerDriver } from "./worker.driver";
import type { WorkerPort } from "./worker.port";
import type { TypedWorkerMessage } from ".";

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const CAPABILITIES = ["twitch.tv/tags", "twitch.tv/commands", "twitch.tv/membership"];
const PENDING_SEND_TTL_MS = 15000;
const RECONNECT_DELAY_MS = 2000;

interface ParsedIRCMessage {
	tags: Record<string, string>;
	prefix: string;
	command: string;
	params: string[];
	trailing: string;
}

interface PendingSend {
	channelID: string;
	message: string;
	nonce: string;
	createdAt: number;
	privmsgPatched?: boolean;
	statePatched?: boolean;
}

interface SubscriptionEntry {
	channel: CurrentChannel;
	ports: Set<symbol>;
}

interface AuthState {
	login: string;
	userID: string;
	token: string;
}

interface SelfState {
	badges: Record<string, string>;
	badgeDynamicData: Record<string, string>;
	user: Twitch.ChatUser;
}

export class TVerinoChatTransport {
	private socket: WebSocket | null = null;
	private reconnectTimer: number | null = null;
	private auth: AuthState | null = null;
	private subscriptions = new Map<string, SubscriptionEntry>();
	private joinedChannels = new Set<string>();
	private pendingSends: PendingSend[] = [];
	private selfStates = new Map<string, SelfState>();
	private status: SevenTV.TVerinoTransportStatus = {
		state: "idle",
		reason: "",
	};

	constructor(private driver: WorkerDriver) {
		driver.addEventListener("tverino_chat_auth", (ev) => {
			if (!ev.port) return;
			this.setAuth(ev.detail);
		});

		driver.addEventListener("tverino_chat_subscribe", (ev) => {
			if (!ev.port) return;
			this.subscribe(ev.detail.channel, ev.port);
		});

		driver.addEventListener("tverino_chat_unsubscribe", (ev) => {
			if (!ev.port) return;
			this.unsubscribe(ev.detail.channelID, ev.port);
		});

		driver.addEventListener("tverino_chat_send", (ev) => {
			if (!ev.port) return;
			this.sendMessage(
				ev.detail.channelID,
				ev.detail.channelLogin,
				ev.detail.message,
				ev.detail.nonce,
				ev.port,
				ev.detail.reply,
			);
		});
	}

	private setAuth(nextAuth: AuthState): void {
		const normalizedAuth = {
			login: nextAuth.login?.trim().toLowerCase() ?? "",
			userID: nextAuth.userID?.trim() ?? "",
			token: normalizeAuthToken(nextAuth.token),
		};

		if (!normalizedAuth.login || !normalizedAuth.token || !normalizedAuth.userID) {
			this.auth = null;
			this.disconnect("Missing Twitch auth");
			return;
		}

		const changed =
			!this.auth ||
			this.auth.login !== normalizedAuth.login ||
			this.auth.userID !== normalizedAuth.userID ||
			this.auth.token !== normalizedAuth.token;

		this.auth = normalizedAuth;
		if (changed) {
			this.disconnect("");
		}

		this.ensureConnected();
	}

	private subscribe(channel: CurrentChannel, port: WorkerPort): void {
		if (!channel.id || !channel.username) return;

		let entry = this.subscriptions.get(channel.id);
		if (!entry) {
			entry = {
				channel: {
					...channel,
					username: channel.username.toLowerCase(),
				},
				ports: new Set(),
			};
			this.subscriptions.set(channel.id, entry);
		}

		entry.channel = {
			...entry.channel,
			...channel,
			username: channel.username.toLowerCase(),
		};
		entry.ports.add(port.id);
		port.tverinoChannelIDs.add(channel.id);

		this.broadcastStatus(port);
		this.ensureConnected();

		if (this.status.state === "connected") {
			this.joinChannel(entry.channel.username);
		}
	}

	private unsubscribe(channelID: string, port: WorkerPort): void {
		port.tverinoChannelIDs.delete(channelID);

		const entry = this.subscriptions.get(channelID);
		if (!entry) return;

		entry.ports.delete(port.id);
		if (entry.ports.size > 0) return;

		this.subscriptions.delete(channelID);
		this.selfStates.delete(channelID);
		if (this.status.state === "connected" && entry.channel.username) {
			this.partChannel(entry.channel.username);
		}
	}

	private ensureConnected(): void {
		if (!this.auth) {
			this.setStatus("error", "Twitch chat auth unavailable");
			return;
		}

		if (
			this.socket &&
			(this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
		) {
			return;
		}

		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.setStatus("connecting", "");

		const socket = new WebSocket(TWITCH_IRC_URL);
		this.socket = socket;

		socket.addEventListener("open", () => {
			if (!this.auth || this.socket !== socket) return;

			this.joinedChannels.clear();
			this.sendRaw(`CAP REQ :${CAPABILITIES.join(" ")}`);
			this.sendRaw(`PASS oauth:${this.auth.token}`);
			this.sendRaw(`NICK ${this.auth.login}`);
		});

		socket.addEventListener("message", (ev) => {
			if (this.socket !== socket) return;

			const raw = typeof ev.data === "string" ? ev.data : "";
			for (const line of raw.split(/\r?\n/).filter(Boolean)) {
				this.onLine(line);
			}
		});

		socket.addEventListener("close", () => {
			if (this.socket !== socket) return;

			this.socket = null;
			this.joinedChannels.clear();

			if (!this.auth) {
				this.setStatus("idle", "");
				return;
			}

			this.setStatus("error", "Twitch chat disconnected");
			this.queueReconnect();
		});

		socket.addEventListener("error", () => {
			if (this.socket !== socket) return;

			this.setStatus("error", "Unable to connect to Twitch chat");
		});
	}

	private queueReconnect(): void {
		if (this.reconnectTimer !== null || !this.auth) return;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.ensureConnected();
		}, RECONNECT_DELAY_MS);
	}

	private disconnect(reason: string): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		const socket = this.socket;
		this.socket = null;
		this.joinedChannels.clear();
		this.selfStates.clear();
		socket?.close();

		if (reason) {
			this.setStatus("error", reason);
			return;
		}

		if (!this.auth) {
			this.setStatus("idle", "");
		}
	}

	private onLine(line: string): void {
		if (line.startsWith("PING ")) {
			this.sendRaw(line.replace(/^PING/, "PONG"));
			return;
		}

		const parsed = parseIRCMessage(line);
		if (!parsed) return;

		switch (parsed.command) {
			case "001":
				this.setStatus("connected", "");
				this.joinedChannels.clear();
				for (const { channel } of this.subscriptions.values()) {
					this.joinChannel(channel.username);
				}
				break;
			case "NOTICE":
				if (/Login authentication failed/i.test(parsed.trailing)) {
					this.disconnect("Twitch chat auth failed");
				} else if (/Improperly formatted auth/i.test(parsed.trailing)) {
					this.disconnect("Twitch chat auth was rejected");
				}
				break;
			case "ROOMSTATE":
				this.onRoomState(parsed);
				break;
			case "USERSTATE":
				this.onUserState(parsed);
				break;
			case "PRIVMSG":
				this.onPrivmsg(parsed);
				break;
			case "CLEARMSG":
				this.onClearMsg(parsed);
				break;
			case "CLEARCHAT":
				this.onClearChat(parsed);
				break;
		}
	}

	private onPrivmsg(parsed: ParsedIRCMessage): void {
		const channelLogin = parsed.params[0]?.replace(/^#/, "").toLowerCase();
		const entry = this.getSubscriptionByLogin(channelLogin);
		if (!entry) return;

		this.prunePendingSends();

		const authorLogin = parsePrefixLogin(parsed.prefix);
		const messageBody = normalizeChatMessageText(parsed.trailing);
		if (!messageBody.trim()) return;
		const normalizedMessageBody = messageBody.trim();

		const matchingPending =
			authorLogin && this.auth && authorLogin === this.auth.login.toLowerCase()
				? this.pendingSends.find(
						(send) =>
							send.channelID === entry.channel.id &&
							!send.privmsgPatched &&
							send.message === normalizedMessageBody &&
							send.createdAt > Date.now() - PENDING_SEND_TTL_MS,
				  )
				: undefined;

		const isAction = isActionMessage(messageBody);
		const cleanBody = isAction ? unwrapActionMessage(messageBody) : messageBody;
		const pendingNonce = matchingPending?.nonce;
		const selfState =
			authorLogin && this.auth && authorLogin === this.auth.login.toLowerCase()
				? this.selfStates.get(entry.channel.id)
				: undefined;
		if (matchingPending) {
			matchingPending.privmsgPatched = true;
		}

		const message = {
			id: parsed.tags.id || `${entry.channel.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
			type: MessageType.MESSAGE,
			nonce: pendingNonce,
			user: {
				color: selfState?.user.color || parsed.tags.color || "",
				isIntl: false,
				isSubscriber: parsed.tags.subscriber === "1",
				userDisplayName: selfState?.user.userDisplayName || parsed.tags["display-name"] || authorLogin,
				displayName: selfState?.user.displayName || parsed.tags["display-name"] || authorLogin,
				userID: selfState?.user.userID || parsed.tags["user-id"] || "",
				userLogin: selfState?.user.userLogin || authorLogin,
				userType: selfState?.user.userType || parsed.tags["user-type"] || "",
			},
			badgeDynamicData: selfState?.badgeDynamicData ?? parseBadgeMap(parsed.tags["badge-info"]),
			badges: selfState?.badges ?? parseBadgeMap(parsed.tags.badges),
			deleted: false,
			banned: false,
			hidden: false,
			isHistorical: false,
			isFirstMsg: parsed.tags["first-msg"] === "1",
			isReturningChatter: false,
			isVip: parsed.tags.vip === "1",
			messageBody: cleanBody,
			messageParts: buildMessageParts(cleanBody, parsed.tags.emotes),
			messageType: isAction ? 1 : 0,
			timestamp: Number(parsed.tags["tmi-sent-ts"] || Date.now()),
			reply: buildReply(parsed.tags),
			channelID: entry.channel.id,
		} as Twitch.ChatMessage;

		this.postToChannel(entry.channel.id, "TVERINO_CHAT_MESSAGE", {
			channelID: entry.channel.id,
			message,
		});

		if (matchingPending) {
			this.postToChannel(entry.channel.id, "TVERINO_CHAT_SEND_RESULT", {
				channelID: entry.channel.id,
				nonce: matchingPending.nonce,
				ok: true,
				messageID: parsed.tags.id,
			});

			if (matchingPending.statePatched || selfState) {
				this.pendingSends = this.pendingSends.filter((send) => send !== matchingPending);
			}
		}
	}

	private onRoomState(parsed: ParsedIRCMessage): void {
		const channelLogin = parsed.params[0]?.replace(/^#/, "").toLowerCase();
		const entry = this.getSubscriptionByLogin(channelLogin);
		if (!entry) return;

		this.postToChannel(entry.channel.id, "TVERINO_CHAT_ROOMSTATE", {
			channelID: entry.channel.id,
			roomState: parseRoomState(parsed.tags),
		});
	}

	private onUserState(parsed: ParsedIRCMessage): void {
		const channelLogin = parsed.params[0]?.replace(/^#/, "").toLowerCase();
		const entry = this.getSubscriptionByLogin(channelLogin);
		if (!entry) return;

		const selfState = buildSelfState(parsed, this.auth);
		this.selfStates.set(entry.channel.id, selfState);

		this.prunePendingSends();

		const matchingPending = this.pendingSends.find(
			(send) => send.channelID === entry.channel.id && !send.statePatched,
		);
		if (!matchingPending) return;

		matchingPending.statePatched = true;

		this.postToChannel(entry.channel.id, "TVERINO_CHAT_SEND_RESULT", {
			channelID: entry.channel.id,
			nonce: matchingPending.nonce,
			ok: true,
			badges: selfState.badges,
			badgeDynamicData: selfState.badgeDynamicData,
			user: selfState.user,
		});

		if (matchingPending.privmsgPatched) {
			this.pendingSends = this.pendingSends.filter((send) => send !== matchingPending);
		}
	}

	private onClearMsg(parsed: ParsedIRCMessage): void {
		const channelLogin = parsed.params[0]?.replace(/^#/, "").toLowerCase();
		const entry = this.getSubscriptionByLogin(channelLogin);
		if (!entry || !parsed.tags["target-msg-id"]) return;

		const message = {
			id: `clearmsg:${parsed.tags["target-msg-id"]}`,
			type: MessageType.MODERATION,
			duration: 0,
			moderationType: ModerationType.DELETE,
			reason: "",
			targetMessageID: parsed.tags["target-msg-id"],
			userLogin: "",
		} as Twitch.ModerationMessage;

		this.postToChannel(entry.channel.id, "TVERINO_CHAT_MESSAGE", {
			channelID: entry.channel.id,
			message,
		});
	}

	private onClearChat(parsed: ParsedIRCMessage): void {
		const channelLogin = parsed.params[0]?.replace(/^#/, "").toLowerCase();
		const entry = this.getSubscriptionByLogin(channelLogin);
		if (!entry) return;

		const targetLogin = parsed.trailing?.trim().toLowerCase();
		if (!targetLogin) {
			this.postToChannel(entry.channel.id, "TVERINO_CHAT_MESSAGE", {
				channelID: entry.channel.id,
				message: {
					id: `clear:${entry.channel.id}:${Date.now()}`,
					type: MessageType.CLEAR,
				} as Twitch.AnyMessage,
			});
			return;
		}

		const duration = Number(parsed.tags["ban-duration"] || 0);
		const message = {
			id: `clearchat:${entry.channel.id}:${targetLogin}:${Date.now()}`,
			type: MessageType.MODERATION,
			duration,
			moderationType: duration > 0 ? ModerationType.TIMEOUT : ModerationType.BAN,
			reason: "",
			userLogin: targetLogin,
		} as Twitch.ModerationMessage;

		this.postToChannel(entry.channel.id, "TVERINO_CHAT_MESSAGE", {
			channelID: entry.channel.id,
			message,
		});
	}

	private sendMessage(
		channelID: string,
		channelLogin: string,
		message: string,
		nonce: string,
		port: WorkerPort,
		reply?: NonNullable<Twitch.DisplayableMessage["reply"]>,
	): void {
		if (!this.auth) {
			port.postMessage("TVERINO_CHAT_SEND_RESULT", {
				channelID,
				nonce,
				ok: false,
				error: "Twitch chat auth unavailable",
			});
			return;
		}

		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			port.postMessage("TVERINO_CHAT_SEND_RESULT", {
				channelID,
				nonce,
				ok: false,
				error: "Twitch chat is not connected",
			});
			return;
		}

		const normalizedLogin = channelLogin.toLowerCase();
		const normalizedMessage = message.trim();
		if (!normalizedLogin || !normalizedMessage) {
			port.postMessage("TVERINO_CHAT_SEND_RESULT", {
				channelID,
				nonce,
				ok: false,
				error: "Message is empty",
			});
			return;
		}

		this.pendingSends.push({
			channelID,
			message: normalizedMessage,
			nonce,
			createdAt: Date.now(),
			privmsgPatched: false,
			statePatched: false,
		});
		this.prunePendingSends();

		try {
			const line = reply?.parentMsgId
				? `@reply-parent-msg-id=${reply.parentMsgId} PRIVMSG #${normalizedLogin} :${normalizedMessage}`
				: `PRIVMSG #${normalizedLogin} :${normalizedMessage}`;
			this.sendRaw(line);
			port.postMessage("TVERINO_CHAT_SEND_RESULT", {
				channelID,
				nonce,
				ok: true,
			});
		} catch (err) {
			this.pendingSends = this.pendingSends.filter((send) => send.nonce !== nonce);
			port.postMessage("TVERINO_CHAT_SEND_RESULT", {
				channelID,
				nonce,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private prunePendingSends(): void {
		const cutoff = Date.now() - PENDING_SEND_TTL_MS;
		this.pendingSends = this.pendingSends.filter((send) => send.createdAt >= cutoff);
	}

	private sendRaw(line: string): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

		this.socket.send(line);
	}

	private joinChannel(login: string): void {
		const normalized = login.toLowerCase();
		if (!normalized || this.joinedChannels.has(normalized)) return;

		this.joinedChannels.add(normalized);
		this.sendRaw(`JOIN #${normalized}`);
	}

	private partChannel(login: string): void {
		const normalized = login.toLowerCase();
		if (!normalized || !this.joinedChannels.has(normalized)) return;

		this.joinedChannels.delete(normalized);
		this.sendRaw(`PART #${normalized}`);
	}

	private getSubscriptionByLogin(login: string): SubscriptionEntry | null {
		if (!login) return null;

		for (const entry of this.subscriptions.values()) {
			if (entry.channel.username.toLowerCase() === login) {
				return entry;
			}
		}

		return null;
	}

	private setStatus(state: SevenTV.TVerinoTransportStatus["state"], reason: string): void {
		if (this.status.state === state && this.status.reason === reason) return;

		this.status = { state, reason };
		this.broadcastStatus();
	}

	private broadcastStatus(port?: WorkerPort): void {
		if (port) {
			port.postMessage("TVERINO_CHAT_STATUS", this.status);
			return;
		}

		for (const target of this.driver.ports.values()) {
			target.postMessage("TVERINO_CHAT_STATUS", this.status);
		}
	}

	private postToChannel<T extends "TVERINO_CHAT_MESSAGE" | "TVERINO_CHAT_ROOMSTATE" | "TVERINO_CHAT_SEND_RESULT">(
		channelID: string,
		type: T,
		data: T extends "TVERINO_CHAT_MESSAGE"
			? TypedWorkerMessage<"TVERINO_CHAT_MESSAGE">
			: T extends "TVERINO_CHAT_ROOMSTATE"
			  ? TypedWorkerMessage<"TVERINO_CHAT_ROOMSTATE">
			  : TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">,
	): void {
		const entry = this.subscriptions.get(channelID);
		if (!entry) return;

		for (const portID of entry.ports) {
			const port = this.driver.ports.get(portID);
			if (!port) continue;

			port.postMessage(type, data as never);
		}
	}
}

function parseIRCMessage(line: string): ParsedIRCMessage | null {
	let rest = line.trim();
	const tags = {} as Record<string, string>;
	let prefix = "";
	let trailing = "";

	if (!rest) return null;

	if (rest.startsWith("@")) {
		const index = rest.indexOf(" ");
		if (index === -1) return null;

		const rawTags = rest.slice(1, index);
		rest = rest.slice(index + 1);

		for (const tag of rawTags.split(";")) {
			const [key, value = ""] = tag.split("=", 2);
			tags[key] = unescapeTagValue(value);
		}
	}

	if (rest.startsWith(":")) {
		const index = rest.indexOf(" ");
		if (index === -1) return null;

		prefix = rest.slice(1, index);
		rest = rest.slice(index + 1);
	}

	const trailingIndex = rest.indexOf(" :");
	if (trailingIndex >= 0) {
		trailing = rest.slice(trailingIndex + 2);
		rest = rest.slice(0, trailingIndex);
	}

	const parts = rest.split(" ").filter(Boolean);
	const command = parts.shift();
	if (!command) return null;

	return {
		tags,
		prefix,
		command,
		params: parts,
		trailing,
	};
}

function unescapeTagValue(value: string): string {
	return value
		.replace(/\\s/g, " ")
		.replace(/\\:/g, ";")
		.replace(/\\\\/g, "\\")
		.replace(/\\r/g, "\r")
		.replace(/\\n/g, "\n");
}

function parsePrefixLogin(prefix: string): string {
	return prefix.split("!", 2)[0]?.toLowerCase() ?? "";
}

function normalizeChatMessageText(value: string): string {
	return value.replace(/\r/g, "");
}

function isActionMessage(value: string): boolean {
	return value.startsWith("\u0001ACTION ") && value.endsWith("\u0001");
}

function unwrapActionMessage(value: string): string {
	if (!isActionMessage(value)) return value;

	return value.slice(8, -1);
}

function normalizeAuthToken(value: string): string {
	return value.trim().replace(/^oauth:/i, "");
}

function buildSelfState(parsed: ParsedIRCMessage, auth: AuthState | null): SelfState {
	const login = auth?.login || "";
	const displayName = parsed.tags["display-name"] || login;

	return {
		badges: parseBadgeMap(parsed.tags.badges),
		badgeDynamicData: parseBadgeMap(parsed.tags["badge-info"]),
		user: {
			color: parsed.tags.color || "",
			isIntl: false,
			isSubscriber: parsed.tags.subscriber === "1",
			userDisplayName: displayName,
			displayName,
			userID: parsed.tags["user-id"] || auth?.userID || "",
			userLogin: login,
			userType: parsed.tags["user-type"] || "",
		},
	};
}

function parseBadgeMap(raw: string | undefined): Record<string, string> {
	const badges = {} as Record<string, string>;
	if (!raw) return badges;

	for (const badge of raw.split(",")) {
		const [key, value] = badge.split("/", 2);
		if (!key || !value) continue;
		badges[key] = value;
	}

	return badges;
}

function parseRoomState(tags: Record<string, string>): SevenTV.TVerinoRoomState {
	const emoteOnly = tags["emote-only"] === "1";
	const subscribersOnly = tags["subs-only"] === "1";
	const uniqueChatEnabled = tags["r9k"] === "1";
	const slowModeDuration = Math.max(0, Number(tags.slow || 0));
	const followersOnlyDuration = Number(tags["followers-only"] ?? -1);

	return {
		loaded: true,
		emoteOnly,
		subscribersOnly,
		followersOnlyEnabled: Number.isFinite(followersOnlyDuration) && followersOnlyDuration >= 0,
		followersOnlyDuration: Number.isFinite(followersOnlyDuration) ? followersOnlyDuration : -1,
		slowModeEnabled: slowModeDuration > 0,
		slowModeDuration,
		uniqueChatEnabled,
	};
}

function buildReply(tags: Record<string, string>): Twitch.ChatMessage["reply"] | undefined {
	if (!tags["reply-parent-msg-id"] || !tags["reply-parent-user-login"]) return;

	return {
		parentDeleted: tags["reply-parent-deleted"] === "1",
		parentMsgId: tags["reply-parent-msg-id"],
		parentMessageBody: tags["reply-parent-msg-body"] ?? "",
		parentUid: tags["reply-parent-user-id"] ?? "",
		parentUserLogin: tags["reply-parent-user-login"],
		parentDisplayName: tags["reply-parent-display-name"] ?? tags["reply-parent-user-login"],
	};
}

function buildMessageParts(body: string, rawEmotes: string | undefined): Twitch.ChatMessage.Part[] {
	if (!body) return [];
	if (!rawEmotes) {
		return [
			{
				type: MessagePartType.TEXT,
				content: body,
			},
		];
	}

	const ranges = rawEmotes
		.split("/")
		.flatMap((entry) => {
			const [emoteID, positions = ""] = entry.split(":", 2);
			return positions.split(",").map((range) => {
				const [startRaw, endRaw] = range.split("-", 2);
				const start = Number(startRaw);
				const end = Number(endRaw);
				return {
					emoteID,
					start,
					end,
				};
			});
		})
		.filter((range) => range.emoteID && Number.isFinite(range.start) && Number.isFinite(range.end))
		.sort((a, b) => a.start - b.start);

	if (!ranges.length) {
		return [
			{
				type: MessagePartType.TEXT,
				content: body,
			},
		];
	}

	const parts = [] as Twitch.ChatMessage.Part[];
	let cursor = 0;

	for (const range of ranges) {
		if (cursor < range.start) {
			parts.push({
				type: MessagePartType.TEXT,
				content: body.slice(cursor, range.start),
			});
		}

		const alt = body.slice(range.start, range.end + 1);
		parts.push({
			type: MessagePartType.EMOTE,
			content: {
				alt,
				emoteID: range.emoteID,
			},
		} as Twitch.ChatMessage.EmotePart);
		cursor = range.end + 1;
	}

	if (cursor < body.length) {
		parts.push({
			type: MessagePartType.TEXT,
			content: body.slice(cursor),
		});
	}

	return parts;
}
