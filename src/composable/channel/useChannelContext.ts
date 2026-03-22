import { inject, onMounted, onUnmounted, provide, reactive, toRaw, watch } from "vue";
import { useStore } from "@/store/main";
import { useWorker } from "../useWorker";

export const CHANNEL_CTX = Symbol("seventv-channel-context");

const { sendMessage, target } = useWorker();

export type ChannelRole = "BROADCASTER" | "EDITOR" | "MODERATOR" | "VIP" | "SUBSCRIBER" | "FOLLOWER";

export class ChannelContext implements CurrentChannel {
	platform: Platform = "UNKNOWN";
	id = "";
	username = "";
	displayName = "";
	registered = true;
	remote = false;
	user?: SevenTV.User;
	loaded = false;
	setsFetched = false;
	active = false;
	count = 0;

	actor = {
		roles: new Set<ChannelRole>(),
	};

	roomState: SevenTV.TVerinoRoomState = {
		loaded: false,
		emoteOnly: false,
		subscribersOnly: false,
		followersOnlyEnabled: false,
		followersOnlyDuration: -1,
		slowModeEnabled: false,
		slowModeDuration: 0,
		uniqueChatEnabled: false,
	};

	get base(): CurrentChannel {
		return {
			id: this.id,
			username: this.username,
			displayName: this.displayName,
			active: this.active,
		};
	}

	setCurrentChannel(channel: CurrentChannel): boolean {
		// Notify the worker about this new channel we are on
		if (this.id === channel.id) {
			const usernameChanged = !!channel.username && channel.username !== this.username;
			const displayNameChanged = !!channel.displayName && channel.displayName !== this.displayName;

			this.username = channel.username;
			this.displayName = channel.displayName;
			this.active = channel.active;

			if (channel.active && (usernameChanged || displayNameChanged || !this.loaded || !this.setsFetched)) {
				void this.fetch(true);
			}

			return false;
		}

		const oldID = this.id;

		this.id = channel.id;
		this.username = channel.username;
		this.displayName = channel.displayName;
		this.active = channel.active;
		this.loaded = false;
		this.setsFetched = false;
		this.user = undefined;

		if (oldID && m.get(oldID) === this) {
			m.delete(oldID);
		}
		if (this.registered) {
			m.set(channel.id, this);
		}

		void this.fetch();
		return true;
	}

	leave(): void {
		this.active = false;

		sendMessage("STATE", {
			channel: toRaw(this.base),
		});
	}

	async fetch(refetch = false) {
		if (!this.id) return;
		const state = fetchState.get(this) ?? { promise: null as Promise<void> | null, id: "" };
		if (state.promise && state.id === this.id) {
			return state.promise;
		}

		state.id = this.id;

		const request = Promise.all([
			target.listenUntil("channel_fetched", (ev) => {
				if (this.id !== ev.detail.id) return false;

				this.loaded = true;
				this.user = ev.detail.user;

				return true;
			}),
			target.listenUntil("channel_sets_fetched", (ev) => {
				if (this.id !== ev.detail.id) return false;

				this.setsFetched = true;
				return true;
			}),
		])
			.then(() => void 0)
			.finally(() => {
				const nextState = fetchState.get(this);
				if (nextState?.promise === request) {
					nextState.promise = null;
				}
				fetchState.set(this, nextState ?? state);
			});

		state.promise = request;
		fetchState.set(this, state);

		sendMessage("STATE", {
			channel: toRaw(this.base),
			refetch: refetch,
		});

		await request;
	}
}

const m = new Map<string, ChannelContext>();
const initialized = new WeakSet<ChannelContext>();
const fetchState = new WeakMap<ChannelContext, { promise: Promise<void> | null; id: string }>();

function initializeChannelContext(ctx: ChannelContext): ChannelContext {
	if (initialized.has(ctx)) return ctx;

	const store = useStore();
	watch(
		() => store.platform,
		() => {
			ctx.platform = store.platform;
		},
		{ immediate: true },
	);

	initialized.add(ctx);
	return ctx;
}

export function createChannelContext(channel?: CurrentChannel, options?: { register?: boolean }): ChannelContext {
	const ctx = reactive<ChannelContext>(new ChannelContext());
	ctx.registered = options?.register ?? true;

	const initializedCtx = initializeChannelContext(ctx);
	if (channel) {
		initializedCtx.setCurrentChannel(channel);
	}

	return initializedCtx;
}

export function resolveChannelContext(channelID?: string): ChannelContext {
	const ctx = initializeChannelContext((channelID ? m.get(channelID) : null) ?? createChannelContext());
	ctx.registered = true;

	if (channelID) {
		if (ctx.id !== channelID) ctx.setCurrentChannel({ id: channelID, username: "", displayName: "", active: true });
		m.set(channelID, ctx);
	}

	return ctx;
}

/**
 * @param channelID the ID of the current channel to use for the context
 * @param track if true, the mount state of the component will control the channel's activeness
 */
export function useChannelContext(channelID?: string, track = false): ChannelContext {
	let ctx = inject<ChannelContext | null>(CHANNEL_CTX, null);
	if (!ctx) {
		ctx = resolveChannelContext(channelID);
		provide(CHANNEL_CTX, ctx);
	}

	if (track) {
		onMounted(() => {
			if (!ctx) return;

			ctx.count++;
		});

		onUnmounted(() => {
			if (!ctx || !ctx.count) return;

			ctx.count--;
			if (ctx.count > 0) return;

			ctx.leave();
		});
	}

	return ctx;
}
