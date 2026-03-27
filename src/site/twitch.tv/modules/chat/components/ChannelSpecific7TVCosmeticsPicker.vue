<template>
	<div class="seventv-channel-cosmetics-picker">
		<button
			ref="triggerRef"
			class="picker-trigger"
			:class="{ open: isOpen }"
			type="button"
			:disabled="disabled"
			:aria-expanded="isOpen ? 'true' : 'false'"
			aria-haspopup="listbox"
			@click="toggleOpen"
			@keydown.down.prevent="openPicker"
			@keydown.enter.prevent="toggleOpen"
			@keydown.space.prevent="toggleOpen"
		>
			<span class="picker-trigger-copy">
				<span v-if="selectedBadge" class="picker-badge-shell">
					<img
						class="picker-badge-image"
						:src="resolveBadgeSrc(selectedBadge)"
						:srcset="buildBadgeSrcset(selectedBadge)"
						:alt="selectedBadge.data.name"
						loading="eager"
						decoding="auto"
						fetchpriority="high"
					/>
				</span>

				<span class="picker-label-shell">
					<ChannelSpecific7TVCosmeticsPaintLabel
						v-if="kind === 'PAINT' && selectedPaint"
						class="picker-label"
						:paint="selectedPaint"
						:label="selectedLabel"
						:empty="!modelValue"
					/>

					<span v-else class="picker-label" :class="{ empty: !modelValue }">
						{{ selectedLabel }}
					</span>
				</span>
			</span>

			<DropdownIcon class="picker-icon" />
		</button>

		<Teleport to="#seventv-float-context">
			<UiFloating
				v-if="isOpen && triggerRef"
				class="picker-floating"
				:anchor="triggerRef"
				emit-clickout
				placement="bottom-start"
				:middleware="middleware"
				@clickout="handleClickout"
			>
				<div
					class="picker-panel"
					role="listbox"
					:aria-label="panelLabel"
					@keydown.escape.stop.prevent="closePicker"
				>
					<div class="picker-search-shell">
						<input
							ref="searchInputRef"
							v-model="searchQuery"
							class="picker-search-input"
							type="search"
							:placeholder="searchPlaceholder"
							@keydown.escape.stop.prevent="closePicker"
						/>
					</div>

					<button
						v-if="defaultLabel"
						class="picker-option"
						:class="{ selected: modelValue === defaultValue }"
						type="button"
						role="option"
						:aria-selected="modelValue === defaultValue ? 'true' : 'false'"
						@click="selectValue(defaultValue)"
					>
						<span class="picker-option-copy">
							<span class="picker-label-shell">
								<span class="picker-label">{{ defaultLabel }}</span>
							</span>
						</span>
						<span class="picker-option-state" :class="{ selected: modelValue === defaultValue }">
							{{ modelValue === defaultValue ? "Selected" : "" }}
						</span>
					</button>

					<button
						class="picker-option"
						:class="{ selected: modelValue === noneValue }"
						type="button"
						role="option"
						:aria-selected="modelValue === noneValue ? 'true' : 'false'"
						@click="selectValue(noneValue)"
					>
						<span class="picker-option-copy">
							<span class="picker-label-shell">
								<span class="picker-label empty">{{ noneLabel }}</span>
							</span>
						</span>
						<span class="picker-option-state" :class="{ selected: modelValue === noneValue }">
							{{ modelValue === noneValue ? "Selected" : "" }}
						</span>
					</button>

					<button
						v-if="showUnknownOption"
						class="picker-option"
						:class="{ selected: !!modelValue && !selectedOption }"
						type="button"
						role="option"
						aria-selected="true"
						@click="selectValue(modelValue)"
					>
						<span class="picker-option-copy">
							<span class="picker-label-shell">
								<span class="picker-label">{{ fallbackLabel || "Saved selection" }}</span>
							</span>
						</span>
						<span class="picker-option-state selected">Saved</span>
					</button>

					<button
						v-for="option of filteredOptions"
						:key="option.id"
						class="picker-option"
						:class="{ selected: option.id === modelValue }"
						type="button"
						role="option"
						:aria-selected="option.id === modelValue ? 'true' : 'false'"
						@click="selectValue(option.id)"
					>
						<span class="picker-option-copy">
							<span v-if="kind === 'BADGE'" class="picker-badge-shell">
								<img
									class="picker-badge-image"
									:src="resolveBadgeSrc(option as SevenTV.Cosmetic<'BADGE'>)"
									:srcset="buildBadgeSrcset(option as SevenTV.Cosmetic<'BADGE'>)"
									:alt="option.data.name"
									loading="eager"
									decoding="auto"
									fetchpriority="high"
								/>
							</span>

							<span class="picker-label-shell">
								<ChannelSpecific7TVCosmeticsPaintLabel
									v-if="kind === 'PAINT'"
									class="picker-label"
									:paint="option as SevenTV.Cosmetic<'PAINT'>"
									:label="option.data.name"
								/>

								<span v-else class="picker-label">
									{{ option.data.name }}
								</span>
							</span>
						</span>

						<span class="picker-option-state" :class="{ selected: option.id === modelValue }">
							{{ option.id === modelValue ? "Selected" : "" }}
						</span>
					</button>

					<p v-if="!filteredOptions.length" class="picker-empty-state">
						No {{ kind === "PAINT" ? "paints" : "badges" }} match "{{ searchQuery.trim() }}".
					</p>
				</div>
			</UiFloating>
		</Teleport>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { imageHostToSrcset, resolve7TVBadgeFormat, resolveImageHostSrc } from "@/common/Image";
