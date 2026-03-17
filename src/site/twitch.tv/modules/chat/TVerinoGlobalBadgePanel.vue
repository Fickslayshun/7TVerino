<template>
	<UiFloating
		:anchor="anchorEl"
		emit-clickout
		placement="top-start"
		:middleware="middleware"
		@clickout="emit('clickout', $event)"
	>
		<div class="seventv-tverino-badge-panel">
			<div class="panel-header">
				<div class="panel-header-spacer"></div>
				<p class="panel-header-title">Chat Identity</p>
				<button class="panel-close" type="button" aria-label="Close badge picker" @click="emit('close')">
					<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
						<path
							d="M6.414 5 5 6.414l5.588 5.588L5 17.59l1.414 1.414 5.588-5.588 5.588 5.588 1.414-1.414-5.588-5.588 5.588-5.588L17.59 5l-5.588 5.588L6.414 5Z"
						/>
					</svg>
				</button>
			</div>

			<div class="panel-preview-wrap">
				<p class="panel-section-title">Identity Preview</p>
				<p class="panel-description">How your name will appear in chat on {{ channelLabel }}.</p>

				<div class="panel-preview-row">
					<div class="panel-preview-badge">
						<img
							v-if="selectedBadge"
							class="panel-preview-image"
							:src="selectedBadge.image2x || selectedBadge.image1x"
							:alt="selectedBadge.title"
						/>
						<svg v-else viewBox="0 0 24 24" focusable="false" aria-hidden="true">
							<path
								fill-rule="evenodd"
								d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12Zm11 9A9 9 0 0 1 4.968 6.382l12.65 12.65A8.962 8.962 0 0 1 12 21Zm7.032-3.382a9 9 0 0 0-12.65-12.65l12.65 12.65Z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<span class="panel-preview-name">{{ previewName }}</span>
				</div>
			</div>

			<div class="panel-scroll">
				<section class="panel-section">
					<p class="panel-section-title">Badge</p>
					<p class="panel-description">Choose the Twitch badge you want to use for now.</p>

					<p v-if="notice" class="panel-feedback" :class="{ error: noticeIsError }">
						{{ notice }}
					</p>

					<div v-if="globalBadgeOptions.length" role="radiogroup" class="panel-badge-grid">
						<button
							v-for="badge of globalBadgeOptions"
							:key="badge.key"
							class="panel-badge-tile"
							:class="{ selected: selectedBadgeKeys.includes(badge.key) }"
							type="button"
							role="radio"
							:aria-checked="selectedBadgeKeys.includes(badge.key) ? 'true' : 'false'"
							:aria-label="badge.title"
							:disabled="isSelectingBadge"
							@click="emit('select', badge)"
						>
							<img
								class="panel-badge-tile-image"
								:src="badge.image2x || badge.image1x"
								:alt="badge.title"
							/>
							<span v-if="selectingBadgeKey === badge.key" class="panel-badge-tile-state">...</span>
						</button>
					</div>

					<p v-else class="panel-empty">
						{{ emptyText }}
					</p>
				</section>
			</div>
		</div>
	</UiFloating>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/store/main";
import type { TVerinoGlobalBadgeOption } from "./useTVerinoGlobalBadges";
import UiFloating from "@/ui/UiFloating.vue";
import { offset, shift } from "@floating-ui/dom";

const props = defineProps<{
	anchorEl: HTMLElement;
	channelLabel: string;
	globalBadgeOptions: TVerinoGlobalBadgeOption[];
	notice: string;
	noticeIsError: boolean;
	emptyText: string;
	isSelectingBadge: boolean;
	selectedBadgeKeys: string[];
	selectingBadgeKey: string;
}>();

const emit = defineEmits<{
	(event: "close"): void;
	(event: "clickout", native: PointerEvent): void;
	(event: "select", badge: TVerinoGlobalBadgeOption): void;
}>();

const middleware = [offset({ mainAxis: 10 }), shift({ padding: 8 })];
const store = useStore();

const selectedBadge = computed(() => {
	for (const badge of props.globalBadgeOptions) {
		if (props.selectedBadgeKeys.includes(badge.key)) return badge;
	}

	return null;
});

