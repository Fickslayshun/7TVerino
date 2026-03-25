<template>
	<UiFloating
		:anchor="anchorEl"
		emit-clickout
		placement="top-end"
		:middleware="middleware"
		@clickout="emit('clickout', $event)"
	>
		<div class="seventv-tverino-settings-panel">
			<div class="panel-header">
				<div class="panel-title-wrap">
					<h3>Chat Settings</h3>
					<p>{{ channelLabel }}</p>
				</div>

				<button class="panel-close" type="button" aria-label="Close chat settings" @click="emit('close')">
					&times;
				</button>
			</div>

			<section v-if="showModeratorSection" class="panel-section">
				<header class="panel-section-title">Moderator Settings</header>
				<p class="panel-section-description">
					{{ moderatorSectionDescription }}
				</p>

				<div v-if="moderatorStateRows.length" class="panel-rows">
					<div v-for="row of moderatorStateRows" :key="row.id" class="panel-row panel-row-static">
						<span class="panel-label">{{ row.label }}</span>
						<span class="panel-value">{{ row.value }}</span>
					</div>
				</div>

				<p v-else class="panel-empty">Waiting for channel mode state...</p>
			</section>

			<section class="panel-section">
				<header class="panel-section-title">Custom Settings</header>

				<div class="panel-subsection">
					<button
						class="panel-row panel-row-button panel-row-expand"
						type="button"
						@click="emoteBarExpanded = !emoteBarExpanded"
					>
						<span class="panel-label">Emote Bar</span>
						<span class="panel-expand-meta">
							<span class="panel-value">{{ formatRecentEmoteMode(recentEmoteMode) }}</span>
							<span class="panel-chevron" :class="{ open: emoteBarExpanded }" aria-hidden="true">›</span>
						</span>
					</button>

					<div v-if="emoteBarExpanded" class="panel-subrows">
						<button class="panel-row panel-row-button" type="button" @click="cycleRecentEmoteMode">
							<span class="panel-label">Mode</span>
							<span class="panel-value interactive">
								{{ formatRecentEmoteMode(recentEmoteMode) }}
							</span>
						</button>

						<button class="panel-row panel-row-button" type="button" @click="toggleRecentEmoteScope">
							<span class="panel-label">Emote Scope</span>
							<span class="panel-value interactive">
								{{ formatRecentEmoteScope(recentEmoteScope) }}
							</span>
						</button>

						<button class="panel-row panel-row-button" type="button" @click="handleClearAllEmoteHistory">
							<span class="panel-label">Clear All</span>
							<span class="panel-value interactive">Reset</span>
						</button>

						<div class="panel-channel-clear">
							<label class="panel-channel-clear-label" for="tverino-clear-most-used-channel">
								Clear Most Used (Channel)
							</label>
							<div class="panel-channel-clear-input-row">
								<input
									id="tverino-clear-most-used-channel"
									v-model="clearMostUsedChannelName"
									class="panel-channel-clear-input"
									type="text"
									placeholder="Type a channel name"
									@keydown.enter.prevent="handleClearMostUsedByChannelName"
								/>
								<button
									class="panel-channel-clear-button"
									type="button"
									@click="handleClearMostUsedByChannelName"
								>
									Clear
								</button>
							</div>
						</div>

						<p v-if="emoteBarFeedback" class="panel-feedback" :class="{ error: emoteBarFeedbackError }">
							{{ emoteBarFeedback }}
						</p>
					</div>
				</div>

				<div class="panel-rows">
					<button
						v-for="row of settingsRows"
						:key="row.id"
						class="panel-row panel-row-button"
						type="button"
						@click="row.action"
					>
						<span class="panel-label">{{ row.label }}</span>
						<span
							v-if="row.kind === 'toggle'"
							class="panel-toggle"
							:class="{ on: row.enabled }"
							aria-hidden="true"
						>
							<span class="panel-toggle-thumb"></span>
						</span>
						<span v-else class="panel-value interactive">
							{{ row.value }}
						</span>
					</button>
				</div>
			</section>

		</div>
	</UiFloating>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChannelContext } from "@/composable/channel/useChannelContext";
import { type RecentEmoteBarMode, useRecentSentEmotes } from "@/composable/chat/useRecentSentEmotes";
import { useConfig } from "@/composable/useSettings";
import UiFloating from "@/ui/UiFloating.vue";
import { offset, shift } from "@floating-ui/dom";

