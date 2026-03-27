<template>
	<div class="seventv-channel-cosmetics-settings">
		<section class="settings-card settings-card-combined">
			<div class="settings-card-section">
				<header class="settings-card-header">
					<div class="settings-card-header-copy">
						<h4>Set Default Cosmetics</h4>
						<p>Used whenever the active channel does not have its own override.</p>
					</div>
					<div v-if="showInventorySummary" class="settings-card-header-meta">
						<p class="settings-card-header-meta-copy" :class="{ loading: inventoryState.inventoryLoading }">
							{{ inventorySummaryText }}
						</p>
						<button
							class="secondary-button header-refresh-button"
							type="button"
							:disabled="inventoryState.inventoryLoading"
							@click="handleRefreshInventory"
						>
							{{ inventoryState.inventoryLoading ? "Loading..." : "Refresh" }}
						</button>
					</div>
				</header>

				<div class="settings-card-body settings-card-body-default">
					<div v-if="needsSevenTVLogin" class="sign-in-notice">
						<p class="notice error">{{ sevenTVLoginNotice }}</p>
						<button class="secondary-button sign-in-button" type="button" @click="handleSevenTVLogin">
							{{ isAuthenticatingWithSevenTV ? "Waiting for 7TV..." : "Log in to 7TV" }}
						</button>
					</div>
					<p v-else-if="inventoryState.inventoryError" class="notice error">
						{{ inventoryState.inventoryError }}
					</p>
					<p v-if="defaultFeedback" class="feedback" :class="{ error: defaultFeedbackError }">
						{{ defaultFeedback }}
					</p>

					<div class="default-cosmetics-panel">
						<div class="default-cosmetics-row">
							<span class="settings-field-label">Paint</span>
							<ChannelSpecific7TVCosmeticsPicker
								v-model="defaultPaintSelection"
								kind="PAINT"
								:options="inventoryState.paints"
								:disabled="!canEditSelections"
								none-label="None"
								:fallback-label="resolvePaintLabel(defaultPaintSelection)"
							/>
						</div>

						<div class="default-cosmetics-row">
							<span class="settings-field-label">Badge</span>
							<ChannelSpecific7TVCosmeticsPicker
								v-model="defaultBadgeSelection"
								kind="BADGE"
								:options="inventoryState.badges"
								:disabled="!canEditSelections"
								none-label="None"
								:fallback-label="resolveBadgeLabel(defaultBadgeSelection)"
							/>
						</div>
					</div>
				</div>
			</div>

			<div class="settings-card-section">
				<header class="settings-card-header">
					<div class="settings-card-header-copy">
						<h4>Channel Specific 7TV Cosmetics</h4>
						<p>
							Type a Twitch channel name, add it to the list, then assign paint and badge overrides for
							that channel.
						</p>
					</div>
				</header>

				<div class="settings-card-body override-list">
					<p v-if="showDefaultsRequiredNotice" class="notice warning override-lock-notice">
						You need to select a default paint and badge.
					</p>

					<div class="override-list-content" :class="{ locked: isChannelOverridesLocked }">
						<p
							v-if="overrideFeedback"
							class="feedback override-inline-feedback"
							:class="{ error: overrideFeedbackError }"
						>
							{{ overrideFeedback }}
						</p>
						<div class="channel-add-row">
							<input
								v-model="channelName"
								class="channel-input"
								type="text"
								placeholder="Type a channel name"
								autocomplete="off"
								:disabled="isAddingChannel || isChannelOverridesLocked"
								@keydown.enter.prevent="handleAddChannel"
							/>
							<button
								class="secondary-button"
								type="button"
								:disabled="isAddingChannel || isChannelOverridesLocked"
								@click="handleAddChannel"
							>
								{{ isAddingChannel ? "Adding..." : "Add Channel" }}
							</button>
						</div>

						<div v-if="overrideRows.length" class="override-list-grid">
							<div class="override-list-header">
								<span>Channel</span>
								<span>Paint</span>
								<span>Badge</span>
								<span class="override-action-header" aria-hidden="true"></span>
							</div>

							<div v-for="entry of overrideRows" :key="entry.channelID" class="override-row">
								<div class="channel-cell">
									<a
										class="channel-display-name"
										:href="`https://www.twitch.tv/${entry.channelLogin}`"
										target="_blank"
										rel="noopener noreferrer"
										:tabindex="isChannelOverridesLocked ? -1 : undefined"
										:aria-disabled="isChannelOverridesLocked ? 'true' : 'false'"
									>
										{{ entry.channelDisplayName }}
									</a>

									<div v-if="viewerPreviewName" class="channel-preview">
										<span v-if="entry.previewBadge" class="channel-preview-badge-shell">
											<img
												class="channel-preview-badge-image"
												:src="resolvePreviewBadgeSrc(entry.previewBadge)"
												:srcset="buildPreviewBadgeSrcset(entry.previewBadge)"
												:alt="entry.previewBadge.data.name"
											/>
										</span>

										<span class="channel-preview-label-shell">
											<ChannelSpecific7TVCosmeticsPaintLabel
												v-if="entry.previewPaint"
												class="channel-preview-label"
												:paint="entry.previewPaint"
												:label="viewerPreviewName"
											/>

											<span v-else class="channel-preview-label">
												{{ viewerPreviewName }}
											</span>
										</span>
									</div>
								</div>

								<div class="cosmetic-cell">
									<ChannelSpecific7TVCosmeticsPicker
										:model-value="entry.paintID"
										kind="PAINT"
										:options="inventoryState.paints"
										:disabled="!canEditOverrideSelections"
										:default-value="CHANNEL_COSMETICS_DEFAULT_VALUE"
										default-label="Default"
										none-label="None"
										:fallback-label="resolvePaintLabel(entry.paintID)"
										@update:model-value="updateOverridePaint(entry.channelID, $event)"
									/>
								</div>

								<div class="cosmetic-cell">
									<ChannelSpecific7TVCosmeticsPicker
										:model-value="entry.badgeID"
										kind="BADGE"
										:options="inventoryState.badges"
										:disabled="!canEditOverrideSelections"
										:default-value="CHANNEL_COSMETICS_DEFAULT_VALUE"
										default-label="Default"
										none-label="None"
										:fallback-label="resolveBadgeLabel(entry.badgeID)"
										@update:model-value="updateOverrideBadge(entry.channelID, $event)"
									/>
								</div>

								<div class="override-action-cell">
									<button
										class="danger-button"
										type="button"
										:disabled="isChannelOverridesLocked"
										@click="removeOverride(entry.channelID)"
									>
										Remove
									</button>
								</div>
							</div>
						</div>

						<p v-else class="empty-state">No channel overrides yet.</p>
					</div>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { imageHostToSrcset, resolve7TVBadgeFormat, resolveImageHostSrc } from "@/common/Image";
