<template>
	<main class="startpage">
		<section class="startpage__hero">
			<button
				class="startpage__logo-button"
				type="button"
				aria-label="Toggle onboarding graphics mode"
				@dblclick="enableLegacyOnboarding"
			>
				<Logo7TV class="startpage__logo" />
			</button>

			<h1
				v-t="isUpgraded ? 'onboarding.start_title_upgraded' : 'onboarding.start_title'"
				class="startpage__title"
			/>
			<p
				v-t="isUpgraded ? 'onboarding.start_subtitle_upgraded' : 'onboarding.start_subtitle'"
				class="startpage__subtitle"
			/>

			<p class="startpage__note">
				<span v-t="isUpgraded ? 'onboarding.start_skip_note_upgraded' : 'onboarding.start_skip_note'" />
				<span
					v-if="isUpgraded"
					v-t="'onboarding.start_skip_note_upgraded_quirky'"
					class="startpage__note-quirky"
				/>
			</p>
			<p v-if="!legacyEnabled" class="startpage__toggle-note">
				Double click the 7TV logo if you have hardware/graphics acceleration on.
			</p>

			<div class="startpage__actions">
				<UiButton
					class="ui-button-hollow startpage__btn startpage__btn--ghost"
					@click="skipConfig"
					@mouseenter="cursorActive = true"
					@mouseleave="cursorActive = false"
				>
					<span v-t="'onboarding.button_skip'" />
				</UiButton>

				<RouterLink
					class="startpage__link-reset"
					:to="{ name: 'Onboarding', params: { step: isUpgraded ? 'changelog' : 'platforms' } }"
				>
					<UiButton
						class="ui-button-important startpage__btn startpage__btn--primary"
						@mouseenter="cursorActive = true"
						@mouseleave="cursorActive = false"
					>
						<span v-if="isUpgraded" v-t="'onboarding.button_changelog'" />
						<span v-else>Start</span>
						<template #icon>
							<ChevronIcon direction="right" />
						</template>
					</UiButton>
				</RouterLink>
			</div>
		</section>
	</main>
</template>

<script setup lang="ts">
import { inject, ref } from "vue";
import { useHead } from "@vueuse/head";
import { useRouter } from "vue-router";
import ChevronIcon from "@/assets/svg/icons/ChevronIcon.vue";
import Logo7TV from "@/assets/svg/logos/Logo7TV.vue";
import UiButton from "@/ui/UiButton.vue";
import {
	ONBOARDING_ENABLE_LEGACY,
	ONBOARDING_LEGACY_ENABLED,
	ONBOARDING_UPGRADED,
	useOnboarding,
} from "./Onboarding";

useHead({
	title: "Onboarding",
});

useOnboarding("start");
const isUpgraded = inject(ONBOARDING_UPGRADED, ref(false));
const enableLegacy = inject(ONBOARDING_ENABLE_LEGACY, () => undefined);
const legacyEnabled = inject(ONBOARDING_LEGACY_ENABLED, ref(false));
const cursorActive = inject('CURSOR_ACTIVE', ref(false));
const router = useRouter();

function skipConfig(): void {
	cursorActive.value = false;
	router.push({ name: "Onboarding", params: { step: "promotion" } });
}

function enableLegacyOnboarding(): void {
	enableLegacy();
}
</script>

<script lang="ts">
import { OnboardingStepRoute } from "./Onboarding";

export const step: OnboardingStepRoute = {
	name: "start",
	order: 0,
};
</script>

<style scoped lang="scss">
.startpage {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	min-height: 0;
	padding: clamp(1rem, 2.5vh, 2.5rem) 1.5rem;
	overflow: auto;
}

.startpage__hero {
	position: relative;
	z-index: 1;
	width: min(100%, 54rem);
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	padding: clamp(3rem, 5vw, 4.5rem) clamp(2rem, 5vw, 4rem);
	border-radius: 1.5rem;
	background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0)), rgba(10, 10, 10, 0.5);
	border: 1px solid rgba(255, 255, 255, 0.1);
	backdrop-filter: blur(50px) saturate(200%);
	-webkit-backdrop-filter: blur(50px) saturate(200%);
	box-shadow:
		0 40px 150px -20px rgba(0, 0, 0, 1),
		0 0 0 1px rgba(255, 255, 255, 0.03) inset;
	opacity: 0;
	transform: translateY(3rem) scale(0.95);
	animation: startpage-card-in 1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
	overflow: hidden;
}