const previewName = computed(() => {
	const identity = store.identity;
	if (!identity || !("displayName" in identity)) return "You";
	return identity.displayName || identity.username || "You";
});
</script>

<style scoped lang="scss">
.seventv-tverino-badge-panel {
	width: 34rem;
	max-width: min(34rem, calc(100vw - 1.2rem));
	border-radius: 0.8rem;
	background: #18181b;
	border: 0.1rem solid rgb(255 255 255 / 0.1);
	box-shadow: 0 1.6rem 3.6rem rgb(0 0 0 / 0.48);
	overflow: hidden;
}

.panel-header {
	display: grid;
	grid-template-columns: 2.4rem 1fr 2.4rem;
	align-items: center;
	gap: 0.75rem;
	padding: 0.9rem 1rem 0.85rem;
	border-bottom: 0.1rem solid rgb(255 255 255 / 0.08);
}

.panel-header-spacer {
	width: 2.4rem;
	height: 2.4rem;
}

.panel-header-title {
	margin: 0;
	color: #efeff1;
	font-size: 1.42rem;
	font-weight: 700;
	line-height: 1.2;
	text-align: center;
}

.panel-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.4rem;
	height: 2.4rem;
	border-radius: 0.4rem;
	color: rgb(255 255 255 / 0.82);
	transition:
		background-color 120ms ease,
		color 120ms ease;

	svg {
		width: 1.8rem;
		height: 1.8rem;
		fill: currentColor;
	}

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.08);
		color: #fff;
	}
}

.panel-preview-wrap {
	padding: 1rem;
}

.panel-section-title {
	margin: 0;
	color: #efeff1;
	font-size: 1.24rem;
	font-weight: 700;
	line-height: 1.25;
}

.panel-description {
	margin: 0.35rem 0 0;
	color: #adadb8;
	font-size: 1.08rem;
	line-height: 1.4;
}

.panel-preview-row {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	margin-top: 0.9rem;
}

.panel-preview-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.8rem;
	height: 2.8rem;
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.06);
	flex: 0 0 auto;

	svg {
		width: 1.8rem;
		height: 1.8rem;
		fill: rgb(255 255 255 / 0.72);
	}
}

.panel-preview-image {
	width: 2rem;
	height: 2rem;
	object-fit: contain;
}

.panel-preview-name {
	color: #efeff1;
	font-size: 1.46rem;
	font-weight: 700;
	line-height: 1.2;
}

.panel-scroll {
	max-height: 42rem;
	overflow-y: auto;
	padding-bottom: 0.85rem;
}

.panel-section {
	padding: 0 1rem;
}

.panel-feedback,
.panel-empty {
	margin: 0.65rem 0 0;
	font-size: 1.04rem;
	line-height: 1.4;
}

.panel-feedback {
	color: #c4b5fd;

	&.error {
		color: #fda4af;
	}
}

.panel-empty {
	color: #adadb8;
}

.panel-badge-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(3.45rem, 1fr));
	gap: 0.48rem;
	margin-top: 0.8rem;
}

.panel-badge-tile {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	aspect-ratio: 1 / 1;
	width: 100%;
	padding: 0.38rem;
	border-radius: 0.48rem;
	border: 0.1rem solid rgb(255 255 255 / 0.08);
	background: #0f0f13;
	transition:
		border-color 120ms ease,
		background-color 120ms ease,
		transform 120ms ease;

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.16);
		background: #15151b;
		transform: translateY(-1px);
	}

	&.selected {
		border-color: #9147ff;
		box-shadow: inset 0 0 0 0.1rem rgb(145 71 255 / 0.42);
		background: rgb(145 71 255 / 0.12);
	}

	&:disabled {
		cursor: wait;
	}
}

.panel-badge-tile-image {
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.panel-badge-tile-state {
	position: absolute;
	right: 0.22rem;
	bottom: 0.18rem;
	min-width: 1.1rem;
	height: 1.1rem;
	padding: 0 0.2rem;
	border-radius: 999px;
	background: rgb(0 0 0 / 0.7);
	color: #fff;
	font-size: 0.82rem;
	font-weight: 700;
	line-height: 1.1rem;
	text-align: center;
}
</style>
