import type { LogType } from "@/common/Logger";
import type { NormalizedChatMessage, NormalizedChatMessageInput } from "@/common/chat/PerformanceProcessor";
import type { Dexie7 } from "@/db/idb";
import { WorkerDriver } from "./worker.driver";
import type { EventAPI } from "./worker.events";

export interface WorkerMessage<T extends WorkerMessageType> {
	type: WorkerMessageType;
	data: TypedWorkerMessage<T>;
}

export enum workerMessageType {
	CHANNEL_ACTIVE_CHATTER,
	IDENTITY_FETCHED,
	CHANNEL_FETCHED,
	CHANNEL_SETS_FETCHED,
	CONFIG,
	CLOSE,
	EMOTE_SET_UPDATED,
	USER_UPDATED,
	COSMETIC_CREATED,
	ENTITLEMENT_CREATED,
	ENTITLEMENT_DELETED,
	INIT,
	LOG,
	STATE,
	STATIC_COSMETICS_FETCHED,
	SYNC_TWITCH_SET,
	REQUEST_USER_COSMETICS,
	PROCESS_CHAT_MESSAGE,
	PROCESS_CHAT_MESSAGE_RESULT,
	TVERINO_CHAT_AUTH,
	TVERINO_CHAT_SUBSCRIBE,
	TVERINO_CHAT_UNSUBSCRIBE,
	TVERINO_CHAT_SEND,
	TVERINO_CHAT_MESSAGE,
	TVERINO_CHAT_ROOMSTATE,
	TVERINO_CHAT_SEND_RESULT,
	TVERINO_CHAT_STATUS,
	TVERINO_BADGE_SETS_FETCH,
	TVERINO_BADGE_SETS_RESULT,
	TVERINO_CUSTOM_REWARD_REDEEM,
	TVERINO_CUSTOM_REWARD_REDEEM_RESULT,
}

export type WorkerMessageType = keyof typeof workerMessageType;

export type TypedWorkerMessage<T extends WorkerMessageType> = {
	CHANNEL_ACTIVE_CHATTER: {
		channel: CurrentChannel;
	};
	IDENTITY_FETCHED: {
		user: SevenTV.User | null;
	};
	CHANNEL_FETCHED: {
		channel: CurrentChannel;
	};
	CHANNEL_SETS_FETCHED: {
		channel: CurrentChannel;
	};
	CONFIG: SevenTV.Config;
	CLOSE: object;
	EMOTE_SET_UPDATED: {
		id: SevenTV.ObjectID;
		emotes_added: SevenTV.ActiveEmote[];
		emotes_updated: [SevenTV.ActiveEmote, SevenTV.ActiveEmote][];
		emotes_removed: SevenTV.ActiveEmote[];
		user: SevenTV.User;
	};
	USER_UPDATED: {
		id: SevenTV.ObjectID;
		actor: SevenTV.User;
		emote_set?: {
			connection_index: number;
			old_set: SevenTV.EmoteSet;
			new_set: SevenTV.EmoteSet;
		};
	};
	COSMETIC_CREATED: SevenTV.Cosmetic<"BADGE" | "PAINT" | "AVATAR">;
	ENTITLEMENT_CREATED: Pick<SevenTV.Entitlement, "id" | "kind" | "ref_id" | "user_id" | "platform_id">;
	ENTITLEMENT_DELETED: Pick<SevenTV.Entitlement, "id" | "kind" | "ref_id" | "user_id" | "platform_id">;
	INIT: object;
	LOG: {
		type: LogType;
		text: string[];
		css: string[];
		objects: object[];
	};
	STATE: Partial<{
		platform: Platform;
		providers: SevenTV.Provider[];
		provider_extensions: SevenTV.Provider[];
		identity: TwitchIdentity | YouTubeIdentity | null;
		user: SevenTV.User | null;
		channel: CurrentChannel | null;
		imageFormat: SevenTV.ImageFormat | null;
		refetch: boolean | null;
	}>;
	STATIC_COSMETICS_FETCHED: {
		badges: SevenTV.Cosmetic<"BADGE">[];
		paints: SevenTV.Cosmetic<"PAINT">[];
	};
	SYNC_TWITCH_SET: Either<{ input: Twitch.TwitchEmoteSet }, { out: SevenTV.EmoteSet }>;
	REQUEST_USER_COSMETICS: {
		identifiers: ["id" | "username", string][];
		kinds: SevenTV.CosmeticKind[];
	};
	PROCESS_CHAT_MESSAGE: {
		requestID: string;
		message: NormalizedChatMessageInput;
	};
	PROCESS_CHAT_MESSAGE_RESULT: {
		requestID: string;
		messageID: string;
		result: NormalizedChatMessage | null;
		error?: string;
	};
	TVERINO_CHAT_AUTH: {
		login: string;
		userID: string;
		token: string;
	};
	TVERINO_CHAT_SUBSCRIBE: {
		channel: CurrentChannel;
	};
	TVERINO_CHAT_UNSUBSCRIBE: {
		channelID: string;
	};
	TVERINO_CHAT_SEND: {
		channelID: string;
		channelLogin: string;
		message: string;
		nonce: string;
		reply?: NonNullable<Twitch.DisplayableMessage["reply"]>;
	};
	TVERINO_CHAT_MESSAGE: {
		channelID: string;
		message: Twitch.AnyMessage;
	};
	TVERINO_CHAT_ROOMSTATE: {
		channelID: string;
		roomState: SevenTV.TVerinoRoomState;
	};
	TVERINO_CHAT_SEND_RESULT: {
		channelID: string;
		nonce: string;
		ok: boolean;
		error?: string;
		messageID?: string;
		badges?: Record<string, string>;
		badgeDynamicData?: Record<string, string>;
		user?: Twitch.ChatUser;
	};
	TVERINO_CHAT_STATUS: SevenTV.TVerinoTransportStatus;
	TVERINO_BADGE_SETS_FETCH: {
		requestID: string;
		channelID: string;
		clientID: string;
		token: string;
	};
	TVERINO_BADGE_SETS_RESULT: {
		requestID: string;
		channelID: string;
		badgeSets: Twitch.BadgeSets | null;
		error?: string;
	};
	TVERINO_CUSTOM_REWARD_REDEEM: {
		requestID: string;
		channelID: string;
		rewardID: string;
		cost: number;
		title: string;
		prompt?: string | null;
		clientID: string;
		token: string;
		transactionID?: string;
	};
	TVERINO_CUSTOM_REWARD_REDEEM_RESULT: {
		requestID: string;
		channelID: string;
		rewardID: string;
		ok: boolean;
		error?: string;
	};
}[T];