import { decodeJWT } from "@/common/Jwt";
import { useApollo } from "@/composable/useApollo";
import { useConfig } from "@/composable/useSettings";
import { useUserAgent } from "@/composable/useUserAgent";
import { twitchChannelLookupQuery } from "@/assets/gql/tw.channel-lookup.gql";
import ChannelSpecific7TVCosmeticsPaintLabel from "./ChannelSpecific7TVCosmeticsPaintLabel.vue";
import ChannelSpecific7TVCosmeticsPicker from "./ChannelSpecific7TVCosmeticsPicker.vue";
import { CHANNEL_COSMETICS_DEFAULT_VALUE, useTVerinoChannelCosmetics } from "../useTVerinoChannelCosmetics";

const apollo = useApollo();
const { identity } = storeToRefs(useStore());
const { preferredFormat } = useUserAgent();
const defaultPaintSelection = useConfig<string>("chat.tverino.channel_cosmetics_default_paint_id", "");
const defaultBadgeSelection = useConfig<string>("chat.tverino.channel_cosmetics_default_badge_id", "");
const channelOverrides = useConfig<Map<string, SevenTV.TVerinoChannelCosmeticOverride>>(
	"chat.tverino.channel_cosmetics_overrides",
	new Map(),
);
const sevenTVToken = useConfig<string>("app.7tv.token", "");

