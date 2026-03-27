<template>
	<div
		ref="boxRef"
		class="seventv-emote-box"
		:class="{
			'with-border': withBorder,
			'inline-chat': inlineChat,
		}"
		:style="inlineChatStyle"
		:ratio="emoteRatio"
		@mouseenter="onShowTooltip"
		@mouseleave="hide()"
		@click="(ev: MouseEvent) => [onShowEmoteCard(ev), emit('emote-click', ev, emote)]"
	>
		<img
			v-if="!emote.unicode && emote.data && emote.data.host"
			class="seventv-chat-emote"
			:src="primaryImage.src"
			:srcset="primaryImage.srcset"
			:alt="emote.name"
			:class="{ blur: hideUnlisted && emote.data?.listed === false }"
			:loading="inlineChat ? 'eager' : 'lazy'"
			:decoding="inlineChat ? 'auto' : 'async'"
			:fetchpriority="inlineChat ? 'high' : 'auto'"
			@load="onImageLoad"
		/>
		<SingleEmoji
			v-else-if="!unload && emote.id"
			:id="emote.id"
			:alt="emote.name"
			class="seventv-chat-emote seventv-emoji"
			:style="inlineChat ? undefined : { width: `${scale * 2}rem`, height: `${scale * 2}rem` }"
			@mouseenter="onShowTooltip"
			@mouseleave="hide()"
		/>

		<template v-for="overlay of overlayImages" :key="overlay.id">
			<img
				v-if="overlay.emote.data && overlay.emote.data.host"
				class="seventv-chat-emote zero-width-emote"
				:class="{ blur: hideUnlisted && overlay.emote.data?.listed === false }"
				:src="overlay.src"
				:srcset="overlay.srcset"
				:alt="' ' + overlay.emote.name"
				:loading="inlineChat ? 'eager' : 'lazy'"
				:decoding="inlineChat ? 'auto' : 'async'"
				:fetchpriority="inlineChat ? 'high' : 'auto'"
			/>
		</template>

		<template v-if="showEmoteCard">
			<Teleport to="#seventv-message-container">
				<UiFloating
					class="seventv-emote-card-float"
					:anchor="boxRef"
					placement="right-end"
					:middleware="[shift({ mainAxis: true, crossAxis: true }), autoPlacement()]"
					:once="true"
					:emit-clickout="true"
					@clickout="showEmoteCard = false"
				>
					<EmoteCard :emote="emote" :size="[baseWidth, baseHeight]" />
				</UiFloating>
			</Teleport>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useDocumentVisibility } from "@vueuse/core";
import {
	determineRatio,
	ensureImageHostConnection,
	imageHostToSrcset,
	resolve7TVEmoteFormat,
	resolveImageHostSrc,
} from "@/common/Image";
import { useChatPerformance } from "@/composable/chat/useChatPerformance";
import { useConfig } from "@/composable/useSettings";
import { useTooltip } from "@/composable/useTooltip";
import { useUserAgent } from "@/composable/useUserAgent";
import SingleEmoji from "@/assets/svg/emoji/SingleEmoji.vue";
import EmoteTooltip from "./EmoteTooltip.vue";
import UiFloating from "@/ui/UiFloating.vue";
import { autoPlacement, shift } from "@floating-ui/dom";

const props = withDefaults(
	defineProps<{
		emote: SevenTV.ActiveEmote;
		clickable?: boolean;
		format?: SevenTV.ImageFormat;
		overlaid?: Record<string, SevenTV.ActiveEmote> | undefined;
		showTooltip?: boolean;
		unload?: boolean;
		scale?: number;
		inlineChat?: boolean;
		withBorder?: boolean;
	}>(),
	{ showTooltip: true, unload: false, scale: 1, inlineChat: false, withBorder: false },
);

const emit = defineEmits<{
	(event: "emote-click", ev: MouseEvent, ae: SevenTV.ActiveEmote): void;
}>();

const hideUnlisted = useConfig<boolean>("general.blur_unlisted_emotes");
const performance = useChatPerformance();
const pageVisibility = useDocumentVisibility();
const { preferredFormat } = useUserAgent();
const loadEmoteCard = () => import("@/site/global/components/EmoteCard.vue");
const EmoteCard = defineAsyncComponent(loadEmoteCard);