import { useUserAgent } from "@/composable/useUserAgent";
import DropdownIcon from "@/assets/svg/icons/DropdownIcon.vue";
import ChannelSpecific7TVCosmeticsPaintLabel from "./ChannelSpecific7TVCosmeticsPaintLabel.vue";
import UiFloating from "@/ui/UiFloating.vue";
import { offset, shift, size } from "@floating-ui/dom";

type CosmeticOption = SevenTV.Cosmetic<"PAINT"> | SevenTV.Cosmetic<"BADGE">;

const props = withDefaults(
	defineProps<{
		modelValue: string;
		kind: "PAINT" | "BADGE";
		options: CosmeticOption[];
		disabled?: boolean;
		defaultValue?: string;
		defaultLabel?: string;
		noneValue?: string;
		noneLabel?: string;
		fallbackLabel?: string;
	}>(),
	{
		disabled: false,
		defaultValue: "",
		defaultLabel: "",
		noneValue: "",
		noneLabel: "None",
		fallbackLabel: "",
	},
);

const emit = defineEmits<{
	(event: "update:modelValue", value: string): void;
}>();

const triggerRef = ref<HTMLElement>();
const searchInputRef = ref<HTMLInputElement>();
const isOpen = ref(false);
const searchQuery = ref("");
const { preferredFormat } = useUserAgent();
const optionsByID = computed(() => new Map(props.options.map((option) => [option.id, option] as const)));
const selectedOption = computed(() => optionsByID.value.get(props.modelValue) ?? null);
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());
const selectedPaint = computed<SevenTV.Cosmetic<"PAINT"> | null>(() => {
	if (props.kind !== "PAINT" || !selectedOption.value) return null;
	return selectedOption.value as SevenTV.Cosmetic<"PAINT">;
});
const selectedBadge = computed<SevenTV.Cosmetic<"BADGE"> | null>(() => {
	if (props.kind !== "BADGE" || !selectedOption.value) return null;
	return selectedOption.value as SevenTV.Cosmetic<"BADGE">;
});
const selectedLabel = computed(() => {
	if (props.modelValue === props.defaultValue && props.defaultLabel) return props.defaultLabel;
	if (props.modelValue === props.noneValue) return props.noneLabel;
	return selectedOption.value?.data.name || props.fallbackLabel || "Saved selection";
});
const showUnknownOption = computed(
	() =>
		!!props.modelValue &&
		!selectedOption.value &&
		props.modelValue !== props.defaultValue &&
		props.modelValue !== props.noneValue,
);
const panelLabel = computed(() => (props.kind === "PAINT" ? "7TV Paint Picker" : "7TV Badge Picker"));
const searchPlaceholder = computed(() => (props.kind === "PAINT" ? "Search paints" : "Search badges"));
const filteredOptions = computed(() => {
	if (!normalizedSearchQuery.value) return props.options;

	return props.options.filter((option) => option.data.name.toLowerCase().includes(normalizedSearchQuery.value));
});
const middleware = [
	offset({ mainAxis: 8 }),
	shift({ padding: 8 }),
	size({
		apply({ rects, elements }) {
			elements.floating.style.width = `${Math.max(rects.reference.width, 248)}px`;
		},
	}),
];

watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) {
			isOpen.value = false;
		}
	},
);
watch(isOpen, async (open) => {
	if (!open) {
		searchQuery.value = "";
		return;
	}

	await nextTick();
	searchInputRef.value?.focus();
	searchInputRef.value?.select();
});

function toggleOpen(): void {
	if (props.disabled) return;
	isOpen.value = !isOpen.value;
}

function openPicker(): void {
	if (props.disabled) return;
	isOpen.value = true;
}

function closePicker(): void {
	isOpen.value = false;
}

function handleClickout(native: PointerEvent): void {
	const target = native.target;
	if (target instanceof Node && triggerRef.value?.contains(target)) {
		return;
	}

	closePicker();
}

function selectValue(value: string): void {
	emit("update:modelValue", value);
	closePicker();
}

function buildBadgeSrcset(badge: SevenTV.Cosmetic<"BADGE">): string {
	const format = resolve7TVBadgeFormat(badge.data.host, preferredFormat);
	return badge.data.host.srcset ?? imageHostToSrcset(badge.data.host, "7TV", format);
}

