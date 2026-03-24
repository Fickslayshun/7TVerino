<template>
	<main class="ob" @mousemove="onMouseMove">
		<div class="ob__cursor"></div>
		<div class="ob__cursor-glow"></div>
		<canvas class="ob__canvas" ref="canvasRef"></canvas>
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
			<div class="ob__nav-line" />

			<div class="ob__nav-inner">
				<UiButton class="ui-button-hollow ob__nav-btn" @click="toStep(-1)" @mouseenter="cursorActive = true; cursorTheme = 'light'" @mouseleave="cursorActive = false; cursorTheme = 'light'">
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
						:style="{
							backgroundColor: getPipColor(index),
						}"
						@mouseenter="cursorShrink = true; cursorTheme = 'light'"
						@mouseleave="cursorShrink = false; cursorTheme = 'light'"
					/>
				</div>

				<UiButton class="ui-button-important ob__nav-btn" @click="isAtEnd ? exit() : toStep(1)" @mouseenter="cursorActive = true; cursorTheme = 'dark'" @mouseleave="cursorActive = false; cursorTheme = 'light'">
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
import {
	ONBOARDING_ENABLE_LEGACY,
	ONBOARDING_LEGACY_ENABLED,
	ONBOARDING_UPGRADED,
	OnboardingStepRoute,
	createOnboarding,
} from "./Onboarding";
import UiButton from "@/ui/UiButton.vue";

const emit = defineEmits<{
	(event: "toggleLegacy"): void;
}>();

const ctx = createOnboarding();
const route = useRoute();
const router = useRouter();
const isAtEnd = ref(false);
const upgraded = ref(false);
const previousBodyOverflow = ref<string>("");

// Custom Cursor & Canvas State
const mouseX = ref(window.innerWidth / 2);
const mouseY = ref(window.innerHeight / 2);
const renderX = ref(window.innerWidth / 2);
const renderY = ref(window.innerHeight / 2);
const cursorActive = ref(false);
const cursorShrink = ref(false);
const cursorTheme = ref('light');
const cursorHidden = ref(false);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const legacyEnabled = ref(true);
let animationFrameId: number;
let currentScale = 1;
let currentGlowScale = 1;
let webglContext: WebGLRenderingContext | null = null;
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;

function onWindowResize(): void {
	if (!canvasRef.value || !webglContext) return;

	canvasWidth = window.innerWidth;
	canvasHeight = window.innerHeight;
	canvasRef.value.width = canvasWidth;
	canvasRef.value.height = canvasHeight;
	webglContext.viewport(0, 0, canvasWidth, canvasHeight);
}

function onMouseMove(e: MouseEvent) {
	mouseX.value = e.clientX;
	mouseY.value = e.clientY;
}

function onWindowMouseOver(e: MouseEvent): void {
	const target = e.target as HTMLElement;
	if (!target || !target.closest) return;

	const isRange = target.closest('input[type="range"], .ui-range-thumb, .ui-range, .slider');
	if (isRange) {
		cursorHidden.value = true;
		cursorActive.value = false;
		return;
	}

	cursorHidden.value = false;

	const isInteractive = target.closest('.ui-toggle, .ui-select, .seventv-dropdown, select, input[type="checkbox"], .ui-select-header, .seventv-settings-node-control, .ui-button, button');
	if (isInteractive) {
		cursorActive.value = true;
		if (isInteractive.classList?.contains('ui-button-important')) {
			cursorTheme.value = 'dark';
		} else {
			cursorTheme.value = 'light';
		}
	}
}

function onWindowMouseOut(e: MouseEvent): void {
	const target = e.target as HTMLElement;
	const related = e.relatedTarget as HTMLElement;
	if (!target || !target.closest) return;

	const isRange = target.closest('input[type="range"], .ui-range-thumb, .ui-range, .slider');
	if (isRange) {
		if (!related || target.closest('input[type="range"], .ui-range-thumb, .ui-range, .slider') !== related.closest('input[type="range"], .ui-range-thumb, .ui-range, .slider')) {
			cursorHidden.value = false;
		}
	}

	const isInteractive = target.closest('.ui-toggle, .ui-select, .seventv-dropdown, select, input[type="checkbox"], .ui-select-header, .seventv-settings-node-control, .ui-button, button');
	if (isInteractive && !isRange) {
		if (!related || target.closest('.ui-toggle, .ui-select, .seventv-dropdown, select, input[type="checkbox"], .ui-select-header, .seventv-settings-node-control, .ui-button, button') !== related.closest('.ui-toggle, .ui-select, .seventv-dropdown, select, input[type="checkbox"], .ui-select-header, .seventv-settings-node-control, .ui-button, button')) {
			cursorActive.value = false;
			cursorTheme.value = 'light';
		}
	}
}

