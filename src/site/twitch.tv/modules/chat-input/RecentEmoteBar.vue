<template>
	<Teleport v-if="mounted" :to="mountEl">
		<div v-if="isEnabled" class="seventv-recent-emote-bar" :class="{ empty: !resolvedEntries.length }">
			<template v-if="resolvedEntries.length">
				<button
					v-for="emote of resolvedEntries"
					:key="`${emote.provider}:${emote.id}`"
					type="button"
					class="seventv-recent-emote-bar-item"
					:title="`${emote.name} - Click to send. Ctrl+Click or Alt+Click to insert.`"
					@click="handleEmoteClick($event, emote)"
				>
					<Emote :emote="emote" :clickable="false" :show-tooltip="false" :scale="0.74" />
				</button>
			</template>
			<div v-else class="seventv-recent-emote-bar-empty">
				Recent emotes appear here after you send them. Ctrl+Click or Alt+Click inserts.
			</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from "vue";
import { log } from "@/common/Logger";
import { HookedInstance } from "@/common/ReactHooks";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useRecentSentEmotes } from "@/composable/chat/useRecentSentEmotes";
import Emote from "@/app/chat/Emote.vue";

const props = defineProps<{
	instance: HookedInstance<Twitch.ChatAutocompleteComponent>;
}>();

const recentSentEmotes = useRecentSentEmotes();
const mountEl = document.createElement("div");
mountEl.className = "seventv-recent-emote-bar-host";

const mounted = ref(false);
const textAreaEl = ref<HTMLElement | null>(null);
const resizeObserver = new ResizeObserver(() => syncTextareaLayout());

const isEnabled = computed(() => recentSentEmotes.enabled.value);
const channelID = computed(() => getRecentBarChannelID(props.instance.component));
const channelCtx = useChannelContext(channelID.value, true);
const emotes = useChatEmotes(channelCtx);
const messages = useChatMessages(channelCtx);

const resolvedEntries = computed(() => {
	const entries = recentSentEmotes.getEntries(channelID.value);

	return entries
		.filter((entry) => recentSentEmotes.scopeAllows(entry.provider))
		.map((entry) => {
			return (
				emotes.find(
					(ae) =>
						ae.id === entry.id &&
						ae.provider === entry.provider &&
						(ae.unicode ?? ae.name) === (entry.name || ae.name),
					true,
				) ?? emotes.find((ae) => ae.id === entry.id && ae.provider === entry.provider, true)
			);
		})
		.filter((ae): ae is SevenTV.ActiveEmote => !!ae);
});

watchEffect(() => {
	const root = props.instance.domNodes.root;
	if (!(root instanceof HTMLElement)) return;
	const textArea = root.closest(".chat-input__textarea");
	if (textArea instanceof HTMLElement && textAreaEl.value !== textArea) {
		textAreaEl.value?.classList.remove("seventv-recent-emote-bar-active");
		textAreaEl.value?.style.removeProperty("--seventv-recent-emote-bar-height");
		textArea.classList.add("seventv-recent-emote-bar-active");
		textAreaEl.value = textArea;
	}

	const chatBox = root.querySelector(".chat-wysiwyg-input-box");
	const mountParent = chatBox instanceof HTMLElement ? chatBox : null;
	if (mountParent instanceof HTMLElement) {
		const mountBefore = mountParent.firstElementChild;
		if (mountBefore instanceof HTMLElement) {
			if (mountEl.parentElement !== mountParent || mountEl.nextSibling !== mountBefore) {
				mountParent.insertBefore(mountEl, mountBefore);
			}
		} else if (mountEl.parentElement !== mountParent) {
			mountParent.prepend(mountEl);
		}

		mounted.value = true;
		syncTextareaLayout();
		return;
	}

	if (!root.parentElement) return;
	if (mountEl.parentElement !== root.parentElement || mountEl.nextSibling !== root) {
		root.parentElement.insertBefore(mountEl, root);
	}

	mounted.value = true;
	syncTextareaLayout();
});

function appendEmoteToInput(emote: SevenTV.ActiveEmote): void {
	const inputRef = props.instance.component;
	if (!inputRef) {
		log.warn("ref to input not found, cannot insert recent emote");
		return;
	}

	const token = emote.unicode ?? emote.name;
	const current = inputRef.getValue();
	const prefix = current && current.at(-1) !== " " ? " " : "";

	inputRef.setValue(current + prefix + token + " ");
	props.instance.component.focus();
}

function sendEmote(emote: SevenTV.ActiveEmote): void {
	const token = emote.unicode ?? emote.name;
	messages.sendMessage(token);
	props.instance.component.focus();
}

function handleEmoteClick(ev: MouseEvent, emote: SevenTV.ActiveEmote): void {
	ev.preventDefault();
	ev.stopPropagation();

	if (ev.ctrlKey || ev.altKey) {
		appendEmoteToInput(emote);
		return;
	}

	sendEmote(emote);
}

onUnmounted(() => {
	mounted.value = false;
	resizeObserver.disconnect();
	textAreaEl.value?.classList.remove("seventv-recent-emote-bar-active");
	textAreaEl.value?.style.removeProperty("--seventv-recent-emote-bar-height");
	mountEl.remove();
});

function getRecentBarChannelID(component: Twitch.ChatAutocompleteComponent): string {
	return component.props?.channelID ?? component.componentRef?.props?.channelID ?? "";
}

function syncTextareaLayout(): void {
	const textArea = textAreaEl.value;
	if (!textArea || !mountEl.isConnected) return;

	resizeObserver.disconnect();
	resizeObserver.observe(mountEl);

	const height = Math.ceil(mountEl.getBoundingClientRect().height);
	textArea.style.setProperty("--seventv-recent-emote-bar-height", `${height}px`);
}
</script>

<style scoped lang="scss">
.seventv-recent-emote-bar {
	display: flex;
	flex-wrap: nowrap;
	gap: 0.35rem;
	align-items: center;
	width: 100%;
	padding: 0.4rem 0.45rem 0.35rem;
	margin-bottom: 0.25rem;
	border-bottom: 0.1rem solid rgb(255 255 255 / 0.14);
	background: transparent;
	box-sizing: border-box;
	overflow-x: auto;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		width: 0;
		height: 0;
	}

	&.empty {
		padding: 0.45rem 0.45rem 0.4rem;
	}
}

.seventv-recent-emote-bar-item {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	min-width: calc(2.9rem - 2px);
	min-height: calc(2.7rem - 2px);
	padding: calc(0.2rem - 1px) calc(0.3rem - 1px);
	border: 0;
	border-radius: 0.45rem;
	background: transparent;
	cursor: pointer;
	transition:
		background-color 110ms ease,
		transform 110ms ease;

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.08);
		transform: translateY(-1px);
	}
}

.seventv-recent-emote-bar-empty {
	font-size: 1.2rem;
	line-height: 1.3;
	color: var(--seventv-text-color-secondary);
	white-space: normal;
}
</style>

<style lang="scss">
.chat-input__textarea.seventv-recent-emote-bar-active {
	.chat-input__badge-carousel {
		top: calc(var(--seventv-recent-emote-bar-height, 0px) + 0.55rem - 6px) !important;
		transform: none !important;
	}

	.chat-wysiwyg-input__placeholder,
	.chat-wysiwyg-input__editor {
		padding-top: 8px !important;
		padding-bottom: 12px !important;
	}

	.chat-wysiwyg-input-box--allow-focus-style:focus-within {
		outline: calc(0.12rem + 1px) solid var(--color-border-input-focus, #a970ff) !important;
		outline-offset: 0 !important;
		box-shadow: none !important;
	}
}
</style>
