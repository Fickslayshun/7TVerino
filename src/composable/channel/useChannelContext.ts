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
			this.username = channel.username;
			this.displayName = channel.displayName;
			this.active = channel.active;

			return false;
		}

		const oldID = this.id;

		this.id = channel.id;
		this.username = channel.username;
		this.displayName = channel.displayName;
		this.active = channel.active;

		m.set(channel.id, this);
		m.delete(oldID);

		this.fetch();
		return true;
	}

	leave(): void {
		this.active = false;

		sendMessage("STATE", {
			channel: toRaw(this.base),
		});
	}

	async fetch(refetch = false) {
		sendMessage("STATE", {
			channel: toRaw(this.base),
			refetch: refetch,
		});

		await Promise.all([
			target.listenUntil("channel_fetched", (ev) => {
				if (this.id !== ev.detail.id) return false;

				this.loaded = true;
				this.user = ev.detail.user;

				return true;
			}),
			target.listenUntil("channel_sets_fetched", (ev) => {
				this.setsFetched = true;
				return this.id === ev.detail.id;
			}),
		]);
	}
}

const m = new Map<string, ChannelContext>();
const initialized = new WeakSet<ChannelContext>();

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

export function resolveChannelContext(channelID?: string): ChannelContext {
	const ctx = initializeChannelContext((channelID ? m.get(channelID) : null) ?? reactive<ChannelContext>(new ChannelContext()));

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
