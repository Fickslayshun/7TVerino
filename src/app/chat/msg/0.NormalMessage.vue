<template>
	<div class="seventv-chat-message-container">
		<div class="seventv-chat-message-background" tabindex="0">
			<div v-if="msgData.reply" class="seventv-reply-part">
				<div class="seventv-chat-reply-icon">
					<TwChatReply />
				</div>
				<div
					v-tooltip="`Replying to @${msgData.reply.parentDisplayName}: ${msgData.reply.parentMessageBody}`"
					class="seventv-reply-message-part"
				>
					{{ `Replying to @${msgData.reply.parentDisplayName}: ${msgData.reply.parentMessageBody}` }}
				</div>
			</div>
			<slot />
		</div>
	</div>
</template>

<script setup lang="ts">
import type { ChatMessage } from "@/common/chat/ChatMessage";
import TwChatReply from "@/assets/svg/twitch/TwChatReply.vue";

defineProps<{
	msg: ChatMessage;
	msgData: Twitch.ChatMessage;
}>();
</script>
<style scoped lang="scss">
.seventv-chat-message-container {
	display: block;
	position: relative;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	overflow-wrap: anywhere;

	.seventv-chat-message-background {
		position: relative;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 0.5rem var(--seventv-chat-padding, 1rem);

		.seventv-reply-part {
			display: flex;
			align-items: center;
			font-size: 1.2rem;
			color: var(--color-text-alt-2);
			overflow: clip;
			min-width: 0;

			.seventv-chat-reply-icon {
				align-items: center;
				fill: currentcolor;
				display: inline-flex;
				flex: 0 0 auto;
			}

			.seventv-reply-message-part {
				flex: 1 1 auto;
				min-width: 0;
				text-overflow: ellipsis;
				overflow: clip;
				white-space: nowrap;
				margin-left: 0.5rem;
			}
		}
	}

	&:hover,
	&:focus-within {
		.seventv-chat-message-background {
			border-radius: 0.25rem;
			background: hsla(0deg, 0%, 60%, 24%);
		}

		.seventv-buttons-container {
			visibility: visible;
		}

		:deep(.seventv-chat-message-buttons) {
			visibility: visible;
		}
	}
}
</style>
