<template />
<script setup lang="ts">
import { onUnmounted, ref, toRef, watch } from "vue";
import { useStore } from "@/store/main";
import { ChatMessage } from "@/common/chat/ChatMessage";
import { db } from "@/db/idb";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useLiveQuery } from "@/composable/useLiveQuery";
import { WorkletEvent, useWorker } from "@/composable/useWorker";
import EmoteSetUpdateMessage from "@/app/chat/msg/EmoteSetUpdateMessage.vue";
import { v4 as uuidv4 } from "uuid";

const { target } = useWorker();
const ctx = useChannelContext();
const channelID = toRef(ctx, "id");
const messages = useChatMessages(ctx);
const emotes = useChatEmotes(ctx);
const { providers } = useStore();
const pendingActiveSets = ref<SevenTV.EmoteSet[]>([]);

// query the channel's emote set bindings
const channelSets = useLiveQuery(
	() =>
		db.channels
			.where("id")
			.equals(ctx.id)
			.first()
			.then((c) => [...(c?.set_ids ?? [])]),
	undefined,
	{
		reactives: [channelID],
	},
);

function hasActiveNonEmojiEmotes(): boolean {
	return Object.values(emotes.active).some((emote) => emote?.provider && emote.provider !== "EMOJI");
}

function shouldDelayActiveEmoteReset(nextSets: SevenTV.EmoteSet[]): boolean {
	if (ctx.platform !== "TWITCH" || !ctx.id || ctx.setsFetched) return false;
	if ((channelSets.value?.length ?? 0) > 0) return false;
	if (!hasActiveNonEmojiEmotes()) return false;

	// Preserve the existing active map until Twitch finishes fetching the new channel's sets.
	// Without this, route changes can transiently clear 7TV/FFZ/BTTV emotes and leave recents blank.
	return nextSets.every((set) => set.provider === "EMOJI" || set.scope === "GLOBAL");
}

function applyActiveEmoteSets(sets: SevenTV.EmoteSet[] | null | undefined): void {
	const nextSets = sets ?? [];
	const nextSetIds = new Set(nextSets.map((set) => set.id));

	for (const provider of ["7TV", "FFZ", "BTTV"] as const) {
		for (const setID in emotes.providers[provider]) {
			if (!nextSetIds.has(setID)) {
				delete emotes.providers[provider][setID];
			}
		}
	}

	for (const setID in emotes.sets) {
		if (!nextSetIds.has(setID)) {
			delete emotes.sets[setID];
		}
	}

	for (const set of nextSets) {
		if (!set.provider || !providers.has(set.provider)) continue;
		const provider = set.provider as SevenTV.Provider;

		if (!emotes.providers[provider]) emotes.providers[provider] = {};
		emotes.providers[provider][set.id] = set;
		emotes.sets[set.id] = set;
	}

	const nextActive = {} as Record<SevenTV.ObjectID, SevenTV.ActiveEmote>;
	for (const set of nextSets) {
		for (const emote of set.emotes) {
			if (!emote) continue;
			nextActive[emote.name] = emote;
		}
	}

	for (const emoji of Object.values(emotes.emojis)) {
		if (!emoji?.unicode) continue;
		nextActive[emoji.unicode] = emoji;
	}

	for (const name in emotes.active) {
		const active = emotes.active[name];
		if (active?.provider === "EMOJI") continue;
		if (!(name in nextActive)) {
			delete emotes.active[name];
		}
	}

	for (const [name, emote] of Object.entries(nextActive)) {
		emotes.active[name] = emote;
	}
}

// query the active emote sets
useLiveQuery(
	() =>
		db.emoteSets
			.where("id")
			.anyOf(channelSets.value ?? [])
			.or("scope")
			.equals("GLOBAL")
			.sortBy("priority"),
	(sets) => {
		const nextSets = sets ?? [];
		pendingActiveSets.value = nextSets;

		if (shouldDelayActiveEmoteReset(nextSets)) return;

		applyActiveEmoteSets(nextSets);
	},
	{
		reactives: [channelSets],
	},
);

watch(
	() => ctx.setsFetched,
	(setsFetched) => {
		if (!setsFetched) return;
		applyActiveEmoteSets(pendingActiveSets.value);
	},
);

