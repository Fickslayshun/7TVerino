<template>
	<main class="plat">
		<div class="plat__header">
			<h1 v-t="'onboarding.platforms_title'" class="plat__title" />
			<p v-t="'onboarding.platforms_subtitle'" class="plat__subtitle" />
		</div>

		<div class="plat__grid">
			<div
				v-for="platform of platforms"
				:key="platform.name"
				class="plat__card"
				:class="'plat__card--' + platform.name.toLowerCase()"
				:selected="platform.selected"
				@click="toggle(platform)"
				@mousemove="handleMouseMove"
				@mouseenter="cursorActive = true"
				@mouseleave="handleMouseLeave"
			>
				<div class="plat__card-content">
					<div class="plat__card-icon">
						<component :is="platform.icon as AnyInstanceType" />
					</div>
					<span class="plat__card-name">{{ platform.name }}</span>
				</div>

				<div class="plat__card-status" />
			</div>
		</div>

		<div v-t="'onboarding.platforms_mutable_note'" class="plat__note" />
	</main>
</template>

<script setup lang="ts">
interface PlatformDef {
	name: string;
	icon: ComponentFactory | null;
	hosts?: string[];
	selected?: boolean;
}

const ctx = useOnboarding("platforms");
const cursorActive = inject('CURSOR_ACTIVE', ref(false));
const legacyEnabled = inject(ONBOARDING_LEGACY_ENABLED, ref(false));

onActivated(() => {
	ctx.setLock(true, () => {
		const selection = platforms.value.filter((p) => p.selected);
		if (selection.length === 0) return false;

		const hosts = selection.flatMap((p) => p.hosts ?? []);
		chrome.permissions.request({ origins: hosts }, (granted) => {
			if (granted) {
				ctx.setLock(false);
			}
		});
	});
});

onDeactivated(() => {
	ctx.setCompleted(true);
});

const platforms = ref<PlatformDef[]>([
	{ name: "Twitch", icon: markRaw(LogoBrandTwitch), selected: true },
	{ name: "YouTube", icon: markRaw(LogoBrandYouTube), hosts: ["*://*.youtube.com/*"], selected: true },
	{ name: "Kick", icon: markRaw(LogoBrandKick), hosts: ["*://*.kick.com/*"], selected: true },
]);

function toggle(p: PlatformDef) {
	p.selected = !p.selected;
}

function handleMouseMove(e: MouseEvent) {
	if (!legacyEnabled.value) return;

	const target = e.currentTarget as HTMLElement;
	const rect = target.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;
	
	const midX = rect.width / 2;
	const midY = rect.height / 2;
	const tiltX = ((y - midY) / midY) * -18; // 18 deg max
	const tiltY = ((x - midX) / midX) * 18;
	
	target.style.setProperty("--mouse-x", `${x}px`);
	target.style.setProperty("--mouse-y", `${y}px`);
	target.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
}

function handleMouseLeave(e: MouseEvent) {
	cursorActive.value = false;
	const target = e.currentTarget as HTMLElement;
	target.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
}
</script>

<script lang="ts">
import { markRaw, onActivated, onDeactivated, ref, inject } from "vue";
import LogoBrandKick from "@/assets/svg/logos/LogoBrandKick.vue";
import LogoBrandTwitch from "@/assets/svg/logos/LogoBrandTwitch.vue";
import LogoBrandYouTube from "@/assets/svg/logos/LogoBrandYouTube.vue";
import { ONBOARDING_LEGACY_ENABLED, OnboardingStepRoute, useOnboarding } from "./Onboarding";

export const step: OnboardingStepRoute = {
	name: "platforms",
	order: 1,
};
</script>

<style scoped lang="scss">
.plat {
	width: 100%;
	height: 100%;
	min-height: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: clamp(1.4rem, 3vh, 3rem);
	padding: clamp(1rem, 2.5vh, 2rem);
	overflow: auto;
}

.plat__header {
	text-align: center;
	max-width: 44rem;
	opacity: 0;
	transform: translateY(2rem) scale(0.95);
	animation: plat-card-in 1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
	overflow: hidden;
}