provide('CURSOR_ACTIVE', cursorActive);
provide('CURSOR_SHRINK', cursorShrink);
provide('CURSOR_THEME', cursorTheme);
provide(ONBOARDING_UPGRADED, upgraded);
provide(ONBOARDING_ENABLE_LEGACY, () => emit("toggleLegacy"));
provide(ONBOARDING_LEGACY_ENABLED, legacyEnabled);

// Check if this is an upgrade from v2
if (chrome && chrome.storage) {
	chrome.storage.local.get(({ upgraded: val }) => {
		upgraded.value = val;
	});
}

onMounted(() => {
	previousBodyOverflow.value = document.body.style.overflow;
	document.body.style.overflow = "hidden";

	// -- WebGL Iridescent Fluid Shader Setup --
	const canvas = canvasRef.value;
	if (!canvas) return;
	const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
	if (!gl) return;
	const webgl = gl as WebGLRenderingContext;
	webglContext = webgl;
	
	canvasWidth = window.innerWidth;
	canvasHeight = window.innerHeight;
	canvas.width = canvasWidth;
	canvas.height = canvasHeight;
	webgl.viewport(0, 0, canvasWidth, canvasHeight);
	
	window.addEventListener('resize', onWindowResize);

	// Global Cursor Interactions
	window.addEventListener('mouseover', onWindowMouseOver);
	window.addEventListener('mouseout', onWindowMouseOut);

	const vsSource = `
		attribute vec2 a_position;
		void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
	`;

	const fsSource = `
		precision highp float;
		uniform float u_time;
		uniform vec2 u_resolution;
		uniform vec2 u_mouse;

		float hash(vec2 p) {
			p = fract(p*144.1414);
			p += dot(p, p+21.4214);
			return fract(p.x*p.y);
		}

		float noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			vec2 u = f*f*(3.0-2.0*f);
			return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
					   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
		}

		float fbm(vec2 p) {
			float f = 0.0;
			float w = 0.5;
			for(int i=0; i<5; i++){
				f += w * noise(p);
				p *= 2.0;
				w *= 0.5;
			}
			return f;
		}

		float get_height(vec2 uv, float t) {
			vec2 q = vec2(0.0);
			// Scaling down the uv input makes the noise features larger, resulting in fewer "streaks"
			q.x = fbm(uv * 0.6 + vec2(0.0, 0.0) + t);
			q.y = fbm(uv * 0.6 + vec2(5.2, 1.3) - t * 0.8);
			
			vec2 r = vec2(0.0);
			r.x = fbm(uv * 0.6 + 1.5 * q + vec2(1.7, 9.2) + t * 1.2);
			r.y = fbm(uv * 0.6 + 1.5 * q + vec2(8.3, 2.8) - t * 1.0);
			
			float h = fbm(uv * 0.6 + 2.0 * r);
			// Soften the structural transition for a smoother look
			return smoothstep(0.15, 0.85, h);
		}

		void main() {
			vec2 uv = gl_FragCoord.xy / u_resolution.xy;
			vec2 aspectUV = uv;
			aspectUV.x *= u_resolution.x / u_resolution.y;
			
			vec2 mouse = vec2(u_mouse.x, u_resolution.y - u_mouse.y) / u_resolution.xy;
			mouse.x *= u_resolution.x / u_resolution.y;
			
			// Tighter Swirl Mouse Interactivity Space Bending
			vec2 delta = aspectUV - mouse;
			float dist = length(delta);
			float force = exp(-dist * 12.0); 
			
			float angle = force * 1.5; // Softer swirl
			float s = sin(angle);
			float c = cos(angle);
			mat2 rot = mat2(c, -s, s, c);
			vec2 uvDist = mouse + rot * delta * (1.0 - force * 0.3);

			// Distinctly slower animation pacing
			float t = u_time * 0.05;

			// ==========================================
			// 3D NORMAL CALCULATION FOR VOLUMETRIC METALLIC LIQUID
			// ==========================================
			float eps = 0.005; 
			float h = get_height(uvDist, t);
			float hx = get_height(uvDist + vec2(eps, 0.0), t);
			float hy = get_height(uvDist + vec2(0.0, eps), t);
			
			// Compute physical 3D Normal of the liquid surface
			vec3 normal = normalize(vec3(hx - h, hy - h, eps * 3.0));

			// ==========================================
			// PHYSICAL LIGHTING & LIQUID BASE
			// ==========================================
			vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0)); // Soft top-right global light
			vec3 viewDir = vec3(0.0, 0.0, 1.0);
			vec3 halfDir = normalize(lightDir + viewDir);
			
			float diffuse = max(dot(normal, lightDir), 0.0);
			float specular = pow(max(dot(normal, halfDir), 0.0), 16.0);
			
			// Ultra-dark Charcoal Base
			vec3 baseColor = mix(vec3(0.0), vec3(0.06, 0.06, 0.06), h);
			vec3 col = baseColor * (diffuse * 0.8 + 0.2) + vec3(0.2) * specular;

			// ==========================================
			// INTERACTIVE MARBLE STREAKS (CURSOR ENERGY)
			// ==========================================
			// Create marbled ribbon streaks strictly following the liquid's height geometry
			float flowBands = sin(h * 24.0 + t * 1.5);
			float streaks = 1.0 - abs(flowBands);
			streaks = pow(streaks, 8.0); // Sharpen the white ribbons

			float smallBands = sin(h * 48.0 - t * 1.2);
			float microStreaks = 1.0 - abs(smallBands);
			microStreaks = pow(microStreaks, 16.0); // Thinner micro veins

			float combinedStreaks = streaks * 1.3 + microStreaks * 0.5;

			// The white ribbons glow intensely inside the liquid exactly where the cursor moves!
			float ambientStreak = 0.12; // Very faint trace globally
			float interactiveStreak = force * 6.5; // Explodes in brightness at the cursor center
			
			col += vec3(1.0) * combinedStreaks * (ambientStreak + interactiveStreak);

			// Add a tight, elegant metallic glint following the cursor
			vec3 lightPos = vec3(mouse.x, mouse.y, 0.2); 
			vec3 p3d = vec3(aspectUV.x, aspectUV.y, h * 0.05);
			vec3 lDir = normalize(lightPos - p3d);
			vec3 pointHalf = normalize(lDir + viewDir);
			float pointSpecular = pow(max(dot(normal, pointHalf), 0.0), 48.0);
			
			float distanceLight = length(lightPos - p3d);
			float attenuation = 1.0 / (1.0 + 12.0 * distanceLight * distanceLight);

			col += vec3(0.95, 0.95, 1.0) * pointSpecular * attenuation * force * 1.4;

			// Cinematic Vignette framing
			float vignette = smoothstep(1.8, 0.2, length(uv - 0.5) * 1.8);
			col *= vignette;
			
			// Premium contrast curve
			col = smoothstep(0.0, 1.0, col);
			col = pow(col, vec3(1.3)); 

			gl_FragColor = vec4(col, 1.0);
		}
	`;

	function createShader(glCtx: WebGLRenderingContext, type: number, source: string) {
		const shader = glCtx.createShader(type);
		glCtx.shaderSource(shader!, source);
		glCtx.compileShader(shader!);
		return shader!;
	}

	const vertexShader = createShader(webgl, webgl.VERTEX_SHADER, vsSource);
	const fragmentShader = createShader(webgl, webgl.FRAGMENT_SHADER, fsSource);

	const program = webgl.createProgram();
	webgl.attachShader(program!, vertexShader);
	webgl.attachShader(program!, fragmentShader);
	webgl.linkProgram(program!);
	webgl.useProgram(program);

	const positionBuffer = webgl.createBuffer();
	webgl.bindBuffer(webgl.ARRAY_BUFFER, positionBuffer);
	webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array([
		-1, -1,
		 1, -1,
		-1,  1,
		-1,  1,
		 1, -1,
		 1,  1,
	]), webgl.STATIC_DRAW);

	const positionLocation = webgl.getAttribLocation(program!, "a_position");
	webgl.enableVertexAttribArray(positionLocation);
	webgl.vertexAttribPointer(positionLocation, 2, webgl.FLOAT, false, 0, 0);

	const timeLoc = webgl.getUniformLocation(program!, "u_time");
	const resLoc = webgl.getUniformLocation(program!, "u_resolution");
	const mouseLoc = webgl.getUniformLocation(program!, "u_mouse");

	let time = 0;
	let lastTime = performance.now();
	
	const cursorEl = document.querySelector('.ob__cursor') as HTMLElement;
	const cursorGlowEl = document.querySelector('.ob__cursor-glow') as HTMLElement;
	
	function loop(now: number) {
		const dt = (now - lastTime) / 1000;
		lastTime = now;
		time += Math.min(dt, 0.1); // cap dt so it avoids large jumps

		// Physics lerp for cursor (smooth tracking)
		renderX.value += (mouseX.value - renderX.value) * 0.15;
		renderY.value += (mouseY.value - renderY.value) * 0.15;
		
		const targetS = cursorActive.value ? 2.5 : cursorShrink.value ? 0.35 : 1;
		currentScale += (targetS - currentScale) * 0.15;

		const targetG = cursorActive.value ? 1.5 : cursorShrink.value ? 0.4 : 1;
		currentGlowScale += (targetG - currentGlowScale) * 0.15;
		
		// Direct DOM manipulation for maximum performance overriding Vue reactivity bottleneck
		if (cursorEl) {
			cursorEl.style.transform = `translate(${renderX.value}px, ${renderY.value}px) scale(${currentScale})`;
			
			if (cursorHidden.value) {
				cursorEl.style.opacity = '0';
			} else {
				cursorEl.style.opacity = '';
				if (cursorActive.value || cursorShrink.value) {
					cursorEl.classList.add('ob__cursor--active');
					if (cursorTheme.value === 'dark') {
						cursorEl.classList.add('ob__cursor--dark');
						cursorEl.classList.remove('ob__cursor--light');
					} else {
						cursorEl.classList.add('ob__cursor--light');
						cursorEl.classList.remove('ob__cursor--dark');
					}
				} else {
					cursorEl.classList.remove('ob__cursor--active', 'ob__cursor--dark', 'ob__cursor--light');
				}
			}
		}
		
		if (cursorGlowEl) {
			cursorGlowEl.style.transform = `translate(${renderX.value}px, ${renderY.value}px) scale(${currentGlowScale})`;
			
			if (cursorHidden.value) {
				cursorGlowEl.style.opacity = '0';
			} else {
				cursorGlowEl.style.opacity = '';
				if (cursorTheme.value === 'dark' && (cursorActive.value || cursorShrink.value)) {
					cursorGlowEl.classList.add('ob__cursor-glow--dark');
				} else {
					cursorGlowEl.classList.remove('ob__cursor-glow--dark');
				}
			}
		}
		
		// Render WebGL Iridescent Shader
		webgl.uniform1f(timeLoc, time);
		webgl.uniform2f(resLoc, canvasWidth, canvasHeight);
		webgl.uniform2f(mouseLoc, renderX.value, renderY.value);
		webgl.drawArrays(webgl.TRIANGLES, 0, 6);
		
		animationFrameId = requestAnimationFrame(loop);
	}
	
	// Start loop immediately
	loop(performance.now());
});

