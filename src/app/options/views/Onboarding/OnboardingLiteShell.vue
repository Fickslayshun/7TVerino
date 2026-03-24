<template>
	<main class="ob ob-lite">
		<div class="ob__ambient" />
		<div class="ob__ambient ob__ambient--secondary" />
		<div class="ob__vignette" />

		<div v-if="ctx.activeStep" class="ob__stage">
			<Transition name="ob-slide" mode="out-in">
				<KeepAlive>
					<component
						:is="ctx.activeStep.component as AnyInstanceType"
						class="ob__step-shell"
						@completed="toStep(1)"
					/>
				</KeepAlive>
			</Transition>
		</div>

		<nav v-if="ctx.activeStep" class="ob__nav" :class="{ 'ob__nav--hidden': ctx.activeStep.order === 0 }">
			<div class="ob__nav-inner">
				<UiButton class="ui-button-hollow ob__nav-btn" @click="toStep(-1)">
					<span>Back</span>
				</UiButton>

				<div class="ob__pips">
					<RouterLink
						v-for="(step, index) of ctx.sortedSteps"
						:key="step.name"
						v-tooltip="step.name.charAt(0).toUpperCase() + step.name.slice(1)"
						:to="{ name: 'Onboarding', params: { step: step.name } }"
						active-class="ob__pip--active"
						:completed="step.completed"
						class="ob__pip"
						:style="{ backgroundColor: getPipColor(index) }"
					/>
				</div>

				<UiButton class="ui-button-important ob__nav-btn" @click="isAtEnd ? exit() : toStep(1)">
					<template #icon>
						<ChevronIcon direction="right" />
					</template>
					<span>{{ isAtEnd ? "Done" : "Next" }}</span>
				</UiButton>
			</div>
		</nav>
	</main>
</template>