interface ToggleRow {
	id: string;
	label: string;
	kind: "toggle";
	enabled: boolean;
	action: () => void;
}

interface ValueRow {
	id: string;
	label: string;
	kind: "value";
	value: string;
	action: () => void;
}

type SettingsRow = ToggleRow | ValueRow;
interface ModeratorStateRow {
	id: string;
	label: string;
	value: string;
}
type DeletedMessageMode = 0 | 1 | 2 | 3;
type MentionStyle = 0 | 1 | 2;
type TimestampFormatKey = "infer" | "12" | "24";
type RecentEmoteScope = "7tv" | "all";

const props = defineProps<{
	ctx: ChannelContext;
	anchorEl: HTMLElement;
}>();

const emit = defineEmits<{
	(event: "close"): void;
	(event: "clickout", native: PointerEvent): void;
}>();

const middleware = [offset({ mainAxis: 10 }), shift({ padding: 8 })];
const showModifiers = useConfig<boolean>("chat.show_emote_modifiers", false);
const compactTooltips = useConfig<boolean>("ui.compact_tooltips", false);
const recentEmoteMode = useConfig<RecentEmoteBarMode>("chat.recent_emote_bar.mode", "recent");
const recentEmoteScope = useConfig<RecentEmoteScope>("chat.recent_emote_bar.scope", "7tv");
const tverinoAutoSave = useConfig<boolean>("chat.tverino.auto_save", false);
const deletedMessages = useConfig<DeletedMessageMode>("chat.deleted_messages", 1);
const chatTimestamps = useConfig<boolean>("chat.tverino.timestamps", false);
const displaySeconds = useConfig<boolean>("chat.timestamp_with_seconds", false);
const timestampFormat = useConfig<TimestampFormatKey>("chat.timestamp_format", "infer");
const mentionStyle = useConfig<MentionStyle>("chat.colored_mentions", 1);
const recentSentEmotes = useRecentSentEmotes();
const emoteBarExpanded = ref(false);
const clearMostUsedChannelName = ref("");
const emoteBarFeedback = ref("");
const emoteBarFeedbackError = ref(false);

const channelLabel = computed(() => props.ctx.displayName || props.ctx.username || "Channel");
const showModeratorSection = computed(
	() => props.ctx.actor.roles.has("MODERATOR") || props.ctx.actor.roles.has("BROADCASTER"),
);
const moderatorSectionDescription = computed(() => {
	if (props.ctx.actor.roles.has("BROADCASTER")) {
		return "Reflects the current channel modes because you are the broadcaster.";
	}

	return "Reflects the current channel modes because you are a moderator.";
});
const moderatorStateRows = computed<ModeratorStateRow[]>(() => {
	if (!props.ctx.roomState.loaded) return [];

	return [
		{
			id: "slow-mode",
			label: "Slow Mode",
			value: formatSlowMode(props.ctx.roomState.slowModeEnabled, props.ctx.roomState.slowModeDuration),
		},
		{
			id: "followers-only",
			label: "Followers-Only Chat",
			value: formatFollowersOnlyMode(
				props.ctx.roomState.followersOnlyEnabled,
				props.ctx.roomState.followersOnlyDuration,
			),
		},
		{
			id: "subscribers-only",
			label: "Subscribers-Only Chat",
			value: formatModeToggle(props.ctx.roomState.subscribersOnly),
		},
		{
			id: "emote-only",
			label: "Emote-Only Chat",
			value: formatModeToggle(props.ctx.roomState.emoteOnly),
		},
		{
			id: "unique-chat",
			label: "Unique Chat",
			value: formatModeToggle(props.ctx.roomState.uniqueChatEnabled),
		},
	];
});