onUnmounted(() => {
	cancelAnimationFrame(animationFrameId);
	window.removeEventListener('resize', onWindowResize);
	window.removeEventListener('mouseover', onWindowMouseOver);
	window.removeEventListener('mouseout', onWindowMouseOut);
	webglContext = null;

	if (previousBodyOverflow.value) {
		document.body.style.overflow = previousBodyOverflow.value;
		return;
	}

	document.body.style.removeProperty("overflow");
});

// Load step data from components
const loadedSteps = import.meta.glob("./Onboarding*.vue", { eager: true });
for (const step of Object.values(loadedSteps) as { default: ComponentFactory; step: OnboardingStepRoute }[]) {
	const def = step.step as OnboardingStepRoute;
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
	if (!ctx) return;

	const currentStep = ctx.activeStep;
	if (!currentStep) return;

	const i = ctx.sortedSteps.indexOf(currentStep);
	if (i === -1) return;

	const nextStep = ctx.sortedSteps[i + delta];
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
	if (!activeStep || !ctx.sortedSteps.length) return "rgba(255, 255, 255, 0.2)";

	const activeIndex = ctx.sortedSteps.findIndex((step) => step.name === activeStep.name);
	if (activeIndex === -1) return "rgba(255, 255, 255, 0.2)";

	const distance = Math.abs(index - activeIndex);
	const maxDistance = Math.max(activeIndex, ctx.sortedSteps.length - 1 - activeIndex);
	if (maxDistance <= 0) return "rgb(255, 255, 255)";

	const closeness = 1 - distance / maxDistance;
	const brightness = 95 + Math.round(closeness * 160);

	return `rgb(${brightness}, ${brightness}, ${brightness})`;
}