const boxRef = ref<HTMLImageElement | HTMLUnknownElement>();
const showEmoteCard = ref(false);
const cardPos = ref<[number, number]>([0, 0]);

const src = ref("");

const baseWidth = ref(0);
const baseHeight = ref(0);

const shouldThrottleAnimations = computed(
	() => performance.animatedEmoteThrottlingEnabled.value && (pageVisibility.value !== "visible" || props.unload),
);
const inlineChat = computed(() => props.inlineChat);
const inlineChatStyle = computed(() => {
	if (!inlineChat.value) return undefined;

	return {
		"--seventv-inline-emote-size": `${props.scale * 2}em`,
	};
});
const emoteRatio = computed(() => determineRatio(props.emote));
const primaryImage = computed(() => ({
	src: resolveSrc(props.emote),
	srcset: resolveSrcSet(props.emote),
}));
const overlayImages = computed(() =>
	Object.values(props.overlaid ?? {}).map((emote) => ({
		id: emote.id,
		emote,
		src: resolveSrc(emote),
		srcset: resolveSrcSet(emote),
	})),
);

const onImageLoad = (event: Event) => {
	if (!(event.target instanceof HTMLImageElement)) return;

	const img = event.target;

	baseWidth.value = Math.round(img.naturalWidth / props.scale);
	baseHeight.value = Math.round(img.naturalHeight / props.scale);

	src.value = img.currentSrc;
};

function processSrcSet(emote: SevenTV.ActiveEmote) {
	const provider = emote.provider ?? "7TV";
	const host = emote.data?.host;
	if (!host) return "";
	const requestedFormat = props.format ?? preferredFormat;
	const resolvedFormat = provider === "7TV" ? resolve7TVEmoteFormat(host, requestedFormat) : requestedFormat;

	if (provider === "7TV" || props.scale != 1 || !host.srcset) {
		return imageHostToSrcset(host, provider, resolvedFormat, 2, props.scale);
	}

	return host.srcset;
}

function buildStaticSrcSet(emote: SevenTV.ActiveEmote): string {
	const host = emote.data?.host;
	if (!host) return "";

	const multipliers = getLayoutMultipliers(emote.provider ?? "7TV");
	if (!multipliers.length) return "";

	let srcset = "";
	for (let i = 0; i < host.files.length; i++) {
		const file = host.files[i];
		const multiplier = multipliers[i];
		if (!file?.static_name || !multiplier) continue;

		if (srcset) srcset += ", ";
		srcset += `${host.url}/${file.static_name} ${multiplier / props.scale}x`;
	}

	return srcset;
}

function resolveSrcSet(emote: SevenTV.ActiveEmote): string | undefined {
	if (props.unload) return undefined;

	if (shouldThrottleEmote(emote)) {
		const staticSrcSet = buildStaticSrcSet(emote);
		if (staticSrcSet) return staticSrcSet;
	}

	return processSrcSet(emote) || undefined;
}

function resolveSrc(emote: SevenTV.ActiveEmote): string | undefined {
	const host = emote.data?.host;
	if (!host) return undefined;

	const provider = emote.provider ?? "7TV";
	const requestedFormat = props.format ?? preferredFormat;

	if (props.unload) return undefined;

	if (shouldThrottleEmote(emote)) {
		for (const file of host.files) {
			if (!file?.static_name) continue;
			return `${host.url}/${file.static_name}`;
		}
	}

	if (provider === "7TV") {
		return resolveImageHostSrc(host, "7TV", resolve7TVEmoteFormat(host, requestedFormat)) || undefined;
	}

	const preferredFile = host.files.find((file) => file.format === requestedFormat) ?? host.files[0];

	return preferredFile ? `${host.url}/${preferredFile.name}` : undefined;
}

function shouldThrottleEmote(emote: SevenTV.ActiveEmote): boolean {
	return shouldThrottleAnimations.value && isAnimatedEmote(emote) && hasStaticFallback(emote);
}

