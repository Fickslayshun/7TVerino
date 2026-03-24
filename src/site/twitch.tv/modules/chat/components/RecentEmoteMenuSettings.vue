<template>
	<div class="seventv-recent-emote-settings">
		<section class="settings-card">
			<header class="settings-card-header">Settings</header>

			<div class="settings-card-body settings-card-body-grid">
				<label class="settings-field">
					<span class="settings-field-label">Mode</span>
					<span class="settings-select-shell">
						<select v-model="recentEmoteMode" class="settings-select" @change="clearFeedback">
							<option value="none">Disabled</option>
							<option value="recent">Recent</option>
							<option value="most_used">Most Used</option>
							<option value="combine">Combined</option>
						</select>
					</span>
				</label>

				<label class="settings-field">
					<span class="settings-field-label">Emote Scope</span>
					<span class="settings-select-shell">
						<select v-model="recentEmoteScope" class="settings-select" @change="clearFeedback">
							<option value="7tv">7TV Emotes</option>
							<option value="all">7TV + Twitch Emotes</option>
						</select>
					</span>
				</label>
			</div>
		</section>

		<section class="settings-card">
			<header class="settings-card-header">Actions</header>

			<div class="settings-card-body">
				<div class="channel-clear">
					<label class="channel-clear-label" for="seventv-clear-most-used-channel">Clear Most Used (Channel)</label>
					<div class="channel-clear-controls">
						<input
							id="seventv-clear-most-used-channel"
							v-model="channelName"
							class="channel-clear-input"
							type="text"
							placeholder="Type a channel name"
							@keydown.enter.prevent="handleClearMostUsedByChannel"
						/>
						<button class="channel-clear-button" type="button" @click="handleClearMostUsedByChannel">Clear</button>
					</div>
				</div>

				<button class="clear-all-button" type="button" @click="handleClearAll">
					<span class="clear-all-icon" aria-hidden="true">&#8635;</span>
					<span>Clear All</span>
				</button>

				<p v-if="feedback" class="feedback" :class="{ error: feedbackError }">
					{{ feedback }}
				</p>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { RecentEmoteBarMode } from "@/composable/chat/useRecentSentEmotes";
import { useRecentSentEmotes } from "@/composable/chat/useRecentSentEmotes";
import { useConfig } from "@/composable/useSettings";

type RecentEmoteScope = "7tv" | "all";

const recentSentEmotes = useRecentSentEmotes();
const recentEmoteMode = useConfig<RecentEmoteBarMode>("chat.recent_emote_bar.mode", "recent");
const recentEmoteScope = useConfig<RecentEmoteScope>("chat.recent_emote_bar.scope", "7tv");
const channelName = ref("");
const feedback = ref("");
const feedbackError = ref(false);

function clearFeedback(): void {
	feedback.value = "";
	feedbackError.value = false;
}

function setFeedback(message: string, error = false): void {
	feedback.value = message;
	feedbackError.value = error;
}

function handleClearAll(): void {
	recentSentEmotes.clearAll();
	channelName.value = "";
	setFeedback("Cleared recent and most-used emotes.");
}

function handleClearMostUsedByChannel(): void {
	const rawChannelName = channelName.value.trim();
	if (!rawChannelName) {
		setFeedback("Enter a channel name first.", true);
		return;
	}

	const didClear = recentSentEmotes.clearMostUsedByChannelName(rawChannelName);
	if (!didClear) {
		setFeedback(`No most-used emotes found for ${rawChannelName}.`, true);
		return;
	}

	channelName.value = "";
	setFeedback(`Cleared most-used emotes for ${rawChannelName}.`);
}
</script>

<style scoped lang="scss">
.seventv-recent-emote-settings {
	display: grid;
	gap: 1rem;
	padding-top: 0.4rem;
}

.settings-card {
	overflow: hidden;
	border: 0.01rem solid var(--seventv-border-transparent-1);
	border-radius: 0.45rem;
	background: var(--seventv-background-transparent-1);
}

.settings-card-header {
	padding: 0.85rem 1rem;
	border-bottom: 0.01rem solid var(--seventv-border-transparent-1);
	background: rgb(0 0 0 / 0.18);
	color: var(--seventv-text-color-normal);
	font-size: 1.05rem;
	font-weight: 700;
}