<script setup lang="ts">
import { markRaw, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { until } from "@vueuse/core";
import ChevronIcon from "@/assets/svg/icons/ChevronIcon.vue";
import UiButton from "@/ui/UiButton.vue";
import {
	ONBOARDING_ENABLE_LEGACY,
	ONBOARDING_LEGACY_ENABLED,
	ONBOARDING_UPGRADED,
	type OnboardingStepRoute,
	createOnboarding,
} from "./Onboarding";

const emit = defineEmits<{
	(event: "toggleLegacy"): void;
}>();

const ctx = createOnboarding();
const route = useRoute();
const router = useRouter();
const isAtEnd = ref(false);
const upgraded = ref(false);
const previousBodyOverflow = ref("");
const cursorActive = ref(false);
const cursorShrink = ref(false);
const cursorTheme = ref("light");
const legacyEnabled = ref(false);

provide("CURSOR_ACTIVE", cursorActive);
provide("CURSOR_SHRINK", cursorShrink);
provide("CURSOR_THEME", cursorTheme);
provide(ONBOARDING_UPGRADED, upgraded);
provide(ONBOARDING_ENABLE_LEGACY, () => emit("toggleLegacy"));
provide(ONBOARDING_LEGACY_ENABLED, legacyEnabled);

if (chrome && chrome.storage) {
	chrome.storage.local.get(({ upgraded: val }) => {
		upgraded.value = val;
	});
}

onMounted(() => {
	previousBodyOverflow.value = document.body.style.overflow;
	document.body.style.overflow = "hidden";
});

onUnmounted(() => {
	document.body.style.overflow = previousBodyOverflow.value;
});

const loadedSteps = import.meta.glob("./Onboarding*.vue", { eager: true });
for (const step of Object.values(loadedSteps) as { default: ComponentFactory; step?: OnboardingStepRoute }[]) {
	const def = step.step;
	const component = step.default;
	if (!def || !(def.name && typeof def.order === "number") || !component) continue;

	ctx.steps.set(
		def.name,
		reactive({
			name: def.name,
			order: def.order,
			component: markRaw(component),
			locked: false,
			completed: false,
			active: false,
			color: def.color,
		}),
	);
}

function toStep(delta: number): void {
	const currentStep = ctx.activeStep;
	if (!currentStep) return;

	const index = ctx.sortedSteps.indexOf(currentStep);
	if (index === -1) return;

	const nextStep = ctx.sortedSteps[index + delta];
	if (!nextStep) return;

	if (delta < 0) {
		currentStep.locked = false;
	} else {
		ctx.onMove?.();
	}

	until(() => currentStep.locked)
		.not.toBeTruthy()
		.then(() => {
			router.push({ name: "Onboarding", params: { step: nextStep.name } });
		});
}

function getPipColor(index: number): string {
	const activeStep = ctx.activeStep;
	if (!activeStep || !ctx.sortedSteps.length) return "rgba(255, 255, 255, 0.22)";

	const activeIndex = ctx.sortedSteps.findIndex((step) => step.name === activeStep.name);
	if (activeIndex === -1) return "rgba(255, 255, 255, 0.22)";

	const distance = Math.abs(index - activeIndex);
	const maxDistance = Math.max(activeIndex, ctx.sortedSteps.length - 1 - activeIndex);
	if (maxDistance <= 0) return "rgb(255, 255, 255)";

	const closeness = 1 - distance / maxDistance;
	const brightness = 120 + Math.round(closeness * 135);

	return `rgb(${brightness}, ${brightness}, ${brightness})`;
}

function exit(): void {
	window.location.assign("https://www.twitch.tv/");
}

watch(
	() => route.params.step as string,
	(step) => {
		cursorActive.value = false;
		cursorShrink.value = false;
		cursorTheme.value = "light";
		ctx.activeStep = ctx.steps.get(step) ?? null;
		isAtEnd.value = ctx.activeStep?.name === "end" || false;
	},
	{ immediate: true },
);

watch(
	ctx.steps,
	(steps) => {
		ctx.sortedSteps = [...steps.values()].sort((a, b) => a.order - b.order);
	},
	{ immediate: true },
);
</script>

<style scoped lang="scss">
.ob-slide-enter-active {
	transition:
		opacity 0.4s ease,
		transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
		filter 0.4s ease;
}

.ob-slide-leave-active {
	transition:
		opacity 0.3s ease,
		transform 0.3s cubic-bezier(0.33, 1, 0.68, 1),
		filter 0.3s ease;
}

.ob-slide-enter-from {
	opacity: 0;
	transform: translateY(1.5rem) scale(0.985);
	filter: blur(0.45rem);
}

.ob-slide-leave-to {
	opacity: 0;
	transform: translateY(-1rem) scale(0.985);
	filter: blur(0.3rem);
}

.ob {
	--ob-nav-height: 3.5rem;
	--ob-nav-offset: 2rem;
	--ob-nav-space: calc(var(--ob-nav-height) + var(--ob-nav-offset) + 1.5rem);

	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	max-height: 100%;
	overflow: hidden;
	color: #fff;
	background:
		radial-gradient(circle at 50% 8%, rgba(255, 255, 255, 0.05), transparent 34%),
		linear-gradient(180deg, #0e0e11 0%, var(--seventv-background-shade-1) 42%, #09090b 100%);
	isolation: isolate;
}

.ob__ambient {
	position: absolute;
	top: -18rem;
	left: 50%;
	z-index: 0;
	width: 56rem;
	height: 56rem;
	border-radius: 50%;
	transform: translateX(-50%);
	pointer-events: none;
	background: radial-gradient(circle, rgba(255, 255, 255, 0.045), transparent 68%);
}

.ob__ambient--secondary {
	top: auto;
	bottom: -24rem;
	left: auto;
	right: -10rem;
	width: 46rem;
	height: 46rem;
	transform: none;
	background: radial-gradient(circle, rgba(145, 70, 255, 0.08), transparent 72%);
}

.ob__vignette {
	position: absolute;
	inset: 0;
	z-index: 0;
	pointer-events: none;
	background: radial-gradient(circle at 50% 32%, transparent 34%, rgba(0, 0, 0, 0.58) 100%);
}

.ob__stage {
	position: relative;
	z-index: 1;
	flex: 1 1 0;
	min-height: 0;
	display: flex;
	overflow: hidden;
	padding-bottom: var(--ob-nav-space);
}

.ob__step-shell {
	width: 100%;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: auto;
	overscroll-behavior: contain;
}

.ob__nav {
	position: fixed;
	inset-inline: 0;
	bottom: var(--ob-nav-offset);
	z-index: 10;
	display: flex;
	justify-content: center;
	transition:
		transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
		opacity 0.25s ease;

	&.ob__nav--hidden {
		transform: translateY(150%);
		opacity: 0;
		pointer-events: none;
	}
}

.ob__nav-inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: var(--ob-nav-height);
	max-width: calc(100vw - 1.5rem);
	padding: 0 0.75rem;
	gap: 1.5rem;
	background: rgba(18, 18, 22, 0.94);
	border: 1px solid var(--seventv-border-transparent-1);
	border-radius: 999px;
	box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
}

.ob__nav-btn {
	height: 2.25rem;
	padding: 0 1.2rem;
	border-radius: 999px;
	flex-shrink: 0;
	box-shadow: none !important;
	font-size: 0.9rem;
	filter: none !important;
	transition:
		transform 0.2s ease,
		border-color 0.25s ease,
		background-color 0.25s ease,
		box-shadow 0.25s ease;

	&:hover {
		filter: none !important;
	}

	&:active {
		transform: scale(0.97);
	}
}

.ob__nav-btn.ui-button-hollow {
	background: rgba(255, 255, 255, 0.04) !important;
	border: 1px solid rgba(255, 255, 255, 0.1) !important;
	color: #fff !important;

	&:hover {
		background: rgba(255, 255, 255, 0.08) !important;
		border-color: rgba(255, 255, 255, 0.18) !important;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.04) inset !important;
	}
}