function hasStaticFallback(emote: SevenTV.ActiveEmote): boolean {
	const host = emote.data?.host;
	if (!host) return false;

	return host.files.some((file) => !!file.static_name);
}

function getLayoutMultipliers(provider: SevenTV.Provider): number[] {
	switch (provider) {
		case "7TV":
			return [1, 2, 3, 4];
		case "PLATFORM":
		case "FFZ":
		case "BTTV":
			return [1, 2, 4];
		default:
			return [];
	}
}

function isAnimatedEmote(emote: SevenTV.ActiveEmote): boolean {
	if (emote.data?.animated) return true;

	const host = emote.data?.host;
	if (!host) return false;

	if (host.url.includes("/animated")) return true;

	return host.files.some((file) => file.format === "GIF" || file.name.toLowerCase().endsWith(".gif"));
}

function onShowEmoteCard(ev: MouseEvent) {
	if (!props.clickable) return;

	showEmoteCard.value = true;
	cardPos.value = [ev.clientX, ev.clientY];
}

function onShowTooltip() {
	if (!props.showTooltip) return;
	show(boxRef.value);
}

const { show, hide } = useTooltip(EmoteTooltip, {
	emote: props.emote,
	initSrc: src,
	overlaid: props.overlaid,
	width: baseWidth,
	height: baseHeight,
});

watch(
	() => performance.asyncHydrationEnabled.value,
	(enabled) => {
		if (!enabled) {
			void loadEmoteCard();
		}
	},
	{ immediate: true },
);

watch(
	() => props.emote.data?.host?.url,
	() => {
		ensureImageHostConnection(props.emote.data?.host);
	},
	{ immediate: true },
);

onBeforeUnmount(hide);
</script>

<style scoped lang="scss">
.seventv-emote-box {
	display: grid;
	overflow: clip;
}

.seventv-emote-box.inline-chat {
	display: inline-grid;
	align-items: end;
	min-height: var(--seventv-inline-emote-size);
	line-height: 0;
	vertical-align: middle;
	overflow: visible;

	&[ratio="1"] {
		width: var(--seventv-inline-emote-size);
	}

	&[ratio="2"] {
		width: calc(var(--seventv-inline-emote-size) * 1.5);
	}

	&[ratio="3"] {
		width: calc(var(--seventv-inline-emote-size) * 2);
	}

	&[ratio="4"] {
		width: calc(var(--seventv-inline-emote-size) * 3);
	}
}

.with-border {
	background: hsla(0deg, 0%, 50%, 6%);
	border-radius: 0.25rem;
	height: 4em;
	margin: 0.25em;
	cursor: pointer;

	&:hover {
		background: hsla(0deg, 0%, 50%, 32%);
	}

	&[zero-width="true"] {
		border: 0.1rem solid rgb(220, 170, 50);
	}

	// The extra width is to compensate for the spacing
	// between the emotes so they tile correctly.

	&[ratio="1"] {
		width: 4em;
	}

	&[ratio="2"] {
		width: calc(4em * 1.5 + 0.25em);
	}

	&[ratio="3"] {
		width: calc(4em * 2 + 0.5em);
	}

	&[ratio="4"] {
		width: calc(4em * 3 + 1em);
	}
}

svg.seventv-emoji {
	width: 2rem;
	height: 2rem;
}

.seventv-emote-box.inline-chat :deep(svg.seventv-emoji) {
	width: auto;
	height: var(--seventv-inline-emote-size);
}

.seventv-chat-emote {
	font-weight: 900;
	grid-column: 1;
	grid-row: 1;
	margin: auto;
	object-fit: contain;

	&:hover {
		cursor: pointer;
	}
}

.seventv-emote-box.inline-chat .seventv-chat-emote {
	display: block;
	width: auto;
	height: var(--seventv-inline-emote-size);
	max-width: none;
	max-height: none;
	vertical-align: middle;
}

img.blur {
	filter: blur(16px);
	overflow: clip;
}

img.zero-width-emote {
	pointer-events: none;
}

.seventv-emote-card-float {
	position: fixed;
}
</style>