const { state: inventoryState, refreshInventory, resolveChannelCosmeticSelection } = useTVerinoChannelCosmetics();

const channelName = ref("");
const isAddingChannel = ref(false);
const defaultFeedback = ref("");
const defaultFeedbackError = ref(false);
const overrideFeedback = ref("");
const overrideFeedbackError = ref(false);
const isAuthenticatingWithSevenTV = ref(false);
const sevenTVAuthPopup = ref<Window | null>(null);
const sevenTVAuthSource = `${import.meta.env.VITE_APP_SITE}/extension/auth`;
let sevenTVAuthInterval: number | null = null;

const canEditSelections = computed(
	() => !!sevenTVToken.value.trim() && !inventoryState.inventoryLoading && !inventoryState.inventoryError,
);
const hasConfiguredDefaultSelections = computed(
	() => !!defaultPaintSelection.value.trim() && !!defaultBadgeSelection.value.trim(),
);
const isChannelOverridesLocked = computed(() => !canEditSelections.value || !hasConfiguredDefaultSelections.value);
const canEditOverrideSelections = computed(() => canEditSelections.value && hasConfiguredDefaultSelections.value);
const showDefaultsRequiredNotice = computed(() => canEditSelections.value && !hasConfiguredDefaultSelections.value);
const needsSevenTVLogin = computed(() => !sevenTVToken.value.trim());
const showInventorySummary = computed(() => !!sevenTVToken.value.trim() && !inventoryState.inventoryError);
const inventorySummaryText = computed(() =>
	inventoryState.inventoryLoading
		? "Loading owned cosmetics..."
		: `Owned: ${inventoryState.paints.length} paints / ${inventoryState.badges.length} badges`,
);
const sevenTVLoginNotice = computed(
	() => inventoryState.inventoryError || "Log in to 7TV to manage channel-specific cosmetics.",
);
const paintOptionsByID = computed(() => new Map(inventoryState.paints.map((paint) => [paint.id, paint] as const)));
const badgeOptionsByID = computed(() => new Map(inventoryState.badges.map((badge) => [badge.id, badge] as const)));
const viewerPreviewName = computed(() => {
	const currentIdentity = identity.value;
	if (!currentIdentity) return "";

	if ("displayName" in currentIdentity && currentIdentity.displayName?.trim()) {
		return currentIdentity.displayName.trim();
	}

	return currentIdentity.username?.trim() || "";
});
const overrideRows = computed(() =>
	Array.from(channelOverrides.value.values())
		.sort(
			(left, right) =>
				left.channelDisplayName.localeCompare(right.channelDisplayName) ||
				left.channelLogin.localeCompare(right.channelLogin),
		)
		.map((entry) => {
			const selection = resolveChannelCosmeticSelection(entry.channelID);
			return {
				...entry,
				previewPaint: resolvePaintOption(selection.paintID),
				previewBadge: resolveBadgeOption(selection.badgeID),
			};
		}),
);

onMounted(() => {
	void refreshInventory();
});

onUnmounted(() => {
	stopSevenTVLoginHandshake();
	sevenTVAuthPopup.value?.close();
});

async function handleRefreshInventory(): Promise<void> {
	clearDefaultFeedback();
	await refreshInventory(true);
}