// Completely exit onboarding by sending users to Twitch
function exit(): void {
	window.location.assign("https://www.twitch.tv/");
}

// Watch route change and apply new component
watch(
	() => route.params.step as string,
	(step) => {
		cursorActive.value = false;
		cursorShrink.value = false;
		cursorHidden.value = false;
		cursorTheme.value = 'light';
		ctx.activeStep = ctx.steps.get(step) ?? null;
		isAtEnd.value = ctx.activeStep?.name === "end" || false;
	},
	{ immediate: true },
);

// Sort steps by defined order
watch(
	ctx.steps,
	(steps) => {
		ctx.sortedSteps = [...steps.values()].sort((a, b) => a.order - b.order);
	},
	{
		immediate: true,
	},
);
</script>

<style scoped lang="scss">
.ob-slide-enter-active {
	transition:
		opacity 0.6s ease,
		transform 0.6s cubic-bezier(0.16, 1, 0.3, 1),
		filter 0.6s ease;
}

.ob-slide-leave-active {
	transition:
		opacity 0.5s ease,
		transform 0.5s cubic-bezier(0.33, 1, 0.68, 1),
		filter 0.5s ease;
}

.ob-slide-enter-from {
	opacity: 0;
	transform: translateY(2rem) scale(0.97);
	filter: blur(8px);
}

