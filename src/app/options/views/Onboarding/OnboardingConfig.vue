<template>
	<main class="cfg">
		<div class="cfg__header">
			<h1 v-t="'onboarding.config_title'" class="cfg__title" />
			<p v-t="'onboarding.config_subtitle'" class="cfg__subtitle" />
		</div>

		<div class="cfg__body">
			<div v-if="!acknowledgements.has('new-chat')" class="cfg__advisory">
				<div class="cfg__advisory-content">
					<strong v-t="'onboarding.config_new_chat_advisory'" class="cfg__advisory-heading" />
					<span v-t="'onboarding.config_emphasize-bad-compat'" class="cfg__advisory-emphasis" />
					<div class="cfg__advisory-links">
						<p v-t="'onboarding.config_bear_with_us1'" />
						<a v-t="'onboarding.config_bear_with_us2'" href="https://discord.gg/7tv" target="_blank" />
					</div>
				</div>

				<div class="cfg__advisory-actions">
					<UiButton 
						class="cfg__advisory-skip" 
						@click="skipConfigStep"
						@mouseenter="cursorActive = true"
						@mouseleave="cursorActive = false"
					>
						<span v-t="'onboarding.button_skip'" />
					</UiButton>
					<UiButton
						class="ui-button-important cfg__advisory-btn"
						@click="[acknowledgements.add('new-chat'), setLock(false)]"
						@mouseenter="cursorActive = true"
						@mouseleave="cursorActive = false"
					>
						<template #icon>
							<GearsIcon />
						</template>
						<span v-t="'onboarding.config_action_button'" />
					</UiButton>
				</div>
			</div>

			<Transition v-else name="question" appear>
				<div v-if="currentQuestion" class="cfg__questions">
					<div class="cfg__q-card">
						<h2 class="cfg__q-title">{{ currentQuestion.title }}</h2>

						<div v-if="currentQuestion.kind === 'either'" class="cfg__q-options">
							<UiButton 
								class="cfg__q-yes" 
								@click="onAnswer(currentQuestion!, true)"
								@mouseenter="cursorActive = true"
								@mouseleave="cursorActive = false"
							>
								<span v-t="'onboarding.config_answer_button_yes'" />
							</UiButton>
							<UiButton 
								class="cfg__q-no" 
								@click="onAnswer(currentQuestion!, false)"
								@mouseenter="cursorActive = true"
								@mouseleave="cursorActive = false"
							>
								<span v-t="'onboarding.config_answer_button_no'" />
							</UiButton>
						</div>

						<div
							v-else-if="currentQuestion.kind === 'config' && currentQuestion.configEffect"
							class="cfg__q-settings"
						>
							<UiScrollable>
								<SettingsNode
									v-for="node of getCurrentConfigNodes(currentQuestion)"
									:key="node.key"
									:node="node"
								/>
							</UiScrollable>

							<UiButton 
								class="cfg__q-confirm" 
								@click="onAnswer(currentQuestion!, true)"
								@mouseenter="cursorActive = true"
								@mouseleave="cursorActive = false"
							>
								<span v-t="'onboarding.button_confirm'" />
							</UiButton>
						</div>
					</div>
				</div>
			</Transition>
		</div>
	</main>
</template>

<script setup lang="ts">
const emit = defineEmits<{
	(e: "completed"): void;
}>();

const { t } = useI18n();
const { setCompleted, setLock } = useOnboarding("config");
const cursorActive = inject('CURSOR_ACTIVE', ref(false));

const settings = useSettings();

const nodes = reactive<Map<string, SevenTV.SettingNode>>(new Map());
const acknowledgements = reactive(new Set<string>([]));