function handleSevenTVLogin(): void {
	if (sevenTVToken.value.trim()) return;
	clearDefaultFeedback();

	if (sevenTVAuthPopup.value && !sevenTVAuthPopup.value.closed) {
		sevenTVAuthPopup.value.focus();
		return;
	}

	const popup = window.open(sevenTVAuthSource, "7tv-auth", "width=400,height=600");
	if (!popup) {
		setDefaultFeedback("Unable to open the 7TV sign-in window.", true);
		return;
	}

	sevenTVAuthPopup.value = popup;
	isAuthenticatingWithSevenTV.value = true;
	window.addEventListener("message", onSevenTVAuthMessage);

	stopSevenTVLoginInterval();
	sevenTVAuthInterval = window.setInterval(() => {
		if (!sevenTVAuthPopup.value || sevenTVAuthPopup.value.closed) {
			stopSevenTVLoginHandshake();
			return;
		}

		sevenTVAuthPopup.value.postMessage("7tv-token-request", "*");
	}, 100);
}

async function onSevenTVAuthMessage(event: MessageEvent): Promise<void> {
	if (event.data?.type !== "7tv-token" || !event.data.token) return;

	stopSevenTVLoginHandshake();
	sevenTVAuthPopup.value?.close();

	const nextToken = String(event.data.token);
	if ((decodeJWT(nextToken)?.exp ?? 0) * 1000 < Date.now()) {
		setDefaultFeedback("The 7TV session is expired. Sign out of 7TV and then sign back in.", true);
		return;
	}

	sevenTVToken.value = nextToken;
	await refreshInventory(true);
}

async function handleAddChannel(): Promise<void> {
	clearOverrideFeedback();

	if (isChannelOverridesLocked.value) {
		setOverrideFeedback("You need to select a default paint and badge.", true);
		return;
	}

	const login = channelName.value.trim().replace(/^@+/, "").toLowerCase();
	if (!login) {
		setOverrideFeedback("Enter a channel name first.", true);
		return;
	}

	if (!apollo.value) {
		setOverrideFeedback("Twitch GraphQL client unavailable.", true);
		return;
	}

	for (const entry of channelOverrides.value.values()) {
		if (entry.channelLogin.toLowerCase() === login) {
			setOverrideFeedback(`#${login} is already in the list.`, true);
			return;
		}
	}

	isAddingChannel.value = true;

	try {
		const response = await apollo.value.query<
			twitchChannelLookupQuery.Response,
			twitchChannelLookupQuery.Variables
		>({
			query: twitchChannelLookupQuery,
			variables: {
				login,
			},
			fetchPolicy: "network-only",
		});

		const user = response.data?.user;
		if (!user?.id) {
			setOverrideFeedback(`Unable to resolve #${login}.`, true);
			return;
		}

		const nextOverrides = new Map(channelOverrides.value);
		nextOverrides.set(user.id, {
			channelID: user.id,
			channelLogin: user.login.toLowerCase(),
			channelDisplayName: user.displayName || user.login,
			paintID: CHANNEL_COSMETICS_DEFAULT_VALUE,
			badgeID: CHANNEL_COSMETICS_DEFAULT_VALUE,
		});
		channelOverrides.value = nextOverrides;
		channelName.value = "";
		clearOverrideFeedback();
	} catch {
		setOverrideFeedback(`Unable to resolve #${login}.`, true);
	} finally {
		isAddingChannel.value = false;
	}
}

function updateOverridePaint(channelID: string, paintID: string): void {
	updateOverride(channelID, {
		paintID,
	});
}

function updateOverrideBadge(channelID: string, badgeID: string): void {
	updateOverride(channelID, {
		badgeID,
	});
}

function updateOverride(channelID: string, partial: Partial<SevenTV.TVerinoChannelCosmeticOverride>): void {
	if (isChannelOverridesLocked.value) return;

	const current = channelOverrides.value.get(channelID);
	if (!current) return;

	const nextOverrides = new Map(channelOverrides.value);
	nextOverrides.set(channelID, {
		...current,
		...partial,
	});
	channelOverrides.value = nextOverrides;
}