.ob-slide-leave-to {
	opacity: 0;
	transform: translateY(-1.5rem) scale(0.97);
	filter: blur(4px);
}

.ob {
	--ob-nav-height: 3.5rem;
	--ob-nav-offset: 2rem;
	--ob-nav-space: calc(var(--ob-nav-height) + var(--ob-nav-offset) + 1.5rem);

	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	max-height: 100%;
	width: 100%;
	background: #050505;
	color: #fff;
	overflow: hidden;
	
	&, :deep(*) {
		cursor: none !important; /* Force custom cursor globally across all nested scopes */
	}

	& :deep(input[type="range"]), 
	& :deep(.ui-range), 
	& :deep(.ui-range *), 
	& :deep(.slider), 
	& :deep(.slider *) {
		cursor: grab !important;
	}

	& :deep(input[type="range"]:active), 
	& :deep(.ui-range:active *), 
	& :deep(.slider:active *) {
		cursor: grabbing !important;
	}
}

/* Custom Cursor */
.ob__cursor {
	position: fixed;
	top: 0;
	left: 0;
	width: 10px;
	height: 10px;
	background: #fff;
	border-radius: 50%;
	pointer-events: none;
	z-index: 10000;
	transform-origin: center;
	transition: background 0.15s ease, box-shadow 0.15s ease;
	will-change: transform;
	margin-top: -5px;
	margin-left: -5px;
	box-shadow: 0 0 0 0 rgba(255, 255, 255, 0), 0 0 0 rgba(255, 255, 255, 0);
}

.ob__cursor--active {
	background: #000;
}

.ob__cursor--active.ob__cursor--light {
	/* The stroke is a solid 0.5px ring (scales to ~1.25px), and the glow is a soft white shadow */
	box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 1), 0 0 8px 1px rgba(255, 255, 255, 0.5);
}

.ob__cursor--active.ob__cursor--dark {
	/* Dark mode wrapper for contrast against #fff Next buttons */
	box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.6), 0 0 12px 2px rgba(0, 0, 0, 0.4);
}

