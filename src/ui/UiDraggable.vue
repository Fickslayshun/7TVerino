<template>
	<div ref="el" class="draggable-container" :style="{ top: `${y}px`, left: `${x}px` }">
		<slot />
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from "vue";
import { onClickOutside, useDraggable } from "@vueuse/core";
import { Middleware, Placement, ReferenceElement, autoUpdate, computePosition, shift } from "@floating-ui/dom";

const props = defineProps<{
	initialPosition?: [number, number];
	initialAnchor?: ReferenceElement;
	initialMiddleware?: Middleware[];
	initialPlacement?: Placement;
	emitClickout?: boolean;
	handle?: HTMLDivElement;
	followAnchor?: boolean;
	once?: boolean;
}>();

const emit = defineEmits<{
	(event: "clickout", native: PointerEvent): void;
}>();

const el = ref<HTMLDivElement>();

const middleware = [shift({ crossAxis: true, mainAxis: true })];

const handle = computed(() => props.handle ?? el.value);

let positionOwner: symbol | undefined;
const x = ref(0);
const y = ref(0);

function clampPosition(nextX: number, nextY: number): [number, number] | null {
	if (!el.value) return null;

	const padding = 8;
	const maxX = Math.max(padding, window.innerWidth - el.value.offsetWidth - padding);
	const maxY = Math.max(padding, window.innerHeight - el.value.offsetHeight - padding);

	return [Math.min(Math.max(nextX, padding), maxX), Math.min(Math.max(nextY, padding), maxY)];
}

function updatePosition(nextX: number, nextY: number) {
	const clamped = clampPosition(nextX, nextY);
	if (!clamped) return;

	x.value = clamped[0];
	y.value = clamped[1];
}

async function positionToAnchor(anchor: ReferenceElement) {
	if (!el.value) return;

	const id = Symbol();
	positionOwner = id;

	const { x: nextX, y: nextY } = await computePosition(anchor, el.value, {
		middleware: props.initialMiddleware ?? middleware,
		placement: props.initialPlacement ?? "bottom-start",
	});

	if (positionOwner === id) {
		updatePosition(nextX, nextY);
	}
}

let dragFrame: number | null = null;
let hasDragged = false;

useDraggable(el, {
	onMove({ x, y }) {
		hasDragged = true;
		if (dragFrame === null) {
			dragFrame = window.requestAnimationFrame(() => {
				updatePosition(x, y);
				dragFrame = null;
			});
		}
	},
	handle: handle,
	preventDefault: true,
});

let stopUpdating: (() => void) | undefined;

watch(
		() => [
			el.value,
			props.initialAnchor,
			props.initialPosition?.[0],
			props.initialPosition?.[1],
			props.followAnchor,
			props.initialPlacement,
			props.once,
		],
		() => {
		stopUpdating?.();
		stopUpdating = undefined;

		const currentContainer = el.value;
		if (!currentContainer) return;

		let init = true;
			stopUpdating = autoUpdate(
			{
				getBoundingClientRect() {
					return {
						width: 0,
						height: 0,
						x: x.value,
						y: y.value,
						top: y.value,
						left: x.value,
						right: x.value,
						bottom: y.value,
					};
				},
				contextElement: props.initialAnchor instanceof HTMLElement ? props.initialAnchor : undefined,
			},
			currentContainer,
				() => {
					if (props.initialAnchor && (init || (props.followAnchor && !hasDragged))) {
						void positionToAnchor(props.initialAnchor);
						init = false;
					} else if (init) {
						const tX = props.initialPosition?.[0] ?? 0;
						const tY = props.initialPosition?.[1] ?? 0;
						updatePosition(tX, tY);
						init = false;
					} else if (!props.once) {
						updatePosition(x.value, y.value);
					}
				},
			);
	},
	{ immediate: true },
);

let stopClickout: (() => void) | undefined;

watchEffect(() => {
	stopClickout?.();
	stopClickout = undefined;

	if (props.emitClickout) {
		stopClickout = onClickOutside(el.value, (ev) => emit("clickout", ev));
	}
});

onBeforeUnmount(() => {
	stopUpdating?.();
	stopClickout?.();

	if (dragFrame !== null) cancelAnimationFrame(dragFrame);
});
</script>

<style scoped>
.draggable-container {
	position: fixed;
	z-index: 9999;
}
</style>