function removeOverride(channelID: string): void {
	if (isChannelOverridesLocked.value) return;

	const nextOverrides = new Map(channelOverrides.value);
	const removed = nextOverrides.delete(channelID);
	if (!removed) return;

	channelOverrides.value = nextOverrides;
	clearOverrideFeedback();
}

function resolvePaintOption(paintID: string): SevenTV.Cosmetic<"PAINT"> | null {
	return paintOptionsByID.value.get(paintID) ?? null;
}

function resolveBadgeOption(badgeID: string): SevenTV.Cosmetic<"BADGE"> | null {
	return badgeOptionsByID.value.get(badgeID) ?? null;
}

function resolvePaintLabel(paintID: string): string {
	if (paintID === CHANNEL_COSMETICS_DEFAULT_VALUE) return "Default";
	if (!paintID) return "None";

	const paint = resolvePaintOption(paintID);
	return paint?.data.name || `Saved paint (${shortID(paintID)})`;
}

function resolveBadgeLabel(badgeID: string): string {
	if (badgeID === CHANNEL_COSMETICS_DEFAULT_VALUE) return "Default";
	if (!badgeID) return "None";

	const badge = resolveBadgeOption(badgeID);
	return badge?.data.name || `Saved badge (${shortID(badgeID)})`;
}

function buildPreviewBadgeSrcset(badge: SevenTV.Cosmetic<"BADGE">): string {
	const format = resolve7TVBadgeFormat(badge.data.host, preferredFormat);
	return badge.data.host.srcset ?? imageHostToSrcset(badge.data.host, "7TV", format);
}

function resolvePreviewBadgeSrc(badge: SevenTV.Cosmetic<"BADGE">): string {
	return resolveImageHostSrc(badge.data.host, "7TV", resolve7TVBadgeFormat(badge.data.host, preferredFormat));
}

function shortID(value: string): string {
	return value.length > 8 ? value.slice(0, 8) : value;
}

function clearDefaultFeedback(): void {
	defaultFeedback.value = "";
	defaultFeedbackError.value = false;
}

function setDefaultFeedback(message: string, error = false): void {
	defaultFeedback.value = message;
	defaultFeedbackError.value = error;
}

function clearOverrideFeedback(): void {
	overrideFeedback.value = "";
	overrideFeedbackError.value = false;
}

function setOverrideFeedback(message: string, error = false): void {
	overrideFeedback.value = message;
	overrideFeedbackError.value = error;
}

function stopSevenTVLoginHandshake(): void {
	stopSevenTVLoginInterval();
	window.removeEventListener("message", onSevenTVAuthMessage);
	isAuthenticatingWithSevenTV.value = false;
}

function stopSevenTVLoginInterval(): void {
	if (sevenTVAuthInterval === null) return;

	window.clearInterval(sevenTVAuthInterval);
	sevenTVAuthInterval = null;
}
</script>