.ob__nav-btn.ui-button-important {
	background: #fff !important;
	color: #0a0a0c !important;
	font-weight: 700;

	&:hover {
		background: #f2f2f4 !important;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset !important;
	}
}

.ob__pips {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.ob__pip {
	display: block;
	width: 0.55rem;
	height: 0.55rem;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.2);
	transition:
		background-color 0.2s ease,
		transform 0.2s ease,
		box-shadow 0.2s ease;

	&:hover {
		transform: scale(1.15);
	}

	&.ob__pip--active {
		transform: scale(1.28);
		box-shadow: 0 0 0.4rem rgba(255, 255, 255, 0.22);
	}
}

.ob-lite :deep(.startpage__hero),
.ob-lite :deep(.promo__card),
.ob-lite :deep(.compat-page__panel),
.ob-lite :deep(.endpage__card),
.ob-lite :deep(.cfg__advisory),
.ob-lite :deep(.cfg__q-card),
.ob-lite :deep(.plat__card) {
	background: linear-gradient(180deg, rgba(26, 26, 30, 0.96), rgba(17, 17, 20, 0.96)) !important;
	border: 1px solid var(--seventv-border-transparent-1) !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
	box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34) !important;
}

.ob-lite :deep(.startpage__title),
.ob-lite :deep(.promo__cta),
.ob-lite :deep(.compat-page__title),
.ob-lite :deep(.endpage__title),
.ob-lite :deep(.plat__title) {
	text-shadow: none !important;
}

.ob-lite :deep(.startpage__subtitle),
.ob-lite :deep(.promo__plead),
.ob-lite :deep(.compat-page__subtitle),
.ob-lite :deep(.endpage__subtitle),
.ob-lite :deep(.plat__subtitle) {
	text-shadow: none !important;
	color: rgba(255, 255, 255, 0.74) !important;
}

.ob-lite :deep(.startpage__logo) {
	filter: none !important;
}

.ob-lite :deep(.promo__card:hover),
.ob-lite :deep(.endpage__card:hover),
.ob-lite :deep(.plat__card:hover) {
	box-shadow: 0 22px 54px rgba(0, 0, 0, 0.4) !important;
}

@media screen and (max-height: 900px) {
	.ob {
		--ob-nav-height: 3.15rem;
		--ob-nav-offset: 1rem;
		--ob-nav-space: calc(var(--ob-nav-height) + var(--ob-nav-offset) + 0.95rem);
	}

	.ob__nav-inner {
		padding: 0 0.55rem;
		gap: 1rem;
	}

	.ob__nav-btn {
		height: 2rem;
		padding: 0 1rem;
		font-size: 0.85rem;
	}

	.ob__pips {
		gap: 0.45rem;
	}
}

@media screen and (max-width: 860px) {
	.ob__nav {
		inset-inline: 0.75rem;
	}

	.ob__nav-inner {
		width: 100%;
		max-width: 100%;
	}
}
</style>
