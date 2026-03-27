<template>
	<span
		v-if="!usesLayeredPaint"
		v-cosmetic-paint="paint?.id ?? null"
		class="channel-cosmetics-paint-label"
		:class="{ empty }"
	>
		{{ label }}
	</span>

	<span v-else class="channel-cosmetics-paint-label layered" :class="{ empty }">
		<span v-if="!renderedLayers.length" class="paint-layer" :style="{ filter: layerFilter || undefined }">
			{{ label }}
		</span>

		<span
			v-for="(layer, index) of renderedLayers"
			:key="layer.key"
			class="paint-layer bg-clip"
			:style="{
				opacity: layer.opacity,
				backgroundImage: layer.backgroundImage || undefined,
				backgroundColor: layer.backgroundColor || undefined,
				filter: index === 0 ? layerFilter || undefined : undefined,
			}"
		>
			{{ label }}
		</span>
	</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { createFilterDropshadow } from "@/composable/useCosmetics";

const props = withDefaults(
	defineProps<{
		paint: SevenTV.Cosmetic<"PAINT"> | null;
		label: string;
		empty?: boolean;
	}>(),
	{
		empty: false,
	},
);

interface RenderedLayer {
	key: string;
	opacity: number;
	backgroundImage: string;
	backgroundColor: string;
}

const usesLayeredPaint = computed(() => !!props.paint?.data.layers?.length);
const renderedLayers = computed<RenderedLayer[]>(() =>
	(props.paint?.data.layers ?? [])
		.map((layer) => {
			const backgroundImage = layerToBackgroundImage(layer);
			const backgroundColor = layerToBackgroundColor(layer);
			if (!backgroundImage && !backgroundColor) return null;

			return {
				key: layer.id,
				opacity: clampOpacity(layer.opacity),
				backgroundImage,
				backgroundColor,
			};
		})
		.filter((layer): layer is RenderedLayer => !!layer),
);
const layerFilter = computed(() => {
	const shadows = props.paint?.data.shadows ?? [];
	return shadows.length ? shadows.map(createFilterDropshadow).join(" ") : "";
});

function layerToBackgroundImage(layer: SevenTV.CosmeticPaintLayer): string {
	switch (layer.ty.__typename) {
		case "PaintLayerTypeLinearGradient": {
			if (!layer.ty.stops.length) return "";

			const prefix = layer.ty.repeating ? "repeating-" : "";
			const stops = layer.ty.stops.map((stop) => `${stop.color.hex} ${stop.at * 100}%`).join(", ");
			return `${prefix}linear-gradient(${layer.ty.angle}deg, ${stops})`;
		}
		case "PaintLayerTypeRadialGradient": {
			if (!layer.ty.stops.length) return "";

			const prefix = layer.ty.repeating ? "repeating-" : "";
			const shape = layer.ty.shape.toLowerCase();
			const stops = layer.ty.stops.map((stop) => `${stop.color.hex} ${stop.at * 100}%`).join(", ");
			return `${prefix}radial-gradient(${shape}, ${stops})`;
		}
		case "PaintLayerTypeImage": {
			const imageURL = pickLayerImageURL(layer.ty.images);
			return imageURL ? `url(${JSON.stringify(imageURL)})` : "";
		}
		default:
			return "";
	}
}

function layerToBackgroundColor(layer: SevenTV.CosmeticPaintLayer): string {
	if (layer.ty.__typename !== "PaintLayerTypeSingleColor") return "";
	return layer.ty.color.hex;
}

function pickLayerImageURL(images: SevenTV.CosmeticAssetImage[]): string {
	if (!images.length) return "";

	const isAnimated = images.some((image) => image.frameCount > 1);
	const preferredImage =
		images.find((image) => image.scale === 1 && image.frameCount > 1 === isAnimated) ??
		images.find((image) => image.frameCount > 1 === isAnimated) ??
		images[0];

	return preferredImage?.url ?? "";
}

function clampOpacity(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
}
</script>

<style scoped lang="scss">
.channel-cosmetics-paint-label.channel-cosmetics-paint-label {
	display: block;
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: inherit;
	line-height: inherit;

	&.layered {
		display: grid;
		justify-items: start;
	}

	&.empty {
		color: var(--seventv-text-color-secondary);
	}
}

.paint-layer {
	grid-area: 1 / 1 / -1 / -1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: inherit;

	&.bg-clip {
		background-color: currentColor;
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
}
</style>