const settingsRows = computed<SettingsRow[]>(() => {
	const rows = [
		{
			id: "show-modifiers",
			label: "Show Emote Modifiers",
			kind: "toggle",
			enabled: showModifiers.value,
			action: () => {
				showModifiers.value = !showModifiers.value;
			},
		},
		{
			id: "compact-tooltips",
			label: "Compact Tooltips",
			kind: "toggle",
			enabled: compactTooltips.value,
			action: () => {
				compactTooltips.value = !compactTooltips.value;
			},
		},
		{
			id: "chat-timestamps",
			label: "Chat Timestamps",
			kind: "toggle",
			enabled: chatTimestamps.value,
			action: () => {
				chatTimestamps.value = !chatTimestamps.value;
			},
		},
		{
			id: "auto-save",
			label: "Auto Save Settings",
			kind: "toggle",
			enabled: tverinoAutoSave.value,
			action: () => {
				tverinoAutoSave.value = !tverinoAutoSave.value;
			},
		},
		{
			id: "deleted-messages",
			label: "Deleted Messages",
			kind: "value",
			value: formatDeletedMessageDisplay(deletedMessages.value),
			action: () => {
				deletedMessages.value = cycleValue<DeletedMessageMode>(deletedMessages.value, [0, 1, 2, 3]);
			},
		},
		{
			id: "timestamp-seconds",
			label: "Timestamp Seconds",
			kind: "toggle",
			enabled: displaySeconds.value,
			action: () => {
				displaySeconds.value = !displaySeconds.value;
			},
		},
		{
			id: "timestamp-format",
			label: "Timestamp Format",
			kind: "value",
			value: formatTimestampFormat(timestampFormat.value),
			action: () => {
				timestampFormat.value = cycleValue<TimestampFormatKey>(timestampFormat.value, ["infer", "12", "24"]);
			},
		},
		{
			id: "mention-style",
			label: "Mention Style",
			kind: "value",
			value: formatMentionStyle(mentionStyle.value),
			action: () => {
				mentionStyle.value = cycleValue<MentionStyle>(mentionStyle.value, [0, 1, 2]);
			},
		},
	] satisfies SettingsRow[];

	return rows;
});

function cycleValue<T>(value: T, values: readonly T[]): T {
	const index = values.indexOf(value);
	return values[(index + 1 + values.length) % values.length]!;
}

function cycleRecentEmoteMode(): void {
	recentEmoteMode.value = cycleValue<RecentEmoteBarMode>(recentEmoteMode.value, [
		"none",
		"recent",
		"most_used",
		"combine",
	]);
	clearEmoteBarFeedback();
}

function toggleRecentEmoteScope(): void {
	recentEmoteScope.value = recentEmoteScope.value === "7tv" ? "all" : "7tv";
	clearEmoteBarFeedback();
}

function clearEmoteBarFeedback(): void {
	emoteBarFeedback.value = "";
	emoteBarFeedbackError.value = false;
}

function setEmoteBarFeedback(message: string, error = false): void {
	emoteBarFeedback.value = message;
	emoteBarFeedbackError.value = error;
}

function normalizeChannelName(value: string): string {
	return value.trim().replace(/^@/, "").toLowerCase();
}

function handleClearAllEmoteHistory(): void {
	recentSentEmotes.clearAll();
	clearMostUsedChannelName.value = "";
	setEmoteBarFeedback("Cleared recent and most-used emotes.");
}

function handleClearMostUsedByChannelName(): void {
	const rawChannelName = clearMostUsedChannelName.value.trim();
	const normalizedChannelName = normalizeChannelName(rawChannelName);
	if (!normalizedChannelName) {
		setEmoteBarFeedback("Enter a channel name first.", true);
		return;
	}

	const currentChannelNames = [
		props.ctx.id,
		props.ctx.username,
		props.ctx.displayName,
	]
		.filter((value): value is string => !!value)
		.map((value) => normalizeChannelName(value));
	const didClear =
		currentChannelNames.includes(normalizedChannelName)
			? recentSentEmotes.clearMostUsed(props.ctx.id)
			: recentSentEmotes.clearMostUsedByChannelName(rawChannelName);

	if (!didClear) {
		setEmoteBarFeedback(`No most-used emotes found for ${rawChannelName}.`, true);
		return;
	}

	clearMostUsedChannelName.value = "";
	setEmoteBarFeedback(`Cleared most-used emotes for ${rawChannelName}.`);
}

function formatDeletedMessageDisplay(value: DeletedMessageMode): string {
	switch (value) {
		case 0:
			return "Hidden";
		case 2:
			return "Strikethrough";
		case 3:
			return "Keep";
		default:
			return "Dimmed";
	}
}

function formatRecentEmoteMode(value: RecentEmoteBarMode): string {
	switch (value) {
		case "none":
			return "Disabled";
		case "most_used":
			return "Most Used";
		case "combine":
			return "Combined";
		default:
			return "Recent";
	}
}