const questions = ref<Question[]>([
	{
		id: "active-chatter",
		kind: "either",
		title: t("onboarding.config_question.chatter"),
		immediateConfigEffect: [
			["highlights.basic.mention_sound", true],
			["highlights.basic.mention_title_flash", true],
		],
	},
	{
		id: "chatter-config-autocompletion",
		kind: "config",
		configEffect: [
			"chat_input.autocomplete.colon",
			"chat_input.autocomplete.colon.emoji",
			"chat_input.autocomplete.carousel",
			"chat_input.autocomplete.carousel_arrow_keys",
			"chat_input.autocomplete.chatters",
		],
		title: t("onboarding.config_question.chatter_autocompletion"),
		if: ["active-chatter"],
	},
	{
		id: "chatter-config-look",
		kind: "config",
		configEffect: [
			"chat.message_batch_duration",
			"chat.smooth_scroll_duration",
			"chat.line_limit",
			"chat.alternating_background",
			"chat.padding",
			"chat.colored_mentions",
		],
		title: t("onboarding.config_question.chatter_look"),
		if: ["active-chatter"],
	},
	{
		id: "chatter-config-ping",
		kind: "config",
		configEffect: ["highlights.basic.mention_title_flash", "highlights.basic.mention_sound"],
		title: t("onboarding.config_question.chatter_ping"),
		if: ["active-chatter"],
	},
	{
		id: "chatter-config-spam",
		kind: "config",
		configEffect: [
			"general.autoclaim.channel_points",
			"chat_input.spam.bypass_duplicate",
		],
		title: t("onboarding.config_question.chatter_spam"),
		if: ["active-chatter"],
	},
	{
		id: "moderator",
		kind: "either",
		title: t("onboarding.config_question.moderator"),
	},
	{
		id: "moderator-config",
		kind: "config",
		title: t("onboarding.config_question.moderator_utility"),
		if: ["moderator"],
		configEffect: ["chat.mod_slider"],
	},
	{
		id: "streamer",
		kind: "either",
		title: t("onboarding.config_question.streamer"),
		immediateConfigEffect: [
			// turn off ping effects if user is a streamer
			["general.blur_unlisted_emotes", true],
			["chat.message_batch_duration", 350],
			["highlights.basic.mention_title_flash", false],
			["highlights.basic.mention_sound", false],
		],
	},
	{
		id: "streamer-config",
		kind: "config",
		title: t("onboarding.config_question.streamer_utility"),
		if: ["streamer"],
		configEffect: [
			"general.blur_unlisted_emotes",
			"chat.message_batch_duration",
			"chat.smooth_scroll_duration",
			"highlights.basic.mention_title_flash",
			"highlights.basic.mention_sound",
		],
	},
]);
const currentQuestion = ref<Question | null>(questions.value[0]);

function onAnswer(q: Question, v: boolean): void {
	if (q) {
		q.answer = v;
	}

	currentQuestion.value = null;

	if (v && q.immediateConfigEffect?.length) {
		for (const [k, val] of q.immediateConfigEffect) {
			const cfg = useConfig(k);
			if (!cfg) continue;

			cfg.value = val;
		}
	}

	const questionIndex = questions.value.findIndex((question) => question.id === q.id);
	if (questionIndex === -1) {
		setLock(false);
		setCompleted(true);
		emit("completed");
		return;
	}

	let n: Question | undefined;
	for (let nextIndex = questionIndex + 1; nextIndex < questions.value.length; nextIndex++) {
		const candidate = questions.value[nextIndex];
		const shouldSkip = (candidate.if ?? []).some((dependencyID) => {
			const dependency = questions.value.find((question) => question.id === dependencyID);
			return dependency?.answer === false;
		});
		if (shouldSkip) continue;

		n = candidate;
		break;
	}

	if (!n) {
		setLock(false);
		setCompleted(true);
		emit("completed");
		return;
	}

	useTimeoutFn(() => {
		currentQuestion.value = n!;
	}, 500);
}

function getCurrentConfigNodes(q: Question): SevenTV.SettingNode[] {
	if (!q.configEffect?.length) return [];

	return q.configEffect.map((key) => nodes.get(key)).filter((node): node is SevenTV.SettingNode => Boolean(node));
}

