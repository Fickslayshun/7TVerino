import { nextTick, reactive, toRef, watch } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { ChatMessage, ChatMessageModeration, ChatUser, LowTrustUserProperties } from "@/common/chat/ChatMessage";
import { useChatPerformance } from "./useChatPerformance";
import { useChatScroller } from "./useChatScroller";
import { ChannelContext } from "../channel/useChannelContext";
import { useConfig } from "../useSettings";

const scrollDuration = useConfig<number>("chat.smooth_scroll_duration");
const lineLimit = useConfig<number>("chat.line_limit", 150);

interface ChatMessages {
	// Message Data
	displayed: ChatMessage[];
	displayedByUser: Record<string, Record<string, ChatMessage>>;
	awaited: Map<string, (v: ChatMessage) => void>;
	buffer: ChatMessage[];

	moderated: {
		id: symbol;
		messages: ChatMessage[];
		victim: ChatUser;
		mod: ChatMessageModeration;
	}[];
	lowTrustUsers: Record<string, LowTrustUserProperties>;
	chatters: Record<string, ChatUser>;
	chattersByUsername: Record<string, ChatUser>;
	overflowLimit: number;
	flushTimeout?: number;

	twitchHandlers: Set<(v: Twitch.AnyMessage) => void>;

	// Functions
	sendMessage: (msg: string) => void;
}

const batchTimeMs = useConfig<number>("chat.message_batch_duration");

const m = new WeakMap<ChannelContext, ChatMessages>();

