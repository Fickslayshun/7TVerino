import type { ChannelContext } from "@/composable/channel/useChannelContext";

const remoteContextsByID = new Map<string, ChannelContext>();

export function registerTVerinoRemoteContext(ctx: ChannelContext): void {
	if (!ctx.id) return;

	remoteContextsByID.set(ctx.id, ctx);
}

export function unregisterTVerinoRemoteContext(channelID: string, ctx?: ChannelContext): void {
	const existing = remoteContextsByID.get(channelID);
	if (!existing) return;
	if (ctx && existing !== ctx) return;

	remoteContextsByID.delete(channelID);
}

export function resolveTVerinoRemoteContext(channelID: string): ChannelContext | null {
	return remoteContextsByID.get(channelID) ?? null;
}