function skipConfigStep(): void {
	cursorActive.value = false;
	setLock(false);
	setCompleted(true);
	emit("completed");
}

const allModules = import.meta.glob("@/site/**/modules/**/*Module.vue", {
	eager: false,
	import: "config",
});
for (const loader of Object.values(allModules)) {
	(loader as () => Promise<SevenTV.SettingNode[]>)().then((a) => {
		if (!Array.isArray(a)) return;

		settings.register(a);
		for (const n of a) {
			nodes.set(n.key, n);
		}
	});
}

interface Question {
	id: string;
	title: string;
	kind: "either" | "config";
	if?: string[];
	configEffect?: string[];
	immediateConfigEffect?: [string, SevenTV.SettingType][];
	answer?: boolean | string | number;
}
</script>

<script lang="ts">
import { reactive, ref, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useTimeoutFn } from "@vueuse/shared";
import { useConfig, useSettings } from "@/composable/useSettings";
import GearsIcon from "@/assets/svg/icons/GearsIcon.vue";
import { OnboardingStepRoute, useOnboarding } from "./Onboarding";
import SettingsNode from "@/app/settings/SettingsNode.vue";
import UiButton from "@/ui/UiButton.vue";
import UiScrollable from "@/ui/UiScrollable.vue";

export const step: OnboardingStepRoute = {
	name: "config",
	order: 2,
};
</script>

<style scoped lang="scss">
.question-enter-active,
.question-leave-active {
	transition:
		transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
		opacity 0.3s ease;
}

.question-enter-from,
.question-leave-to {
	transform: translateY(1.5rem);
	opacity: 0;
}

.cfg {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	min-height: 0;
	padding: clamp(1rem, 2.8vh, 3rem) 2rem clamp(0.8rem, 2.2vh, 2rem);
	gap: clamp(1.2rem, 2.8vh, 2.5rem);
	overflow: auto;
}

.cfg__header {
	text-align: center;
	max-width: 44rem;
	opacity: 0;
	transform: translateY(2rem) scale(0.95);
	animation: cfg-card-in 1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
	overflow: hidden;
}

.cfg__header > * {
	clip-path: polygon(-200% 0, 300% 0, 300% 100%, -200% 100%);
	opacity: 0;
	transform: translateY(100%);
	animation: cfg-mask-reveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.cfg__title {
	font-size: clamp(3.5rem, 6.5vw, 5rem);
	font-weight: 900;
	letter-spacing: -0.05em;
	line-height: 1.05;
	color: #fff;
	text-shadow: 0 4px 16px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.4);
	margin: 0;
	animation-delay: 0.2s;
}

.cfg__subtitle {
	margin-top: 1.5rem;
	font-size: clamp(1.2rem, 1.4vw, 1.4rem);
	color: rgba(255, 255, 255, 0.7);
	text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
	line-height: 1.6;
	animation-delay: 0.3s;
}

.cfg__body {
	display: flex;
	justify-content: center;
	width: 100%;
	max-width: 50rem;
	opacity: 0;
	transform: translateY(2rem) scale(0.97);
	animation: cfg-panel-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards;
}

