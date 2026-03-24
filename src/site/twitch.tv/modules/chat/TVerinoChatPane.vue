<template>
	<div class="seventv-tverino-pane">
		<UiScrollable
			ref="scrollerRef"
			class="seventv-chat-scroller"
			:style="{ fontFamily: properties.fontAprilFools }"
			@container-scroll="scroller.onScroll"
			@container-wheel="scroller.onWheel"
			@mouseenter="properties.hovering = true"
			@mouseleave="properties.hovering = false"
		>
			<div class="seventv-message-container" :style="{ paddingTop: `${topOffset}px` }">
				<ChatList
					ref="chatList"
					:list="resolvedList"
					:restrictions="restrictions"
					:shared-chat-data="sharedChatData"
					:message-handler="messageHandler"
					:force-hydrated="forceHydrated || ctx.remote"
				/>
			</div>

			<div v-if="scroller.paused" class="seventv-message-buffer-notice" @click="scroller.unpause">
				<PauseIcon />
				<span v-if="scroller.pauseBuffer.length" :class="{ capped: scroller.pauseBuffer.length >= lineLimit }">
					{{ scroller.pauseBuffer.length }}
				</span>
				<span>{{ scroller.pauseBuffer.length > 0 ? "new messages" : "Chat Paused" }}</span>
			</div>
		</UiScrollable>

		<ChatData v-if="mountData && ctx.loaded" />
	</div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, provide, ref, watch } from "vue";
import { HookedInstance } from "@/common/ReactHooks";
import { CHANNEL_CTX, type ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useChatScroller } from "@/composable/chat/useChatScroller";
import { useConfig } from "@/composable/useSettings";
import PauseIcon from "@/assets/svg/icons/PauseIcon.vue";
import ChatList from "./ChatList.vue";
import ChatData from "@/app/chat/ChatData.vue";
import UiScrollable from "@/ui/UiScrollable.vue";

const props = withDefaults(
	defineProps<{
		ctx: ChannelContext;
		list?: HookedInstance<Twitch.ChatListComponent>;
		restrictions?: HookedInstance<Twitch.ChatRestrictionsComponent>;
		messageHandler?: Twitch.MessageHandlerAPI | null;
		sharedChatData?: Map<string, Twitch.SharedChat> | null;
		mountData?: boolean;
		forceHydrated?: boolean;
		topOffset?: number;
	}>(),
	{
		list: undefined,
		restrictions: undefined,
		messageHandler: null,
		sharedChatData: null,
		mountData: false,
		forceHydrated: false,
		topOffset: 0,
	},
);

provide(CHANNEL_CTX, props.ctx);

const fallbackList = new HookedInstance({
	props: {
		channelID: props.ctx.id,
		children: [],
		currentUserLogin: "",
		messageHandlerAPI: null,
	},
} as unknown as Twitch.ChatListComponent);

watch(
	() => props.ctx.id,
	(id) => {
		fallbackList.component.props.channelID = id;
	},
	{ immediate: true },
);

const resolvedList = computed(() => props.list ?? (fallbackList as HookedInstance<Twitch.ChatListComponent>));

const scrollerRef = ref<InstanceType<typeof UiScrollable> | undefined>();
const bounds = ref(new DOMRect());
const resizeObserver = new ResizeObserver(() => {
	bounds.value = scrollerRef.value?.container?.getBoundingClientRect() ?? new DOMRect();
});

watch(
	scrollerRef,
	(scroller) => {
		const container = scroller?.container;
		if (!container) return;

		resizeObserver.disconnect();
		resizeObserver.observe(container);
		bounds.value = container.getBoundingClientRect();
	},
	{ immediate: true },
);

const properties = useChatProperties(props.ctx);
const scroller = useChatScroller(props.ctx, {
	scroller: scrollerRef,
	bounds,
});
const lineLimit = useConfig("chat.line_limit", 150);
const showTVerinoTimestamps = useConfig<boolean>("chat.tverino.timestamps", false);

watch(
	() => props.ctx.id,
	() => {
		scroller.unpause();
	},
);

watch(
	[() => properties.nativeShowTimestamps, showTVerinoTimestamps],
	([nativeShowTimestamps, shouldShowTimestamps]) => {
		properties.showTimestamps = nativeShowTimestamps || shouldShowTimestamps;
	},
	{ immediate: true },
);

onUnmounted(() => {
	resizeObserver.disconnect();
	properties.showTimestamps = properties.nativeShowTimestamps;
});
</script>

<style scoped lang="scss">
.seventv-tverino-pane {
	position: relative;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	min-height: 0;
	box-sizing: border-box;
	overflow-x: hidden;
}

.seventv-chat-scroller {
	z-index: 1;
	height: 100%;
	width: 100%;
	max-width: 100%;
	min-width: 0;
	min-height: 0;
	box-sizing: border-box;

	:deep(.scrollable-contents) {
		overflow-x: hidden;
		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
			width: 0;
			height: 0;
		}
	}

	:deep(.scrollbar) {
		display: none !important;
	}
}

.seventv-message-container {
	width: 100%;
	max-width: 100%;
	min-width: 0;
	box-sizing: border-box;
	line-height: 1.5em;
}

.seventv-message-buffer-notice {
	cursor: pointer;
	position: absolute;
	bottom: 1em;
	left: 50%;
	transform: translateX(-50%);
	display: block;
	white-space: nowrap;
	padding: 0.5em;
	border-radius: 0.33em;
	color: currentcolor;
	background-color: var(--seventv-background-transparent-1);
	outline: 0.25rem solid var(--seventv-border-transparent-1);

	span,
	svg {
		display: inline-block;
		vertical-align: middle;
	}

	svg {
		font-size: 1.5rem;
		margin-right: 0.5em;
	}

	span:nth-of-type(1) {
		margin-right: 0.25rem;

		&.capped::after {
			content: "+";
		}
	}
}
</style>