function formatRecentEmoteScope(value: RecentEmoteScope): string {
	return value === "7tv" ? "7TV Emotes" : "7TV + Twitch Emotes";
}

function formatTimestampFormat(value: TimestampFormatKey): string {
	switch (value) {
		case "12":
			return "12-Hour";
		case "24":
			return "24-Hour";
		default:
			return "Infer";
	}
}

function formatMentionStyle(value: MentionStyle): string {
	switch (value) {
		case 0:
			return "Default";
		case 2:
			return "Painted";
		default:
			return "Colored";
	}
}

function formatModeToggle(enabled: boolean): string {
	return enabled ? "On" : "Off";
}

function formatSlowMode(enabled: boolean, duration: number): string {
	if (!enabled || duration <= 0) return "Off";
	if (duration < 60) return `${duration}s`;
	if (duration % 60 === 0) return `${duration / 60}m`;

	const minutes = Math.floor(duration / 60);
	const seconds = duration % 60;
	return `${minutes}m ${seconds}s`;
}

function formatFollowersOnlyMode(enabled: boolean, duration: number): string {
	if (!enabled) return "Off";
	if (duration <= 0) return "Any follower";
	if (duration < 60) return `${duration}m`;
	if (duration % 60 === 0) return `${duration / 60}h`;

	const hours = Math.floor(duration / 60);
	const minutes = duration % 60;
	return `${hours}h ${minutes}m`;
}
</script>

<style scoped lang="scss">
.seventv-tverino-settings-panel {
	width: 31rem;
	max-width: min(31rem, calc(100vw - 1.6rem));
	padding: 1.5rem 0;
	border: 0.1rem solid rgb(255 255 255 / 0.14);
	border-radius: 0.8rem;
	background: rgb(14 14 16 / 98%);
	box-shadow: 0 1.8rem 4rem rgb(0 0 0 / 46%);
	backdrop-filter: blur(10px);
}

.panel-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1.2rem;
	padding: 0 1.6rem 1.4rem;
	border-bottom: 0.1rem solid rgb(255 255 255 / 0.08);
}

.panel-title-wrap {
	min-width: 0;

	h3 {
		margin: 0;
		color: #fff;
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.2;
	}

	p {
		margin: 0.45rem 0 0;
		color: rgb(255 255 255 / 0.62);
		font-size: 1.25rem;
		line-height: 1.35;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
}

.panel-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 2.8rem;
	height: 2.8rem;
	border-radius: 999px;
	color: rgb(255 255 255 / 0.72);
	font-size: 2rem;
	line-height: 1;
	transition:
		background-color 120ms ease,
		color 120ms ease;

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.08);
		color: #fff;
	}
}

.panel-section {
	padding: 1.35rem 1.6rem 0;
}

.panel-section-title {
	margin-bottom: 1rem;
	color: rgb(255 255 255 / 0.74);
	font-size: 1.2rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.panel-section-description {
	margin: 0 0 1.1rem;
	color: rgb(255 255 255 / 0.6);
	font-size: 1.25rem;
	line-height: 1.45;
}

.panel-rows {
	display: grid;
	gap: 0.5rem;
}

.panel-subsection {
	display: grid;
	gap: 0.55rem;
	margin-bottom: 0.75rem;
}

.panel-subrows {
	display: grid;
	gap: 0.5rem;
	padding: 0.55rem 0 0 1rem;
	border-left: 0.1rem solid rgb(255 255 255 / 0.08);
}

.panel-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.2rem;
	min-height: 3.4rem;
	padding: 0.2rem 0;
}

.panel-row-button {
	width: 100%;
	border: 0;
	background: transparent;
	border-radius: 0.45rem;
	text-align: left;
	cursor: pointer;
	transition: background-color 120ms ease;

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.05);
	}
}

.panel-row-expand {
	padding-inline: 0.2rem;
}

.panel-row-static {
	padding-inline: 0.2rem;
}

.panel-label {
	flex: 1 1 auto;
	color: #fff;
	font-size: 1.45rem;
	line-height: 1.35;
}

.panel-value {
	flex: 0 0 auto;
	color: rgb(255 255 255 / 0.76);
	font-size: 1.4rem;
	font-weight: 600;
	text-align: right;

	&.interactive::after {
		content: " >";
		color: rgb(255 255 255 / 0.38);
	}
}

.panel-expand-meta {
	display: inline-flex;
	align-items: center;
	gap: 0.85rem;
	flex: 0 0 auto;
}