.startpage__hero > * {
	clip-path: polygon(-200% 0, 300% 0, 300% 100%, -200% 100%);
	opacity: 0;
	transform: translateY(100%);
	animation: startpage-mask-reveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.startpage__logo {
	width: clamp(6.5rem, 14vw, 8.5rem);
	height: clamp(6.5rem, 14vw, 8.5rem);
	color: #fff;
	filter: drop-shadow(0 0 40px rgba(255, 255, 255, 0.3));
	animation-delay: 0.15s;
}

.startpage__logo-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
}

.startpage__title {
	margin: 2rem 0 0;
	font-size: clamp(3.5rem, 7vw, 5.5rem);
	font-weight: 900;
	line-height: 1.05;
	letter-spacing: -0.06em;
	color: #fff;
	text-shadow: 0 4px 16px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.4);
	animation-delay: 0.25s;
}

.startpage__subtitle {
	margin: 1.5rem 0 0;
	max-width: 42rem;
	font-size: clamp(1.2rem, 1.8vw, 1.5rem);
	line-height: 1.6;
	color: rgba(255, 255, 255, 0.8);
	font-weight: 500;
	letter-spacing: -0.01em;
	text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
	animation-delay: 0.35s;
}

.startpage__note {
	margin: 1.5rem 0 0;
	font-size: clamp(0.85rem, 1vw, 0.95rem);
	color: rgba(255, 255, 255, 0.4);
	animation-delay: 0.4s;
}

.startpage__note-quirky {
	margin-left: 0.4rem;
}

.startpage__toggle-note {
	margin: 0.7rem 0 0;
	max-width: 32rem;
	font-size: 0.78rem;
	line-height: 1.45;
	color: rgba(255, 255, 255, 0.34);
	letter-spacing: 0.01em;
	animation-delay: 0.44s;
}

.startpage__actions {
	display: flex;
	align-items: center;
	gap: 1.5rem;
	margin-top: 3.5rem;
	animation-delay: 0.48s;
}

.startpage__link-reset {
	all: unset;
	display: contents;
}

.startpage__btn {
	height: 3.5rem;
	padding: 0 2.5rem;
	border-radius: 999px;
	font-size: 1.15rem;
	font-weight: 700;
	letter-spacing: -0.01em;
	box-shadow: none !important;
	transition:
		transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
		background 0.4s cubic-bezier(0.16, 1, 0.3, 1),
		border-color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
		color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
		box-shadow 0.4s ease;

	&:active {
		transform: scale(0.92);
	}
}

.startpage__btn--ghost {
	border: 2px solid rgba(255, 255, 255, 0.2) !important;
	color: rgba(255, 255, 255, 0.9) !important;
	background: transparent !important;

	&:hover {
		border-color: rgba(255, 255, 255, 1) !important;
		color: #000 !important;
		background: #fff !important;
		box-shadow: 0 0 40px rgba(255, 255, 255, 0.3) !important;
	}
}

.startpage__btn--primary {
	background: #fff !important;
	color: #000 !important;
	outline-color: rgba(255, 255, 255, 0.24) !important;
	box-shadow: 0 0 20px rgba(255, 255, 255, 0.15) !important;

	&:hover {
		background: #f4f4f4 !important;
		box-shadow: 0 0 30px rgba(255, 255, 255, 0.35) !important;
		transform: scale(1.03);
	}
	
	&:active {
		transform: scale(0.97);
	}
}

@keyframes startpage-card-in {
	from {
		opacity: 0;
		transform: translateY(3rem) scale(0.95);
	}

	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

@keyframes startpage-mask-reveal {
	0% {
		opacity: 0;
		transform: translateY(100%);
		clip-path: polygon(-200% 0, 300% 0, 300% 100%, -200% 100%);
	}
	1% {
		opacity: 1;
	}
	100% {
		opacity: 1;
		transform: translateY(0);
		clip-path: polygon(-200% -200%, 300% -200%, 300% 300%, -200% 300%);
	}
}

@media screen and (max-width: 720px) {
	.startpage__hero {
		padding: 2rem 1.2rem;
	}

	.startpage__actions {
		width: 100%;
		flex-direction: column;
	}

	.startpage__btn {
		width: 100%;
		justify-content: center;
	}
}
</style>