<style scoped lang="scss">
.seventv-channel-cosmetics-settings {
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

.settings-card-combined {
	display: grid;
	gap: 0;
}

.settings-card-section + .settings-card-section {
	border-top: 0.01rem solid var(--seventv-border-transparent-1);
}

.settings-card-header {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.9rem 1rem;
	border-bottom: 0.01rem solid var(--seventv-border-transparent-1);
	background: rgb(0 0 0 / 0.18);
}

.settings-card-header-copy {
	display: grid;
	gap: 0.3rem;
	min-width: 0;

	h4,
	p {
		margin: 0;
	}

	h4 {
		color: var(--seventv-text-color-normal);
		font-size: 1.05rem;
		font-weight: 700;
	}

	p {
		color: var(--seventv-text-color-secondary);
		line-height: 1.35;
	}
}

.settings-card-header-meta {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	margin-left: auto;
	align-self: flex-start;
	margin-top: -0.1rem;

	.header-refresh-button {
		min-height: 2.25rem;
		padding: 0.28rem 0.72rem;
		font-size: 0.84rem;
		white-space: nowrap;
	}
}

.settings-card-header-meta-copy {
	margin: 0;
	color: #9ef3c5;
	font-size: 0.86rem;
	font-weight: 700;
	line-height: 1.2;
	text-align: right;

	&.loading {
		color: var(--seventv-text-color-secondary);
	}
}

.settings-card-body {
	display: grid;
	gap: 1rem;
	padding: 0.92rem;
}

.settings-card-body-default {
	gap: 0.85rem;
}

.settings-field {
	display: grid;
	gap: 0.65rem;
	min-width: 0;
}

.default-cosmetics-panel {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	border: 0.01rem solid var(--seventv-input-border);
	border-radius: 0.45rem;
	background: var(--seventv-input-background);
	overflow: hidden;
}

.default-cosmetics-row {
	display: grid;
	gap: 0.5rem;
	min-width: 0;
	padding: 0.62rem 0.78rem;
}

.default-cosmetics-row + .default-cosmetics-row {
	border-left: 0.01rem solid var(--seventv-border-transparent-1);
}

.default-cosmetics-row :deep(.picker-trigger) {
	min-height: 3.08rem;
	padding: 0.18rem 0;
	border: 0;
	border-radius: 0;
	background: transparent;
}

.default-cosmetics-row :deep(.picker-trigger:hover),
.default-cosmetics-row :deep(.picker-trigger:focus-visible),
.default-cosmetics-row :deep(.picker-trigger.open) {
	border-color: transparent;
	background: transparent;
}

.default-cosmetics-row :deep(.picker-trigger-copy) {
	padding: 0;
}

.default-cosmetics-row :deep(.picker-label) {
	font-size: 1.3rem;
	line-height: 1.22;
}

.default-cosmetics-row :deep(.picker-badge-shell) {
	width: 2.08rem;
	height: 2.08rem;
}

.default-cosmetics-row :deep(.picker-badge-image) {
	width: 1.74rem;
	height: 1.74rem;
}

.default-cosmetics-row:last-child :deep(.picker-label) {
	font-size: 1.12rem;
	line-height: 1.32;
	transform: translate(-2px, -1px);
	overflow: visible;
}

.default-cosmetics-row:last-child :deep(.picker-trigger) {
	min-height: 3.18rem;
	overflow: visible;
}

.default-cosmetics-row:last-child :deep(.picker-trigger-copy),
.default-cosmetics-row:last-child :deep(.picker-label-shell) {
	padding-top: 0.08rem;
	padding-bottom: 0.08rem;
	overflow: visible;
}

.default-cosmetics-row:last-child :deep(.picker-trigger-copy) {
	transform: translateY(-1px);
}

.settings-field-label {
	color: var(--seventv-text-color-normal);
	font-size: 1rem;
	font-weight: 700;
	line-height: 1.2;
}

.secondary-button,
.danger-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 3rem;
	padding: 0.66rem 0.92rem;
	border-radius: 0.35rem;
	border: 0.01rem solid var(--seventv-input-border);
	background: hsla(0deg, 0%, 100%, 8%);
	color: var(--seventv-text-color-normal);
	font-size: 0.96rem;
	font-weight: 700;
	cursor: pointer;
	transition:
		background-color 120ms ease,
		border-color 120ms ease,
		opacity 120ms ease;

	&:hover,
	&:focus-visible {
		background: hsla(0deg, 0%, 100%, 12%);
		border-color: color-mix(in srgb, var(--seventv-input-border) 70%, white 18%);
	}

	&:disabled {
		cursor: default;
		opacity: 0.6;
	}
}

.danger-button {
	background: rgb(255 94 94 / 0.08);
	color: #ffc2c2;

	&:hover,
	&:focus-visible {
		background: rgb(255 94 94 / 0.14);
		border-color: rgb(255 148 148 / 0.35);
	}
}

.notice,
.feedback {
	margin: 0;
	font-size: 0.98rem;
}

.notice {
	color: #9ef3c5;
}