function resolveBadgeSrc(badge: SevenTV.Cosmetic<"BADGE">): string {
	return resolveImageHostSrc(badge.data.host, "7TV", resolve7TVBadgeFormat(badge.data.host, preferredFormat));
}
</script>

<style scoped lang="scss">
.seventv-channel-cosmetics-picker {
	min-width: 0;
}

.picker-trigger {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.68rem;
	width: 100%;
	min-width: 0;
	min-height: 3.7rem;
	padding: 0.68rem 0.9rem;
	border: 0.01rem solid var(--seventv-input-border);
	border-radius: 0.35rem;
	background: var(--seventv-input-background);
	color: var(--seventv-text-color-normal);
	overflow: hidden;
	cursor: pointer;
	transition:
		border-color 120ms ease,
		background-color 120ms ease,
		transform 120ms ease;

	&:hover,
	&:focus-visible,
	&.open {
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
		background: color-mix(in srgb, var(--seventv-input-background) 88%, white 4%);
	}

	&:focus-visible {
		outline: none;
	}

	&:disabled {
		cursor: default;
		opacity: 0.6;
		transform: none;
	}
}

.picker-trigger-copy,
.picker-option-copy {
	display: flex;
	align-items: center;
	gap: 0.68rem;
	min-width: 0;
	flex: 1 1 auto;
	padding: 0.1rem 0;
	overflow: hidden;
}

.picker-label-shell {
	display: flex;
	align-items: center;
	min-width: 0;
	flex: 1 1 auto;
	padding: 0.12rem 0;
	overflow: hidden;
}

.picker-label {
	display: inline-block;
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 1.12rem;
	font-weight: 800;
	line-height: 1.24;

	&.empty {
		color: var(--seventv-text-color-secondary);
	}
}

.picker-badge-shell {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.05);
}

.picker-badge-image {
	width: 1.56rem;
	height: 1.56rem;
	object-fit: contain;
}

.picker-icon {
	flex: 0 0 auto;
	color: var(--seventv-text-color-secondary);
	font-size: 0.95rem;
	transition: transform 140ms ease;
}

.picker-trigger.open .picker-icon {
	transform: rotate(180deg);
}

.picker-panel {
	display: grid;
	gap: 0.35rem;
	max-height: min(22rem, calc(100vh - 1rem));
	padding: 0.4rem;
	border-radius: 0.55rem;
	border: 0.01rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-shade-1);
	box-shadow: 0 1.4rem 2.8rem rgb(0 0 0 / 0.45);
	overflow-y: auto;
}

.picker-search-shell {
	position: sticky;
	top: 0;
	z-index: 1;
	padding-bottom: 0.2rem;
	background: linear-gradient(to bottom, var(--seventv-background-shade-1), var(--seventv-background-shade-1));
}

.picker-search-input {
	width: 100%;
	height: 3rem;
	padding: 0 0.9rem;
	border: 0.01rem solid var(--seventv-input-border);
	border-radius: 0.4rem;
	background: var(--seventv-input-background);
	color: var(--seventv-text-color-normal);
	font-size: 1rem;
	font-weight: 600;
	outline: none;
	transition:
		border-color 120ms ease,
		background-color 120ms ease;

	&::placeholder {
		color: var(--seventv-text-color-secondary);
	}

	&:focus {
		border-color: color-mix(in srgb, var(--seventv-input-border) 64%, white 22%);
		background: color-mix(in srgb, var(--seventv-input-background) 88%, white 4%);
	}
}

.picker-option {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.68rem;
	width: 100%;
	min-height: 3.35rem;
	padding: 0.7rem 0.82rem;
	border: 0.01rem solid transparent;
	border-radius: 0.45rem;
	background: var(--seventv-input-background);
	color: var(--seventv-text-color-normal);
	overflow: hidden;
	text-align: left;
	transition:
		background-color 120ms ease,
		border-color 120ms ease,
		transform 120ms ease;

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.12);
		background: color-mix(in srgb, var(--seventv-input-background) 84%, white 6%);
		transform: translateY(-1px);
		outline: none;
	}

	&.selected {
		border-color: color-mix(in srgb, var(--seventv-input-border) 58%, white 24%);
		background: color-mix(in srgb, var(--seventv-input-background) 72%, white 10%);
	}
}

.picker-option-state {
	flex: 0 0 auto;
	color: var(--seventv-text-color-secondary);
	font-size: 0.79rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;

	&.selected {
		color: var(--seventv-text-color-normal);
	}
}

.picker-empty-state {
	margin: 0;
	padding: 0.7rem 0.2rem 0.3rem;
	color: var(--seventv-text-color-secondary);
	font-size: 0.98rem;
}

.picker-floating {
	z-index: 10020;
}
</style>