.cfg__advisory {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.5rem;
	width: 100%;
	padding: 2.5rem;
	background: linear-gradient(145deg, rgba(20, 20, 20, 0.8), rgba(8, 8, 8, 0.9));
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 1.25rem;
	backdrop-filter: blur(20px) saturate(180%);
	-webkit-backdrop-filter: blur(20px) saturate(180%);
	box-shadow: 0 24px 80px -20px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.cfg__advisory-content {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	text-align: center;
}

.cfg__advisory-heading {
	font-size: 1.2rem;
	font-weight: 700;
	color: #fff;
}

.cfg__advisory-emphasis {
	font-style: italic;
	color: rgba(255, 255, 255, 0.45);
	font-size: 0.95rem;
}

.cfg__advisory-links {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.95rem;
	color: rgba(255, 255, 255, 0.5);

	a {
		color: #fff;
		text-decoration: none;
		cursor: pointer;
		opacity: 0.8;
		transition: opacity 0.2s ease;

		&:hover {
			opacity: 1;
			text-decoration: underline;
		}
	}
}

.cfg__advisory-btn {
	font-size: 1.1rem;
	padding: 0 1.5rem;
	height: 3.25rem;
	border-radius: 999px;
	box-shadow: none !important;
	transition: background 0.3s ease, border-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease;
	
	&:active {
		transform: scale(0.96);
	}
}

.cfg__advisory-actions {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.8rem;
	flex-wrap: wrap;
}

.cfg__advisory-skip {
	height: 3.25rem;
	padding: 0 1.6rem;
	border-radius: 100px;
	border: 1px solid rgba(255, 255, 255, 0.16);
	background: transparent;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.72);
	box-shadow: none !important;
	transition: background 0.3s ease, border-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease;

	&:hover {
		border-color: rgba(255, 255, 255, 0.32);
		color: #fff;
		background: rgba(255, 255, 255, 0.06);
	}
}

.cfg__questions {
	display: flex;
	justify-content: center;
	width: 100%;
}

.cfg__q-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.5rem;
	width: 100%;
	padding: clamp(1.8rem, 4vh, 3.5rem) clamp(1.5rem, 3vw, 2.5rem);
	background: linear-gradient(145deg, rgba(20, 20, 20, 0.8), rgba(8, 8, 8, 0.9));
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 1.25rem;
	backdrop-filter: blur(20px) saturate(180%);
	-webkit-backdrop-filter: blur(20px) saturate(180%);
	box-shadow: 0 24px 80px -20px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.cfg__q-title {
	font-size: clamp(1.4rem, 2vw, 1.8rem);
	font-weight: 700;
	color: #fff;
	text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
	text-align: center;
	line-height: 1.4;
	margin: 0;
	letter-spacing: -0.02em;
}

.cfg__q-options {
	display: flex;
	justify-content: center;
	gap: 1rem;
}

.cfg__q-yes,
.cfg__q-no {
	min-width: 6.5rem;
	height: 2.75rem;
	font-size: 0.95rem;
	font-weight: 500;
	border-radius: 100px;
	transition:
		background 0.2s ease,
		box-shadow 0.2s ease,
		transform 0.1s ease,
		color 0.2s ease;

	&:active {
		transform: scale(0.96);
	}
}

.cfg__q-yes {
	background: #fff;
	color: #000;
	box-shadow: none !important;

	&:hover {
		transform: translateY(-1px);
	}
}

.cfg__q-no {
	background: transparent;
	border: 1px solid rgba(255, 255, 255, 0.15);
	color: rgba(255, 255, 255, 0.6);

	&:hover {
		border-color: rgba(255, 255, 255, 0.3);
		color: #fff;
		background: rgba(255, 255, 255, 0.05);
	}
}

.cfg__q-settings {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	width: 100%;
	background: #0a0a0a;
	border: 1px solid rgba(255, 255, 255, 0.05);
	border-radius: 0.75rem;
	padding: 1rem;
	max-height: 50vh;
	font-size: 1rem;
	text-align: start;
}

.cfg__q-confirm {
	font-size: 1rem;
	font-weight: 600;
	padding: 0 2rem;
	height: 2.75rem;
	border-radius: 100px;
	background: #fff !important;
	color: #000 !important;
	transition:
		background 0.2s ease,
		transform 0.2s ease,
		box-shadow 0.2s ease;
	box-shadow: none !important;

	&:hover {
		transform: translateY(-1px);
	}

	&:active {
		transform: scale(0.98);
	}
}

@keyframes cfg-panel-in {
	from {
		opacity: 0;
		transform: translateY(2rem) scale(0.97);
	}

	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

@keyframes cfg-card-in {
	from {
		opacity: 0;
		transform: translateY(3rem) scale(0.95);
	}

	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

@keyframes cfg-mask-reveal {
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
</style>