.ob__cursor-glow {
	position: fixed;
	top: 0;
	left: 0;
	width: 300px;
	height: 300px;
	background: radial-gradient(circle closest-side, rgba(255, 255, 255, 0.08), transparent);
	border-radius: 50%;
	pointer-events: none;
	z-index: 0;
	transform-origin: center;
	will-change: transform;
	margin-top: -150px;
	margin-left: -150px;
	transition: background 0.3s ease;
}

.ob__cursor-glow--dark {
	background: radial-gradient(circle closest-side, rgba(0, 0, 0, 0.15), transparent);
}

.ob::before {
	content: "";
	position: fixed;
	inset: 0;
	z-index: 9999;
	pointer-events: none;
	background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.08'/%3E%3C/svg%3E");
	opacity: 0.05;
	mix-blend-mode: overlay;
}

.ob__canvas {
	position: fixed;
	inset: 0;
	z-index: 0;
	pointer-events: none;
	width: 100vw;
	height: 100vh;
	opacity: 0.8;
}

.ob__vignette {
	position: fixed;
	inset: 0;
	pointer-events: none;
	z-index: 0;
	background: radial-gradient(circle at 50% 50%, transparent 20%, #000 120%);
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
	z-index: 50;
	display: flex;
	justify-content: center;
	transition:
		transform 0.5s cubic-bezier(0.16, 1, 0.3, 1),
		opacity 0.4s ease;

	&.ob__nav--hidden {
		transform: translateY(150%);
		opacity: 0;
		pointer-events: none;
	}
}

.ob__nav-line {
	display: none;
}

.ob__nav-inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: var(--ob-nav-height);
	max-width: calc(100vw - 1.5rem);
	padding: 0 0.75rem;
	gap: 1.5rem;
	background: rgba(10, 10, 10, 0.85);
	backdrop-filter: blur(24px) saturate(180%);
	-webkit-backdrop-filter: blur(24px) saturate(180%);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 100px;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.ob__nav-btn {
	font-size: 0.9rem;
	height: 2.25rem;
	padding: 0 1.2rem;
	border-radius: 100px;
	flex-shrink: 0;
	border: 1px solid rgba(255, 255, 255, 0.1) !important;
	box-shadow: none !important;
	background: rgba(22, 22, 22, 0.8) !important;
	color: #fff !important;
	filter: none !important;
	transition:
		background 0.3s cubic-bezier(0.16, 1, 0.3, 1),
		border-color 0.3s cubic-bezier(0.16, 1, 0.3, 1),
		transform 0.2s ease,
		box-shadow 0.3s ease;

	&:hover {
		background: rgba(45, 45, 45, 0.95) !important;
		border-color: rgba(255, 255, 255, 0.45) !important;
		box-shadow: 0 0 15px rgba(255, 255, 255, 0.08) !important;
		filter: none !important;
	}

	&:focus, &:focus-visible {
		background: rgba(22, 22, 22, 0.8) !important;
		border-color: rgba(255, 255, 255, 0.1) !important;
		box-shadow: none !important;
		color: #fff !important;
		outline: none !important;
		filter: none !important;
	}

	&:active {
		transform: scale(0.96);
		filter: none !important;
	}
}

.ob__nav-btn.ui-button-important {
	background: #fff !important;
	color: #000 !important;
	outline-color: rgba(255, 255, 255, 0.4) !important;
	box-shadow: 0 0 20px rgba(255, 255, 255, 0.15) !important;
	font-weight: 600;

	&:hover {
		filter: none !important;
		background: #f0f0f0 !important;
		box-shadow: 0 0 30px rgba(255, 255, 255, 0.3) !important;
		transform: scale(1.02);
	}
	
	&:focus, &:focus-visible {
		background: #fff !important;
		color: #000 !important;
		box-shadow: 0 0 20px rgba(255, 255, 255, 0.15) !important;
		outline: none !important;
		filter: none !important;
	}

	&:active {
		transform: scale(0.96);
		filter: none !important;
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
		background-color 0.3s ease,
		box-shadow 0.3s ease,
		transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);

	&:hover {
		cursor: pointer;
		transform: scale(1.18);
	}

	&.ob__pip--active {
		transform: scale(1.28);
		box-shadow: 0 0 0.45rem rgba(255, 255, 255, 0.4);
	}
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
		font-size: 0.85rem;
		height: 2rem;
		padding: 0 1rem;
	}

	.ob__pips {
		gap: 0.45rem;
	}
}
</style>