.plat__header > * {
	clip-path: polygon(-200% 0, 300% 0, 300% 100%, -200% 100%);
	opacity: 0;
	transform: translateY(100%);
	animation: plat-mask-reveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.plat__title {
	font-size: clamp(3.5rem, 6.5vw, 5rem);
	font-weight: 900;
	color: #fff;
	letter-spacing: -0.05em;
	line-height: 1.05;
	margin: 0;
	animation-delay: 0.2s;
}

.plat__subtitle {
	font-size: clamp(1.1rem, 1.4vw, 1.3rem);
	color: rgba(255, 255, 255, 0.7);
	line-height: 1.6;
	margin: 1.5rem 0 0;
	animation-delay: 0.3s;
}

.plat__grid {
	position: relative;
	top: -80px;
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 1.5rem;
	width: 100%;
	max-width: 52rem;
}

.plat__card {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	aspect-ratio: 4 / 5;
	background: #050505;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 1.5rem;
	cursor: pointer;
	user-select: none;
	overflow: hidden;
	transition:
		border-color 0.4s ease,
		background 0.4s ease,
		scale 0.5s cubic-bezier(0.16, 1, 0.3, 1),
		transform 0.5s cubic-bezier(0.16, 1, 0.3, 1),
		box-shadow 0.4s ease;
	scale: 1;
	opacity: 0;
	transform: perspective(1000px) translateY(3rem) translateZ(-100px) rotateX(10deg);
	animation: plat-card-3d-in 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	transform-origin: center center;
	box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.9);
	will-change: transform;

	&::after {
		content: "";
		position: absolute;
		inset: 0;
		background: radial-gradient(
			circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
			rgba(255, 255, 255, 0.06),
			transparent 100%
		);
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
	}

	&:hover {
		transition: transform 0s, scale 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease, background 0.4s ease, border-color 0.4s ease;
		scale: 1.04;
		border-color: rgba(255, 255, 255, 0.15);
		background: #0a0a0a;
		box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.5);

		&::after {
			opacity: 0.5;
		}

		.plat__card-icon {
			filter: grayscale(0.85);
			opacity: 0.6;
			transform: translateZ(40px) scale(1.1);
		}
	}

	&:active {
		transition: transform 0.1s ease !important;
		transform: scale3d(0.95, 0.95, 0.95) !important;
	}
}

.plat__card:nth-child(1) {
	animation-delay: 0.12s;
}

.plat__card:nth-child(2) {
	animation-delay: 0.2s;
}

.plat__card:nth-child(3) {
	animation-delay: 0.28s;
}

.plat__card-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.5rem;
	z-index: 1;
}

.plat__card-icon {
	display: flex;
	align-items: center;
	justify-content: center;
	filter: grayscale(1);
	opacity: 0.3;
	transition:
		filter 0.5s cubic-bezier(0.16, 1, 0.3, 1),
		opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
		transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	will-change: transform;

	svg {
		width: clamp(5rem, 10vw, 7rem);
		height: clamp(4rem, 7vw, 5rem);
		filter: drop-shadow(0 20px 30px rgba(0,0,0,0.5));
	}
}

.plat__card-name {
	font-size: 0.9rem;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.4);
	letter-spacing: 0.05em;
	text-transform: uppercase;
	transition: color 0.3s ease;
}

.plat__card-status {
	position: absolute;
	inset: 0;
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.4s ease;
	z-index: 0;

	&::before {
		content: "";
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 50% 100%, var(--brand-color-glow), transparent 60%);
		opacity: 0.15;
	}
}

/* Selected States */

.plat__card--twitch {
	--brand-color: #9146ff;
	--brand-color-glow: rgba(145, 70, 255, 0.6);
}

.plat__card--youtube {
	--brand-color: #ff0000;
	--brand-color-glow: rgba(255, 0, 0, 0.5);
}

.plat__card--kick {
	--brand-color: #53fc18;
	--brand-color-glow: rgba(83, 252, 24, 0.5);
}

.plat__card[selected="true"] {
	border-color: var(--brand-color);
	box-shadow: 0 0 120px -20px var(--brand-color-glow), inset 0 0 40px rgba(255, 255, 255, 0.1);
	
	&:hover {
		scale: 1.08; /* expans a little bit! */
	}

	.plat__card-icon {
		filter: grayscale(0) drop-shadow(0 0 30px var(--brand-color-glow));
		opacity: 1;
		transform: translateZ(50px) scale(1.2);
	}

	.plat__card-name {
		color: #fff;
		transform: translateZ(20px);
	}

	.plat__card-status {
		opacity: 1;
	}
}

.plat__note {
	position: relative;
	top: -87px;
	font-size: 0.8rem;
	color: rgba(255, 255, 255, 0.25);
	text-align: center;
	max-width: 32rem;
	line-height: 1.5;
	opacity: 0;
	transform: translateY(0.8rem);
	animation: plat-fade-up 0.45s ease 0.34s forwards;
}

@keyframes plat-card-3d-in {
	from {
		opacity: 0;
		transform: perspective(1000px) translateY(4rem) translateZ(-100px) rotateX(15deg);
	}

	to {
		opacity: 1;
		transform: perspective(1000px) translateY(0) translateZ(0) rotateX(0deg);
	}
}

@keyframes plat-mask-reveal {
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

@keyframes plat-fade-up {
	from {
		opacity: 0;
		transform: translateY(0.8rem);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}
</style>