function onEmoteSetUpdated(ev: WorkletEvent<"emote_set_updated">) {
	const { id, emotes_added, emotes_removed, emotes_updated, user } = ev.detail;
	if (!channelSets.value?.includes(id)) return; // not a channel emote set

	const set = emotes.sets[id];

	// Handle added emotes
	for (const emote of emotes_added) {
		emotes.active[emote.name] = emote;
		if (emotes.sets[id]) {
			set.emotes.push(emote);
		}
	}

	// Handle updated emotes
	for (const [o, n] of emotes_updated) {
		if (!n || !o) continue;

		const ae = emotes.find((ae) => ae.id === n.id, true);
		if (!ae) continue;

		const aer = ref(ae);
		for (const k in n) {
			if (k === "data") continue;

			aer.value = { ...aer.value, [k]: n[k as keyof SevenTV.ActiveEmote] };
		}

		delete emotes.active[o.name];
		emotes.active[n.name] = aer.value;

		if (emotes.sets[id]) {
			const i = set.emotes.findIndex((e) => e.id === n.id);
			if (i !== -1) set.emotes.splice(i, 1, aer.value);
		}
	}

	// Handle removed emotes
	for (let i = 0; i < emotes_removed.length; i++) {
		const emote = emotes_removed[i];
		const e = emotes.find((ae) => ae.id === emote.id, true);
		if (!e || e.id !== emote.id) continue;

		emotes_removed[i].data = e.data;
		emotes_removed[i].name = e.name;

		delete emotes.active[e.name];
		if (emotes.sets[id]) {
			const i = set.emotes.findIndex((e) => e.id === emote.id);
			if (i !== -1) set.emotes.splice(i, 1);
		}
	}

	const msg = new ChatMessage(uuidv4());
	msg.setComponent(EmoteSetUpdateMessage, {
		appUser: user,
		add: emotes_added,
		remove: emotes_removed,
		update: emotes_updated,
	});
	messages.add(msg);
}

// This is called when the channel's active emote set is updated
function onActiveSetUpdated(
	connectionIndex: number,
	oldSet: SevenTV.EmoteSet,
	newSet: SevenTV.EmoteSet,
	actor: SevenTV.User,
): void {
	if (!oldSet || !ctx.user) return;

	const conn = ctx.user.connections?.[connectionIndex];
	if (!conn || (conn.emote_set && conn.emote_set.id !== oldSet.id)) return;

	// clear old emote set
	// TODO: this might in rare cases delete active emotes that are still in use by other emote sets
	// some additional such as a parent set check on emotes, may be necessary for stability.
	const oldEmotes = emotes.sets[oldSet.id]?.emotes ?? [];
	for (const emote of oldEmotes) {
		delete emotes.active[emote.name];
	}
	delete emotes.sets[oldSet.id];

	// Trigger DB change on active sets
	conn.emote_set = newSet;
	db.channels
		.where("id")
		.equals(ctx.id ?? "")
		.modify((chMap) => {
			if (!Array.isArray(chMap.set_ids)) chMap.set_ids = [];
			if (oldSet.id === newSet.id) return;

			const oldIndex = chMap.set_ids.indexOf(oldSet.id);
			const newIndex = chMap.set_ids.indexOf(newSet.id);

			if (oldIndex !== -1) {
				if (newIndex === -1) {
					chMap.set_ids.splice(oldIndex, 1, newSet.id);
				} else {
					chMap.set_ids.splice(oldIndex, 1);
				}
			} else if (newIndex === -1) {
				chMap.set_ids.push(newSet.id);
			}
		});

	// write chat message
	const msg = new ChatMessage(uuidv4());
	msg.setComponent(EmoteSetUpdateMessage, {
		appUser: actor,
		add: [],
		remove: [],
		update: [],
		wholeSet: [oldSet, newSet],
	});
	messages.add(msg);
}

function onTwitchEmoteSetData(ev: WorkletEvent<"twitch_emote_set_data">) {
	if (!emotes.providers.PLATFORM) {
		emotes.providers.PLATFORM = {};
	}

	emotes.providers.PLATFORM[ev.detail.id] = ev.detail;
}

target.addEventListener("emote_set_updated", onEmoteSetUpdated);
target.addEventListener("user_updated", (ev) => {
	const { id, actor, emote_set } = ev.detail;
	if (!id || !emote_set) return;

	onActiveSetUpdated(emote_set.connection_index, emote_set.old_set, emote_set.new_set, actor);
});

// Receive twitch emote sets from the worker
target.addEventListener("twitch_emote_set_data", onTwitchEmoteSetData);

onUnmounted(() => {
	target.removeEventListener("emote_set_updated", onEmoteSetUpdated);
	target.removeEventListener("twitch_emote_set_data", onTwitchEmoteSetData);
});
</script>
