import { TypedEventListenerOrEventListenerObject } from "@/common/EventTarget";
import { useWorker } from "@/composable/useWorker";
import type { TypedWorkerMessage } from "@/worker";

type TVerinoEventName =
	| "tverino_chat_message"
	| "tverino_chat_roomstate"
	| "tverino_chat_send_result"
	| "tverino_chat_status";

type TVerinoEventPayload<T extends TVerinoEventName> = {
	tverino_chat_message: TypedWorkerMessage<"TVERINO_CHAT_MESSAGE">;
	tverino_chat_roomstate: TypedWorkerMessage<"TVERINO_CHAT_ROOMSTATE">;
	tverino_chat_send_result: TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">;
	tverino_chat_status: TypedWorkerMessage<"TVERINO_CHAT_STATUS">;
}[T];

const subscriptions = new Map<string, CurrentChannel>();

let status: SevenTV.TVerinoTransportStatus = {
	state: "idle",
	reason: "",
};

class TVerinoTarget extends EventTarget {
	addEventListener<T extends TVerinoEventName>(
		type: T,
		listener: TypedEventListenerOrEventListenerObject<CustomEvent<TVerinoEventPayload<T>>> | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
	}

	removeEventListener<T extends TVerinoEventName>(
		type: T,
		listener: TypedEventListenerOrEventListenerObject<CustomEvent<TVerinoEventPayload<T>>> | null,
		options?: boolean | EventListenerOptions,
	): void {
		super.removeEventListener(type, listener as EventListenerOrEventListenerObject, options);
	}

	emit<T extends TVerinoEventName>(type: T, detail: TVerinoEventPayload<T>): void {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
}

const target = new TVerinoTarget();
const worker = useWorker();

worker.target.addEventListener("tverino_chat_message", (ev) => {
	target.emit("tverino_chat_message", ev.detail);
});

worker.target.addEventListener("tverino_chat_roomstate", (ev) => {
	target.emit("tverino_chat_roomstate", ev.detail);
});

worker.target.addEventListener("tverino_chat_send_result", (ev) => {
	target.emit("tverino_chat_send_result", ev.detail);
});

worker.target.addEventListener("tverino_chat_status", (ev) => {
	status = ev.detail;
	target.emit("tverino_chat_status", ev.detail);
});

export function useTVerinoChatTransport() {
	return {
		target,
		subscribeChannel,
		unsubscribeChannel,
		sendChatMessage,
		emitLocalMessage,
		getStatus: () => status,
	};
}

function subscribeChannel(channel: CurrentChannel): void {
	if (!channel.id || !channel.username) return;

	const normalized = {
		...channel,
		username: channel.username.toLowerCase(),
	};

	subscriptions.set(channel.id, normalized);
	worker.sendMessage("TVERINO_CHAT_SUBSCRIBE", {
		channel: normalized,
	});
}

function unsubscribeChannel(channelID: string): void {
	if (!subscriptions.has(channelID)) return;

	subscriptions.delete(channelID);
	worker.sendMessage("TVERINO_CHAT_UNSUBSCRIBE", {
		channelID,
	});
}

function sendChatMessage(
	channelID: string,
	channelLogin: string,
	message: string,
	nonce: string,
	reply?: NonNullable<Twitch.DisplayableMessage["reply"]>,
): void {
	const normalizedLogin = channelLogin.trim().toLowerCase();
	const normalizedMessage = message.trim();

	if (!normalizedLogin || !normalizedMessage) {
		target.emit("tverino_chat_send_result", {
			channelID,
			nonce,
			ok: false,
			error: "Message is empty",
		});
		return;
	}

	target.emit("tverino_chat_send_result", {
		channelID,
		nonce,
		ok: true,
	});

	worker.sendMessage("TVERINO_CHAT_SEND", {
		channelID,
		channelLogin: normalizedLogin,
		message: normalizedMessage,
		nonce,
		reply,
	});
}

function emitLocalMessage(channelID: string, message: Twitch.ChatMessage): void {
	target.emit("tverino_chat_message", {
		channelID,
		message,
	});
}