.settings-card-body {
	display: grid;
	gap: 1rem;
	padding: 1rem;
}

.settings-card-body-grid {
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 1rem;
}

.settings-field {
	display: grid;
	gap: 0.65rem;
	min-width: 0;
}

.settings-field-label,
.channel-clear-label {
	color: var(--seventv-text-color-normal);
	font-size: 1.1rem;
	font-weight: 700;
	line-height: 1.2;
}

.settings-select-shell {
	position: relative;
	display: flex;
	align-items: stretch;
	width: 100%;
	min-width: 0;
	height: 3.5rem;
	border: 0.01rem solid var(--seventv-input-border);
	border-radius: 0.35rem;
	background: var(--seventv-input-background);
	transition:
		border-color 120ms ease,
		background-color 120ms ease;

	&::after {
		content: "";
		position: absolute;
		top: 50%;
		right: 1rem;
		width: 0.5rem;
		height: 0.5rem;
		border-right: 0.12rem solid var(--seventv-text-color-secondary);
		border-bottom: 0.12rem solid var(--seventv-text-color-secondary);
		transform: translateY(-62%) rotate(45deg);
		pointer-events: none;
	}

	&:hover,
	&:focus-within {
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
	}
}

.settings-select {
	width: 100%;
	min-width: 0;
	height: 100%;
	padding: 0 2.5rem 0 1rem;
	border: 0;
	border-radius: inherit;
	background: transparent;
	color: var(--seventv-text-color-normal);
	font-size: 1.05rem;
	font-weight: 600;
	cursor: pointer;
	outline: none;
	appearance: none;

	&:focus {
		outline: none;
	}
}

.settings-select option {
	background: #1f1f23;
	color: #efeff1;
}

.channel-clear {
	display: grid;
	gap: 0.65rem;
}

.channel-clear-controls {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.75rem;
}

.channel-clear-input {
	min-width: 0;
	height: 3.5rem;
	padding: 0 1rem;
	border-radius: 0.35rem;
	border: 0.01rem solid var(--seventv-input-border);
	background: var(--seventv-input-background);
	color: var(--seventv-text-color-normal);
	font-size: 1.05rem;
	transition:
		border-color 120ms ease,
		background-color 120ms ease;

	&::placeholder {
		color: color-mix(in srgb, var(--seventv-text-color-secondary) 82%, transparent);
	}

	&:hover,
	&:focus {
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
		outline: none;
	}
}

.channel-clear-button {
	height: 3.5rem;
	padding: 0 1.2rem;
	border-radius: 0.35rem;
	border: 0.01rem solid var(--seventv-input-border);
	background: hsla(0deg, 0%, 100%, 8%);
	color: var(--seventv-text-color-normal);
	font-size: 1.05rem;
	font-weight: 700;
	cursor: pointer;
	transition:
		background-color 120ms ease,
		border-color 120ms ease;

	&:hover,
	&:focus-visible {
		background: hsla(0deg, 0%, 100%, 12%);
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
	}
}

.clear-all-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.65rem;
	width: 100%;
	min-height: 3.8rem;
	padding: 0.95rem 1.2rem;
	border-radius: 0.35rem;
	border: 0.01rem solid var(--seventv-input-border);
	background: hsla(0deg, 0%, 100%, 8%);
	color: var(--seventv-text-color-normal);
	font-size: 1.2rem;
	font-weight: 700;
	cursor: pointer;
	transition:
		background-color 120ms ease,
		border-color 120ms ease;

	&:hover,
	&:focus-visible {
		background: hsla(0deg, 0%, 100%, 12%);
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
	}
}

.clear-all-icon {
	font-size: 1.55rem;
	line-height: 1;
}

.feedback {
	margin: -0.2rem 0 0;
	color: #9ef3c5;
	font-size: 0.98rem;
}

.feedback.error {
	color: #ff9b9b;
}

@media (width <= 900px) {
	.settings-card-body-grid,
	.channel-clear-controls {
		grid-template-columns: 1fr;
	}
}
</style>
