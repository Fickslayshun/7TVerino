<template>
	<div :id="msg.id" ref="msgContainer" class="seventv-unhandled-message-ref" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ChatMessage } from "@/common/chat/ChatMessage";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { setActiveReplyTray } from "./components/tray/ChatTray";

const props = defineProps<{
	msg: ChatMessage;
}>();

const msgContainer = ref<HTMLDivElement | null>(null);
const ctx = useChannelContext();
let mountedNode: Element | null = null;

function getReplyButton(target: EventTarget | null): HTMLButtonElement | null {
	if (!(target instanceof Element)) return null;

	const button = target.closest('button[aria-label^="Click to reply to @"]');
	return button instanceof HTMLButtonElement ? button : null;
}

function getMessageRoot(root: Element): Element | null {
	if (root.matches(".chat-line__message")) return root;
	return root.querySelector(".chat-line__message");
}

function extractReplyState(root: Element) {
	const messageRoot = getMessageRoot(root);
	if (!messageRoot) return null;

	const body =
		messageRoot.querySelector('[data-a-target="chat-line-message-body"]')?.textContent?.replace(/\s+/g, " ").trim() ??
		"";
	const username = messageRoot.getAttribute("data-a-user")?.trim() ?? "";
	const displayName =
		messageRoot.querySelector('[data-a-target="chat-message-username"]')?.textContent?.trim() || username;

	if (!props.msg.id || !username) return null;

	return {
		channelID: ctx.id,
		id: props.msg.id,
		body,
		deleted: false,
		username,
		displayName,
		close: () => setActiveReplyTray(null),
	};
}

function onWrappedNodeClick(event: Event): void {
	const replyButton = getReplyButton(event.target);
	if (!replyButton || !mountedNode) return;

	const replyState = extractReplyState(mountedNode);
	if (!replyState) return;

	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	setActiveReplyTray(replyState);
}

onMounted(() => {
	if (!msgContainer.value || !props.msg.wrappedNode) return;

	mountedNode = props.msg.wrappedNode;
	mountedNode.addEventListener("click", onWrappedNodeClick, true);
	msgContainer.value.appendChild(mountedNode);
});

onBeforeUnmount(() => {
	mountedNode?.removeEventListener("click", onWrappedNodeClick, true);
	mountedNode = null;
});
</script>

<style scoped lang="scss">
.seventv-unhandled-message-ref {
	display: block;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	overflow: hidden;
	box-sizing: border-box;
}

.seventv-unhandled-message-ref :deep(.chat-line__message) {
	display: flex;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
}

.seventv-unhandled-message-ref :deep(.chat-line__message > div:first-child),
.seventv-unhandled-message-ref :deep(.chat-line__message-container),
.seventv-unhandled-message-ref :deep(.chat-line__message-container > div:first-child),
.seventv-unhandled-message-ref :deep(.chat-line__message-highlight),
.seventv-unhandled-message-ref :deep(.chat-line__no-background) {
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
}

.seventv-unhandled-message-ref :deep(.chat-line__message-container) {
	flex: 1 1 auto;
	overflow: hidden;
}

.seventv-unhandled-message-ref :deep(.chat-line__icons) {
	flex: 0 0 auto;
	align-self: flex-start;
}

.seventv-unhandled-message-ref :deep(.chat-line__reply-icon) {
	min-width: 0;
}

.seventv-unhandled-message-ref :deep([data-a-target="chat-line-message-body"]) {
	display: block;
	min-width: 0;
	max-width: 100%;
	overflow-wrap: anywhere;
}
</style>
