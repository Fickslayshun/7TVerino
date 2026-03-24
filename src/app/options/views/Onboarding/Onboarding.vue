<template>
	<div class="ob-mode-shell">
		<Transition name="ob-mode-switch">
			<OnboardingLegacyShell v-if="legacyEnabled" key="legacy" @toggle-legacy="toggleLegacy" />
			<OnboardingLiteShell v-else key="lite" @toggle-legacy="toggleLegacy" />
		</Transition>
	</div>
</template>

<script setup lang="ts">
import { onBeforeMount, ref } from "vue";
import OnboardingLegacyShell from "./OnboardingLegacyShell.vue";
import OnboardingLiteShell from "./OnboardingLiteShell.vue";

const LEGACY_ONBOARDING_MODE_KEY = "seventv:onboarding:legacy-shell";
const legacyEnabled = ref(false);

function toggleLegacy(): void {
	legacyEnabled.value = !legacyEnabled.value;

	try {
		if (legacyEnabled.value) {
			window.sessionStorage.setItem(LEGACY_ONBOARDING_MODE_KEY, "1");
		} else {
			window.sessionStorage.removeItem(LEGACY_ONBOARDING_MODE_KEY);
		}
	} catch {
		// Session persistence is best-effort only.
	}
}

onBeforeMount(() => {
	try {
		legacyEnabled.value = window.sessionStorage.getItem(LEGACY_ONBOARDING_MODE_KEY) === "1";
	} catch {
		legacyEnabled.value = false;
	}
});
</script>

<style scoped lang="scss">
.ob-mode-shell {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	isolation: isolate;
}

.ob-mode-switch-enter-active,
.ob-mode-switch-leave-active {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	transition:
		opacity 0.2s ease,
		transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
		filter 0.2s ease;
	will-change: opacity, transform, filter;
}

.ob-mode-switch-enter-from {
	opacity: 0;
	transform: scale(1.025);
	filter: blur(0.55rem);
}

.ob-mode-switch-leave-to {
	opacity: 0;
	transform: scale(0.992);
	filter: blur(0.2rem);
}
</style>