export interface EventAPIMessage<O extends keyof typeof EventAPIOpCode> {
	op: O;
	data: EventAPIMessageData<O>;
}
export interface EventContext {
	driver: WorkerDriver;
	eventAPI: EventAPI;
	db: Dexie7;
	channelID?: string;
}

export enum EventAPIOpCode {
	DISPATCH = 0,
	HELLO = 1,
	HEARTBEAT = 2,
	RECONNECT = 4,
	ACK = 5,
	ERROR = 6,
	ENDOFSTREAM = 7,
	IDENTIFY = 33,
	RESUME = 34,
	SUBSCRIBE = 35,
	UNSUBSCRIBE = 36,

	UNKNOWN = 1001,
}

export type EventAPIMessageData<O extends keyof typeof EventAPIOpCode> = {
	DISPATCH: {
		type: string;
		matches: number[];
		body: ChangeMap<SevenTV.ObjectKind>;
	};
	HELLO: {
		session_id: string;
		heartbeat_interval: number;
	};
	HEARTBEAT: {
		count: number;
	};
	RECONNECT: void;
	ACK: {
		id: number;
		command: string;
		data: unknown;
	};
	ERROR: {
		code: number;
		message: string;
	};
	ENDOFSTREAM: {
		code: number;
		message: string;
	};
	IDENTIFY: void;
	RESUME: {
		session_id: string;
	};
	SUBSCRIBE: {
		type: string;
		condition: Record<string, string>;
	};
	UNSUBSCRIBE: {
		type: string;
		condition: Record<string, string>;
	};
	BRIDGE: {
		command: string;
		body: object;
	};
	UNKNOWN: unknown;
}[O];

export interface ChangeMap<K extends SevenTV.ObjectKind> {
	id: string;
	kind: SevenTV.ObjectKind;
	contextual?: boolean;
	actor: SevenTV.User;
	added: ChangeField[];
	updated: ChangeField[];
	removed: ChangeField[];
	pushed: ChangeField[];
	pulled: ChangeField[];
	object: ObjectTypeOfKind[K];
}

export type ObjectType = SevenTV.User | SevenTV.Emote | SevenTV.EmoteSet;

export type ObjectTypeOfKind = {
	[SevenTV.ObjectKind.USER]: SevenTV.User;
	[SevenTV.ObjectKind.EMOTE]: SevenTV.Emote;
	[SevenTV.ObjectKind.EMOTE_SET]: SevenTV.EmoteSet;
	[SevenTV.ObjectKind.ROLE]: unknown;
	[SevenTV.ObjectKind.ENTITLEMENT]: SevenTV.Entitlement;
	[SevenTV.ObjectKind.BAN]: unknown;
	[SevenTV.ObjectKind.MESSAGE]: unknown;
	[SevenTV.ObjectKind.REPORT]: unknown;
	[SevenTV.ObjectKind.PRESENCE]: unknown;
	[SevenTV.ObjectKind.COSMETIC]: SevenTV.Cosmetic;
};

export interface ChangeField {
	key: string;
	index: number | null;
	nested?: boolean;
	type: string;
	old_value?: unknown;
	value: unknown;
}

export interface SubscriptionData {
	id?: number;
	type: string;
	condition: Record<string, string>;
}