.panel-chevron {
	color: rgb(255 255 255 / 0.5);
	font-size: 1.9rem;
	line-height: 1;
	transform: rotate(0deg);
	transition: transform 120ms ease;

	&.open {
		transform: rotate(90deg);
	}
}

.panel-channel-clear {
	display: grid;
	gap: 0.55rem;
	padding: 0.1rem 0 0.15rem;
}

.panel-channel-clear-label {
	color: rgb(255 255 255 / 0.76);
	font-size: 1.28rem;
	font-weight: 600;
	line-height: 1.35;
}

.panel-channel-clear-input-row {
	display: flex;
	align-items: center;
	gap: 0.65rem;
}

.panel-channel-clear-input {
	flex: 1 1 auto;
	min-width: 0;
	height: 3.2rem;
	padding: 0 1rem;
	border: 0.1rem solid rgb(255 255 255 / 0.12);
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.03);
	color: #fff;
	font-size: 1.32rem;
	transition:
		border-color 120ms ease,
		background-color 120ms ease;

	&::placeholder {
		color: rgb(255 255 255 / 0.44);
	}

	&:hover,
	&:focus {
		border-color: rgb(255 255 255 / 0.22);
		background: rgb(255 255 255 / 0.05);
		outline: none;
	}
}

.panel-channel-clear-button {
	flex: 0 0 auto;
	height: 3.2rem;
	padding: 0 1rem;
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.07);
	color: #fff;
	font-size: 1.25rem;
	font-weight: 700;
	transition: background-color 120ms ease;

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.12);
	}
}

.panel-badge-list {
	display: grid;
	gap: 0.55rem;
	max-height: 22rem;
	overflow: auto;
	padding-right: 0.2rem;
}

.panel-badge-option {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.2rem;
	width: 100%;
	min-height: 4.4rem;
	padding: 0.7rem 0.9rem;
	border: 0.1rem solid rgb(255 255 255 / 0.08);
	border-radius: 0.6rem;
	background: rgb(255 255 255 / 0.025);
	text-align: left;
	transition:
		border-color 120ms ease,
		background-color 120ms ease;

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.18);
		background: rgb(255 255 255 / 0.05);
	}

	&.selected {
		border-color: rgb(145 71 255 / 0.5);
		background: rgb(145 71 255 / 0.12);
	}

	&:disabled {
		cursor: wait;
	}
}

.panel-badge-main {
	display: flex;
	align-items: center;
	gap: 1rem;
	min-width: 0;
}

.panel-badge-image {
	flex: 0 0 auto;
	width: 2.4rem;
	height: 2.4rem;
	object-fit: contain;
}

.panel-badge-copy {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.panel-badge-title {
	color: #fff;
	font-size: 1.3rem;
	font-weight: 600;
	line-height: 1.25;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.panel-badge-meta {
	color: rgb(255 255 255 / 0.52);
	font-size: 1.15rem;
	line-height: 1.25;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.panel-badge-state {
	flex: 0 0 auto;
	color: rgb(255 255 255 / 0.7);
	font-size: 1.15rem;
	font-weight: 600;
	line-height: 1.25;
}

.panel-feedback,
.panel-empty {
	margin: 0 0 1rem;
	font-size: 1.2rem;
	line-height: 1.45;
}

.panel-feedback {
	color: rgb(165 243 252 / 0.88);

	&.error {
		color: rgb(254 202 202 / 0.9);
	}
}

.panel-empty {
	color: rgb(255 255 255 / 0.54);
}

.panel-toggle {
	position: relative;
	display: inline-flex;
	align-items: center;
	flex: 0 0 auto;
	width: 3.8rem;
	height: 2.2rem;
	padding: 0.2rem;
	border-radius: 999px;
	background: rgb(255 255 255 / 0.18);
	transition: background-color 120ms ease;

	&.on {
		background: var(--seventv-primary, #9147ff);
	}
}

.panel-toggle-thumb {
	display: block;
	width: 1.8rem;
	height: 1.8rem;
	border-radius: 999px;
	background: #fff;
	box-shadow: 0 0.2rem 0.45rem rgb(0 0 0 / 0.24);
	transform: translateX(0);
	transition: transform 120ms ease;

	.panel-toggle.on & {
		transform: translateX(1.6rem);
	}
}
</style>