.notice.warning {
	color: #ffcf7d;
}

.notice.error,
.feedback.error {
	color: #ff9b9b;
}

.feedback {
	color: #9ef3c5;
}

.override-inline-feedback {
	margin-bottom: -0.1rem;
}

.channel-add-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.68rem;
}

.sign-in-notice {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.85rem;
}

.sign-in-button {
	min-width: 11.5rem;
}

.channel-input {
	min-width: 0;
	height: 3.2rem;
	padding: 0 0.9rem;
	border-radius: 0.35rem;
	border: 0.01rem solid var(--seventv-input-border);
	background: var(--seventv-input-background);
	color: var(--seventv-text-color-normal);
	font-size: 0.98rem;
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

.empty-state,
.override-action-header {
	color: var(--seventv-text-color-secondary);
}

.override-list {
	gap: 0.82rem;
}

.override-list-content {
	display: grid;
	gap: 0.82rem;

	&.locked {
		opacity: 0.52;
		pointer-events: none;
	}
}

.override-lock-notice {
	font-weight: 700;
}

.override-list-grid {
	display: grid;
	gap: 0.72rem;
}

.override-list-header,
.override-row {
	display: grid;
	grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1fr) auto;
	gap: 0.72rem;
}

.override-list-header {
	padding: 0 0.2rem;
	color: var(--seventv-text-color-secondary);
	font-size: 0.86rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.override-row {
	align-items: center;
	padding: 0.8rem;
	border: 0.01rem solid var(--seventv-border-transparent-1);
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.03);
}

.channel-cell,
.cosmetic-cell,
.override-action-cell {
	display: grid;
	min-width: 0;
}

.channel-cell {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.72rem;
	padding-left: 8px;
}

.channel-display-name {
	flex: 0 0 auto;
	color: var(--seventv-text-color-normal);
	font-size: 1.38rem;
	font-weight: 800;
	line-height: 1.22;
	text-decoration: none;

	&:hover,
	&:focus-visible {
		color: #fff;
		text-decoration: underline;
	}
}

.channel-preview {
	display: inline-flex;
	align-items: center;
	gap: 0.68rem;
	min-width: 0;
	max-width: 100%;
	margin-left: calc(0.56rem - 2px);
	padding: 0.45rem calc(0.72rem - 4px) 0.45rem calc(0.66rem - 1px);
	border: 0.01rem solid rgb(255 255 255 / 0.05);
	border-radius: 0.37rem;
	background: rgb(0 0 0 / 0.34);
}

.channel-preview-badge-shell {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 1.78rem;
	height: 1.78rem;
	border-radius: 0.3rem;
	background: rgb(255 255 255 / 0.07);
}

.channel-preview-badge-image {
	width: 1.44rem;
	height: 1.44rem;
	object-fit: contain;
}

.channel-preview-label-shell {
	display: flex;
	align-items: center;
	min-width: 0;
	transform: translateX(-3px);
}

.channel-preview-label {
	display: block;
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--seventv-text-color-normal);
	font-size: 1.2rem;
	font-weight: 800;
	line-height: 1.1;
}

.override-action-cell {
	align-items: center;
	justify-items: end;
}

.override-action-cell .danger-button {
	min-width: 7.8rem;
}

.empty-state {
	margin: 0;
}

@media (width <= 980px) {
	.channel-add-row,
	.override-list-header,
	.override-row {
		grid-template-columns: 1fr;
	}

	.override-list-header {
		display: none;
	}

	.settings-card-header-meta {
		margin-left: 0;
	}

	.settings-card-header-meta-copy {
		text-align: left;
	}
}

@media (width <= 720px) {
	.default-cosmetics-panel {
		grid-template-columns: 1fr;
	}

	.default-cosmetics-row + .default-cosmetics-row {
		border-left: 0;
		border-top: 0.01rem solid var(--seventv-border-transparent-1);
	}
}
</style>