export function useChatMessages(ctx: ChannelContext) {
	const scroller = useChatScroller(ctx);
	const performance = useChatPerformance(ctx);

	let data = m.get(ctx)!;
	if (!data) {
		data = reactive<ChatMessages>({
			// Message Data
			displayed: [] as ChatMessage[],
			displayedByUser: {} as Record<string, Record<string, ChatMessage>>,
			awaited: new Map<string, (v: ChatMessage) => void>(),
			buffer: [] as ChatMessage[],
			lowTrustUsers: {} as Record<string, LowTrustUserProperties>,
			moderated: [] as {
				id: symbol;
				messages: ChatMessage[];
				victim: ChatUser;
				mod: ChatMessageModeration;
			}[],
			chatters: {} as Record<string, ChatUser>,
			chattersByUsername: {} as Record<string, ChatUser>,
			overflowLimit: 0,
			flushTimeout: undefined,

			twitchHandlers: new Set<(v: Twitch.AnyMessage) => void>(),

			// Functions
			sendMessage: (() => {
				return;
			}) as (msg: string) => void,
		});

		m.set(ctx, data);

		// Unbuffer paused messages
		nextTick(() => {
			watch(
				() => scroller.paused,
				(v, old) => {
					if (v && !old) return;

					// Chat Unpaused
					// Move the messages in the pause buffer to the main buffer
					const incr = Math.ceil(scroller.pauseBuffer.length / 32);
					let n = 0;
					while (scroller.pauseBuffer.length) {
						const unbuf = scroller.pauseBuffer.splice(0, 50);
						n += incr;

						useTimeoutFn(() => {
							data.displayed = data.displayed.concat(unbuf);
						}, n);
					}

					useTimeoutFn(() => {
						scroller.scrollToLive();
					}, n + incr);
				},
			);
		});

		watch(
			() => data.buffer.length + scroller.pauseBuffer.length,
			(backlog) => performance.setBacklog(backlog),
			{ immediate: true },
		);
	}

	/**
	 * Syncs chatter records and indexes a message under its author
	 */
	function indexMessageAuthor(message: ChatMessage): void {
		if (!message.author) return;

		message.author.lastMsgId = message.sym;

		const knownAuthor = data.chatters[message.author.id];
		if (knownAuthor) {
			knownAuthor.username = message.author.username;
			knownAuthor.displayName = message.author.displayName;
			knownAuthor.color = message.author.color;
			knownAuthor.intl = message.author.intl;
			message.author = knownAuthor;
		} else {
			data.chatters[message.author.id] = message.author;
		}

		if (message.author.username) {
			data.chattersByUsername[message.author.username] = message.author;
			if (!data.displayedByUser[message.author.username]) data.displayedByUser[message.author.username] = {};
			data.displayedByUser[message.author.username][message.id] = message;
		}
	}

	function unindexMessageAuthor(message: ChatMessage): void {
		if (!message.author?.username) return;

		const userMessages = data.displayedByUser[message.author.username];
		if (!userMessages) return;

		delete userMessages[message.id];
		if (Object.keys(userMessages).length > 0) return;

		delete data.displayedByUser[message.author.username];
		delete data.chattersByUsername[message.author.username];
		if (message.author.id) {
			delete data.chatters[message.author.id];
		}
	}

	/**
	 * Add a message to the chat
	 *
	 * It will be first added to a buffer, queued for rendering
	 * and will render in batch with other buffered messages
	 *
	 * @param message the message to queue up
	 */
	function add<T extends ChatMessage>(message: T, now?: boolean): void {
		const effectiveLineLimit = getEffectiveLineLimit();

		if (scroller.paused) {
			// if scrolling is paused, buffer the message
			scroller.pauseBuffer.push(message);
			const pauseBufferCap = scroller.pauseBufferCap ?? effectiveLineLimit;
			if (scroller.pauseBuffer.length > pauseBufferCap) scroller.pauseBuffer.shift();

			return;
		}

		// check user/message author data
		indexMessageAuthor(message);

		// push message to buffer, and trigger flush
		data.buffer.push(message);

		if (data.awaited.has(message.id)) {
			data.awaited.get(message.id)!(message);
			data.awaited.delete(message.id);
		}

		flush(now);
	}

	/**
	 * Clears the chat messages
	 */
	function clear() {
		if (data.flushTimeout) {
			window.clearTimeout(data.flushTimeout);
			data.flushTimeout = undefined;
		}

		data.displayed.length = 0;
		data.buffer.length = 0;
		data.moderated.length = 0;
		data.displayedByUser = {};
		data.lowTrustUsers = {};
		data.chatters = {};
		data.chattersByUsername = {};
		scroller.pauseBuffer.length = 0;
	}

	/**
	 * Replace an existing message entry while preserving ordering in all live buffers
	 */
	function replace(prevMessage: ChatMessage, nextMessage: ChatMessage): boolean {
		let replaced = false;

		const lists = [data.displayed, data.buffer, scroller.pauseBuffer];
		for (const list of lists) {
			const index = list.indexOf(prevMessage);
			if (index < 0) continue;

			list.splice(index, 1, nextMessage);
			replaced = true;
		}

		if (!replaced) return false;

		unindexMessageAuthor(prevMessage);
		indexMessageAuthor(nextMessage);
		return true;
	}

	/**
	 * Flushes the message buffer, pushing messages to the render queue
	 * and removing rendered messages that have gone out of the live buffer's bounds
	 */
	function flush(force?: boolean): void {
		if (data.flushTimeout) return;

		data.flushTimeout = window.setTimeout(
			() => {
				if (scroller.paused) {
					data.flushTimeout = undefined;
					return;
				}

				if (scroller.init == true) scroller.init = false;

				// push new messages
				if (data.buffer.length > 0) {
					const unbuf = data.buffer.splice(0, data.buffer.length);

					// push to the render queue all unbuffered messages
					data.displayed.push(...unbuf);
				}

				// scroll to the bottom on the next tick
				nextTick(() => scroller.scrollToLive(performance.smoothScrollEnabled.value ? scrollDuration.value : 0));

				// remove messages beyond the buffer
				const effectiveLineLimit = getEffectiveLineLimit();
				const overflowLimit = effectiveLineLimit * 1.25;
				if (data.displayed.length > overflowLimit) {
					data.flushTimeout = window.setTimeout(
						() => {
							const removed = data.displayed.splice(0, data.displayed.length - effectiveLineLimit);
							for (const msg of removed) {
								if (!msg.author) continue;
								unindexMessageAuthor(msg);
							}

							data.flushTimeout = undefined;
						},
						getFlushDelay(force) / 1.5,
					);
				} else {
					data.flushTimeout = undefined;
				}
			},
			getFlushDelay(force) / 2,
		);
	}

	function getEffectiveLineLimit(): number {
		const cap = performance.effectiveLineLimitCap.value;
		return cap ? Math.min(lineLimit.value, cap) : lineLimit.value;
	}

	function getFlushDelay(force?: boolean): number {
		if (force) return 5;
		return Math.max(batchTimeMs.value, performance.effectiveBatchDurationMin.value);
	}

	/**
	 * Finds a message that matches the predicate
	 *
	 * @param predicate predicate function
	 * @param all if true, returns all messages that match the predicate
	 * @returns message that matches the predicate
	 * @returns list of messages that match the predicate
	 * @returns null if no message matches the predicate
	 */
	function find<A extends boolean = false>(predicate: (msg: ChatMessage) => boolean, all?: A) {
		const result = [] as ChatMessage[];
		for (const list of [data.buffer, scroller.pauseBuffer, data.displayed]) {
			for (let i = list.length - 1; i >= 0; i--) {
				const msg = list[i];
				if (!msg) continue;

				if (predicate(msg)) {
					result.push(msg);
					if (!all) return result[0] as A extends true ? ChatMessage[] : ChatMessage | null;
				}
			}
		}

		return (all ? result : result[0] ?? null) as A extends true ? ChatMessage[] : ChatMessage | null;
	}

	/**
	 * Returns a list of messages by the specified user
	 *
	 * @param userLogin user's login name
	 * @returns list of messages by the user
	 */
	function messagesByUser(userLogin: string): ChatMessage[] {
		const umap = data.displayedByUser[userLogin];
		if (!umap) return [];

		return Object.values(umap);
	}

	/**
	 *
	 * @param id the ID of the message to wait for
	 * @param timeout the maximum amount of time we will wait
	 * @returns
	 */
	async function awaitMessage(id: string, timeout = 1e4): Promise<ChatMessage> {
		return new Promise((resolve, reject) => {
			// Check displayed and buffer if message has already been pushed.
			const displayedMessage = data.displayed.find((msg) => {
				return msg.id === id;
			});
			if (displayedMessage) return resolve(displayedMessage);

			const bufferMessage = data.buffer.find((msg) => {
				return msg.id === id;
			});
			if (bufferMessage) return resolve(bufferMessage);

			const { stop } = useTimeoutFn(() => {
				data.awaited.delete(id);
				reject(Error("Timed out waiting for message"));
			}, timeout);

			data.awaited.set(id, (msg) => {
				resolve(msg);
				stop();
			});
		});
	}

	function reload() {
		data.displayed.forEach((msg) => msg.refresh());
	}

	return reactive({
		displayed: toRef(data, "displayed"),
		handlers: data.twitchHandlers,
		chatters: toRef(data, "chatters"),
		chattersByUsername: toRef(data, "chattersByUsername"),
		lowTrustUsers: toRef(data, "lowTrustUsers"),
		moderated: toRef(data, "moderated"),
		sendMessage: toRef(data, "sendMessage"),
		find,
		messagesByUser,
		awaitMessage,
		add,
		replace,
		clear,
		reload,
	});
}
