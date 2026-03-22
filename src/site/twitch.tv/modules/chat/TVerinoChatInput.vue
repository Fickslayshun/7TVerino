<template>
	<div class="seventv-tverino-input" :class="{ disabled: inputStatus.state !== 'connected' }">
		<div class="seventv-tverino-compose" :class="{ focused: isFocused }">
			<div v-if="showAnyRecentBar" class="seventv-tverino-recents-stack">
				<div
					v-if="showMostUsedBar"
					class="seventv-tverino-recents"
					:class="{ empty: !resolvedMostUsedEntries.length, 'most-used': true }"
				>
					<template v-if="resolvedMostUsedEntries.length">
						<button
							v-for="entry of resolvedMostUsedEntries"
							:key="entry.key"
							class="seventv-tverino-recents-item"
							type="button"
							:title="entry.title"
							@click="onRecentClick($event, entry.emote)"
						>
							<Emote :emote="entry.emote" :show-tooltip="false" :scale="0.74" />
							<span
								v-if="entry.count !== null"
								class="seventv-tverino-recents-count-pill most-used"
							>
								{{ formatUsageCount(entry.count) }}
							</span>
						</button>
					</template>
					<div v-else class="seventv-tverino-recents-empty">
						{{ mostUsedBarEmptyText }}
					</div>
				</div>

				<div
					v-if="showRecentBar"
					class="seventv-tverino-recents"
					:class="{ empty: !resolvedRecentEntries.length }"
				>
					<template v-if="resolvedRecentEntries.length">
						<button
							v-for="entry of resolvedRecentEntries"
							:key="entry.key"
							class="seventv-tverino-recents-item"
							type="button"
							:title="entry.title"
							@click="onRecentClick($event, entry.emote)"
						>
							<Emote :emote="entry.emote" :show-tooltip="false" :scale="0.74" />
							<span v-if="entry.count !== null" class="seventv-tverino-recents-count-pill">
								{{ formatUsageCount(entry.count) }}
							</span>
						</button>
					</template>
					<div v-else class="seventv-tverino-recents-empty">
						{{ recentBarEmptyText }}
					</div>
				</div>
			</div>

			<div v-if="activeReply" class="seventv-tverino-reply-tray">
				<div class="seventv-tverino-reply-tray-copy">
					<span class="seventv-tverino-reply-tray-title">
						{{
							activeReply.thread
								? "Replying in thread"
								: `Replying to @${activeReply.displayName || activeReply.username}`
						}}
					</span>
					<span class="seventv-tverino-reply-tray-body">{{ activeReply.body }}</span>
				</div>
				<button
					class="seventv-tverino-reply-tray-close"
					type="button"
					aria-label="Cancel reply"
					@click="closeNativeReplyTray"
				>
					&times;
				</button>
			</div>

			<form ref="inputShellRef" class="seventv-tverino-input-shell" @submit.prevent="submit(undefined, $event)">
				<button
					ref="badgeButtonRef"
					class="seventv-tverino-badge-trigger seventv-tverino-badge-trigger-inline"
					:class="{ open: badgePanelOpen, selected: !!selectedTriggerBadge }"
					type="button"
					aria-label="Choose Twitch chat badge"
					:aria-expanded="badgePanelOpen ? 'true' : 'false'"
					@mouseenter="startBadgeTriggerAnimation"
					@mouseleave="stopBadgeTriggerAnimation"
					@focus="startBadgeTriggerAnimation"
					@blur="stopBadgeTriggerAnimation"
					@click="toggleBadgePanel"
				>
					<span
						v-if="selectedTriggerBadge"
						class="seventv-tverino-badge-trigger-figure"
						:style="badgeTriggerFigureStyle"
					>
						<span class="seventv-tverino-badge-trigger-track" :style="badgeTriggerTrackStyle">
							<span
								v-for="badge of triggerBadges"
								:key="badge.key"
								class="seventv-tverino-badge-trigger-item"
							>
								<img
									class="seventv-tverino-badge-trigger-image"
									:src="badge.image2x || badge.image1x"
									:alt="badge.title"
								/>
							</span>
						</span>
					</span>
					<span v-else class="seventv-tverino-badge-trigger-figure">
						<span class="seventv-tverino-badge-trigger-placeholder" aria-hidden="true"></span>
					</span>
				</button>
				<input
					ref="inputRef"
					v-model="value"
					class="seventv-tverino-input-field"
					:disabled="inputStatus.state !== 'connected'"
					:placeholder="placeholder"
					type="text"
					autocomplete="off"
					spellcheck="false"
					@focus="isFocused = true"
					@blur="onBlur"
					@keydown="onKeyDown"
				/>
				<button
					ref="brandButtonRef"
					class="seventv-tverino-brand"
					type="button"
					:class="{ open: emoteMenuCtx.open }"
					aria-label="Open 7TV emote menu"
					:aria-expanded="emoteMenuCtx.open ? 'true' : 'false'"
					@click="toggleEmoteMenu"
				>
					<Logo7TV />
				</button>
			</form>
		</div>

		<EmoteMenu
			v-if="brandButtonRef"
			:anchor-el="brandButtonRef"
			:channel-id="props.ctx.id"
			:channel-ctx="props.ctx"
			width="39rem"
			scale="1.2rem"
			@emote-click="onEmoteMenuEmoteClick"
			@close="onEmoteMenuClose"
		/>

		<TVerinoChatSettingsPanel
			v-if="settingsPanelOpen && settingsButtonRef"
			:ctx="props.ctx"
			:anchor-el="settingsButtonRef"
			@close="closeSettingsPanel"
			@clickout="onSettingsPanelClickout"
		/>

		<TVerinoChannelPointsPanel
			v-if="channelPointsPanelOpen && channelPointsButtonRef"
			:anchor-el="channelPointsButtonRef"
			:channel-label="props.ctx.displayName || props.ctx.username || 'Channel'"
			:point-name="channelPointsName"
			:balance="channelPointsBalance"
			:balance-display="channelPointsBalanceDisplay"
			:loading="channelPointsLoading"
			:notice="channelPointsNotice"
			:notice-is-error="channelPointsNoticeIsError"
			:rewards="channelPointsRewards"
			:redeemable-reward-ids="redeemableRewardIDs"
			:redeemed-reward-id="redeemedRewardID"
			:redeeming-reward-id="redeemingRewardID"
			:icon-image="channelPointsIcon?.image2x || channelPointsIcon?.image1x || ''"
			:icon-background-color="channelPointsIcon?.backgroundColor || ''"
			:show-native-menu="channelPointsNativeMenuAvailable"
			:show-review-requests="showModViewButton"
			:review-requests-count="channelPointsReviewRequestsCount"
			@close="closeChannelPointsPanel"
			@clickout="onChannelPointsPanelClickout"
			@redeem="onChannelPointsRedeem"
			@review-requests="onChannelPointsReviewRequests"
			@report-rewards="onChannelPointsReportRewards"
		/>

		<TVerinoGlobalBadgePanel
			v-if="badgePanelOpen && badgeButtonRef"
			:anchor-el="badgeButtonRef"
			:channel-label="props.ctx.displayName || props.ctx.username || 'Channel'"
			:global-badge-options="globalBadgeOptions"
			:notice="globalBadgeNotice"
			:notice-is-error="globalBadgeNoticeIsError"
			:empty-text="globalBadgeEmptyText"
			:is-selecting-badge="isSelectingBadge"
			:selected-badge-keys="selectedGlobalBadgeKeys"
			:selecting-badge-key="selectingBadgeKey"
			@close="closeBadgePanel"
			@clickout="onBadgePanelClickout"
			@select="onBadgeSelect"
		/>

		<div class="seventv-tverino-footer">
			<button
				v-if="channelPointsVisible"
				ref="channelPointsButtonRef"
				class="seventv-tverino-points-trigger"
				:class="{ open: channelPointsPanelOpen, loading: channelPointsLoading }"
				type="button"
				aria-label="Open channel points and rewards"
				:aria-expanded="channelPointsPanelOpen ? 'true' : 'false'"
				:title="channelPointsButtonTitle"
				@click="toggleChannelPointsPanel"
			>
				<span class="seventv-tverino-points-trigger-icon">
					<img
						v-if="channelPointsIcon?.image2x || channelPointsIcon?.image1x"
						class="seventv-tverino-points-trigger-image"
						:src="channelPointsIcon?.image2x || channelPointsIcon?.image1x || ''"
						:alt="channelPointsName"
					/>
					<TwitchChannelPointsIcon v-else />
				</span>
				<span class="seventv-tverino-points-trigger-value">{{ channelPointsBalanceCompact }}</span>
				<span
					v-if="nativeClaimPointsGainLabel"
					class="seventv-tverino-points-trigger-gain"
					:class="{ active: nativeClaimPointsGainVisible }"
				>
					{{ nativeClaimPointsGainLabel }}
				</span>
			</button>
			<button
				v-if="showNativeClaimButton"
				class="seventv-tverino-points-claim"
				:class="{ claiming: nativeClaimPending, claimed: nativeClaimClaimed }"
				type="button"
				aria-label="Claim Bonus"
				title="Claim Bonus"
				:disabled="nativeClaimPending"
				@click="claimNativeChannelPoints"
			>
				<span class="seventv-tverino-points-claim-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="currentColor">
						<g class="pop-lines" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(0 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(45 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(90 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(135 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(180 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(225 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(270 12 12)" />
							<line x1="12" y1="0" x2="12" y2="-4" transform="rotate(315 12 12)" />
						</g>
						<g class="chest-icon">
							<path d="M13 12h-2v2h2v-2Z"></path>
							<path
								fill-rule="evenodd"
								clip-rule="evenodd"
								d="M6 3a4 4 0 0 0-4 4v14h20V7a4 4 0 0 0-4-4H6Zm1 2H6a2 2 0 0 0-2 2v1h3V5Zm2 0v3h6V5H9Zm11 5v9H4v-9h16Zm-3-5v3h3V7a2 2 0 0 0-2-2h-1Z"
							></path>
						</g>
					</svg>
				</span>
			</button>
			<div class="seventv-tverino-footer-spacer"></div>
			<a
				v-if="showModViewButton"
				class="seventv-tverino-footer-action seventv-tverino-mod-view"
				:href="modViewHref"
				aria-label="Go to Mod View"
				title="Go to Mod View"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						fill-rule="evenodd"
						clip-rule="evenodd"
						d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z"
					/>
				</svg>
			</a>
			<button
				ref="settingsButtonRef"
				class="seventv-tverino-footer-action seventv-tverino-settings"
				:class="{ open: settingsPanelOpen }"
				type="button"
				aria-label="Open Twitch chat settings"
				:aria-expanded="settingsPanelOpen ? 'true' : 'false'"
				@click="toggleSettingsPanel"
			>
				<TwitchChatSettingsIcon />
			</button>
			<button
				class="seventv-tverino-chat-button"
				type="button"
				:disabled="!canSend"
				@click="submit(undefined, $event)"
			>
				{{ submitLabel }}
			</button>
		</div>

		<ChatInputCarousel
			v-if="tabState && tabState.currentMatch && shouldShowTabCarousel && inputShellRef"
			:anchor="inputShellRef"
			:current-match="tabState.currentMatch"
			:forwards-matches="tabState.forwardsMatches"
			:backwards-matches="tabState.backwardsMatches"
			@back="(ev) => handleTabPress(ev, true)"
			@forward="(ev) => handleTabPress(ev, false)"
		/>

		<div v-if="shouldShowSuggestions" class="seventv-tverino-suggestions">
			<button
				v-for="(item, index) of suggestionItems"
				:key="`${item.kind}:${item.token}`"
				class="seventv-tverino-suggestion"
				:class="{ active: index === suggestionIndex }"
				type="button"
				@mousedown.prevent="applySuggestion(item)"
			>
				<span class="main">
					<span v-if="item.kind === 'emote' && item.emote" class="preview">
						<Emote :emote="item.emote" :show-tooltip="false" :scale="0.72" />
					</span>
					<span class="token">{{ item.token }}</span>
				</span>
				<span class="meta">{{ item.kind }}</span>
			</button>
		</div>

		<p v-if="inputStatus.reason" class="seventv-tverino-status">
			{{ inputStatus.reason }}
		</p>
	</div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { TabToken, getSearchRange } from "@/common/Input";
import { ChatAutocompleteIndex } from "@/common/chat/AutocompleteIndex";
import { ChatMessage } from "@/common/chat/ChatMessage";
import { type HookedInstance, useComponentHook } from "@/common/ReactHooks";
import { type ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useAuthorEmoteSetRequests } from "@/composable/chat/useAuthorEmoteSetRequests";
import { useChatMessageProcessor } from "@/composable/chat/useChatMessageProcessor";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import {
	type RecentSentEmoteEntry,
	type RecentSentEmoteUsageEntry,
	useRecentSentEmotes,
} from "@/composable/chat/useRecentSentEmotes";
import { useCosmetics } from "@/composable/useCosmetics";
import { getModule } from "@/composable/useModule";
import { useConfig } from "@/composable/useSettings";
import { MessagePartType, MessageType } from "@/site/twitch.tv";
import TwitchChannelPointsIcon from "@/assets/svg/icons/TwitchChannelPointsIcon.vue";
import TwitchChatSettingsIcon from "@/assets/svg/icons/TwitchChatSettingsIcon.vue";
import Logo7TV from "@/assets/svg/logos/Logo7TV.vue";
import ChatInputCarousel from "../chat-input/ChatInputCarousel.vue";
import TVerinoChannelPointsPanel from "./TVerinoChannelPointsPanel.vue";
import TVerinoChatSettingsPanel from "./TVerinoChatSettingsPanel.vue";
import TVerinoGlobalBadgePanel from "./TVerinoGlobalBadgePanel.vue";
import { activeReplyTray } from "./components/tray/ChatTray";
import BasicSystemMessage from "@/app/chat/msg/BasicSystemMessage.vue";
import {
	applyTVerinoSendResultToMessage,
	getTVerinoSelfMessageState,
	rememberTVerinoSelfMessageState,
	storePendingTVerinoSendResult,
	toTVerinoBadgeMap,
} from "./tverinoPendingMessage";
import { useTVerinoChannelPoints } from "./useTVerinoChannelPoints";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import { type TVerinoGlobalBadgeOption, useTVerinoGlobalBadges } from "./useTVerinoGlobalBadges";
import Emote from "@/app/chat/Emote.vue";
import EmoteMenu from "@/app/emote-menu/EmoteMenu.vue";
import { useEmoteMenuContext } from "@/app/emote-menu/EmoteMenuContext";
import { useSettingsMenu } from "@/app/settings/Settings";
import type { TypedWorkerMessage } from "@/worker";

interface SuggestionItem {
	token: string;
	replacement: string;
	kind: "command" | "emote" | "user";
	description?: string;
	emote?: SevenTV.ActiveEmote;
}

interface TabCycleState {
	index: number;
	matches: TabToken[];
	currentMatch: TabToken;
	backwardsMatches: TabToken[];
	forwardsMatches: TabToken[];
}

interface SubmitModifierLike {
	ctrlKey?: boolean;
}

interface ResolvedRecentEntry {
	key: string;
	emote: SevenTV.ActiveEmote;
	count: number | null;
	title: string;
}

const AUTOCOMPLETION_MODE = {
	OFF: 0,
	COLON: 1,
	ALWAYS_ON: 2,
} as const;
const TAB_AROUND_MATCH_COUNT = 3;
const MESSAGE_HISTORY_LIMIT = 20;

const props = defineProps<{
	ctx: ChannelContext;
	mode: "native" | "remote";
	inputStatus: SevenTV.TVerinoTransportStatus;
	nativeTrayState?: {
		active: boolean;
		sendHandlerType: string;
		placeholder: string;
		sendButtonLabel: string;
		allowEmpty: boolean;
		disableChat: boolean;
	};
	nativeSendMessage?: (message: string, reply?: NonNullable<Twitch.DisplayableMessage["reply"]>) => boolean;
}>();

const { identity } = storeToRefs(useStore());
const { sendChatMessage, target } = useTVerinoChatTransport();
const emotes = useChatEmotes(props.ctx);
const messages = useChatMessages(props.ctx);
const recentSentEmotes = useRecentSentEmotes();
const autocompleteMode = useConfig<number>("chat_input.autocomplete.colon", AUTOCOMPLETION_MODE.COLON);
const autocompleteMatchMode = useConfig<number>("chat_input.autocomplete.colon.mode", 1);
const shouldRenderAutocompleteCarousel = useConfig<boolean>("chat_input.autocomplete.carousel", true);
const shouldListenToCarouselArrowKeys = useConfig<boolean>("chat_input.autocomplete.carousel_arrow_keys", true);
const tabCompletionMode = useConfig<number>("chat_input.autocomplete.carousel.mode", 0);
const shouldAutocompleteChatters = useConfig<boolean>("chat_input.autocomplete.chatters", true);
const shouldAutocompleteEmoji = useConfig<boolean>("chat_input.autocomplete.colon.emoji", false);
const autoClaimChannelPoints = useConfig<boolean>("general.autoclaim.channel_points", false);
const actorCosmetics = computed(() => (identity.value?.id ? useCosmetics(identity.value.id) : null));

function refreshMessagesForAuthor(userID: string): void {
	const authoredMessages = messages.find((message) => message.author?.id === userID, true) as ChatMessage[];
	for (const message of authoredMessages) {
		message.refresh();
	}
}

const actorEmoteSetRequests = useAuthorEmoteSetRequests({
	onResolved: refreshMessagesForAuthor,
});
const processor = useChatMessageProcessor(props.ctx);
const settingsMenu = useSettingsMenu();
const emoteMenuCtx = useEmoteMenuContext();
const autocompleteIndex = new ChatAutocompleteIndex();

const inputRef = ref<HTMLInputElement | null>(null);
const inputShellRef = ref<HTMLFormElement | null>(null);
const channelPointsButtonRef = ref<HTMLButtonElement | null>(null);
const badgeButtonRef = ref<HTMLButtonElement | null>(null);
const brandButtonRef = ref<HTMLButtonElement | null>(null);
const settingsButtonRef = ref<HTMLButtonElement | null>(null);
const value = ref("");
const isFocused = ref(false);
const suggestionIndex = ref(0);
const tabState = ref<TabCycleState | null>(null);
const messageHistory = ref<string[]>([]);
const messageHistoryIndex = ref(-1);
const messageHistoryDraft = ref<string | null>(null);
const badgeTriggerIndex = ref(0);
const channelPointsPanelOpen = ref(false);
const badgePanelOpen = ref(false);
const settingsPanelOpen = ref(false);
const channelPointsNativeMenuAvailable = ref(false);
const channelPointsReviewRequestsCount = ref<number | null>(null);
const nativeClaimVisible = ref(false);
const nativeClaimPending = ref(false);
const nativeClaimClaimed = ref(false);
const nativeClaimAction = ref<(() => void) | null>(null);
const nativeClaimPointsGain = ref<number | null>(null);
const nativeClaimPointsGainVisible = ref(false);
let badgeTriggerStepTimeout: number | null = null;
let nativeClaimResetTimeout = 0;
let nativeClaimPollTimeout = 0;
let nativeClaimClaimedTimeout = 0;
let nativeClaimPointsGainTimeout = 0;
let nativeClaimRequestToken = 0;
let nativeClaimStartBalance: number | null = null;
let nativeClaimAutoTriggered = false;
let nativeChannelPointsMenuObserver: MutationObserver | null = null;
let syncingMessageHistoryValue = false;
const {
	channelPointsBalance,
	channelPointsBalanceCompact,
	channelPointsBalanceDisplay,
	channelPointsButtonTitle,
	channelPointsIcon,
	channelPointsLoading,
	channelPointsName,
	channelPointsNotice,
	channelPointsNoticeIsError,
	channelPointsRewards,
	clearRedeemedReward,
	redeemReward,
	redeemableRewardIDs,
	redeemedRewardID,
	redeemingRewardID,
	channelPointsVisible,
	refreshChannelPointsState,
} = useTVerinoChannelPoints(props.ctx);
const {
	globalBadgeEmptyText,
	globalBadgeNotice,
	globalBadgeNoticeIsError,
	globalBadgeOptions,
	isSelectingBadge,
	channelDisplayBadges,
	selectedChannelRoleBadge,
	selectedDisplayBadges,
	selectedSubscriberBadge,
	selectedGlobalBadge,
	selectedGlobalBadgeKeys,
	selectBadgeOption,
	selectingBadgeKey,
} = useTVerinoGlobalBadges(props.ctx);
const triggerBadges = computed<TVerinoGlobalBadgeOption[]>(() => {
	const candidateBadges = [
		selectedChannelRoleBadge.value,
		selectedSubscriberBadge.value,
		selectedGlobalBadge.value,
	].filter((badge): badge is TVerinoGlobalBadgeOption => !!badge);
	const seen = new Set<string>();
	const badges: TVerinoGlobalBadgeOption[] = [];

	for (const badge of candidateBadges) {
		if (seen.has(badge.key)) continue;
		seen.add(badge.key);
		badges.push(badge);
	}

	return badges;
});
const selectedTriggerBadge = computed(() => triggerBadges.value[0] ?? null);
const clampedBadgeTriggerIndex = computed(() =>
	Math.min(badgeTriggerIndex.value, Math.max(triggerBadges.value.length - 1, 0)),
);
const badgeTriggerFigureStyle = computed(() => ({
	"--tverino-badge-count": String(Math.max(triggerBadges.value.length, 1)),
}));
const badgeTriggerTrackStyle = computed(() => ({
	transform:
		clampedBadgeTriggerIndex.value > 0
			? `translate3d(calc((var(--tverino-badge-trigger-size) + var(--tverino-badge-trigger-gap)) * -${clampedBadgeTriggerIndex.value}), 0, 0)`
			: "translate3d(0, 0, 0)",
}));
const actorDisplayName = computed(() => {
	const currentIdentity = identity.value;
	if (!currentIdentity) return "";
	if ("displayName" in currentIdentity && currentIdentity.displayName) return currentIdentity.displayName;
	return currentIdentity.username;
});
const hasActiveNativeTray = computed(() => !!props.nativeTrayState?.active);
const shouldRouteThroughNativeInput = computed(
	() => props.mode === "native" || (hasActiveNativeTray.value && typeof props.nativeSendMessage === "function"),
);
const placeholder = computed(() => {
	if (props.inputStatus.state !== "connected") return "Chat unavailable";
	if (hasActiveNativeTray.value && props.nativeTrayState?.placeholder) {
		return props.nativeTrayState.placeholder;
	}

	const channelLabel = (props.ctx.displayName || props.ctx.username).trim();
	return channelLabel ? `Send a message in ${channelLabel}` : "Send a message";
});

const submitLabel = computed(() => {
	if (hasActiveNativeTray.value && props.nativeTrayState?.sendButtonLabel) {
		return props.nativeTrayState.sendButtonLabel;
	}

	return "Chat";
});
const canSubmitEmptyNativeTray = computed(
	() => hasActiveNativeTray.value && !!props.nativeTrayState?.allowEmpty,
);
const canSend = computed(() => {
	if (props.inputStatus.state !== "connected") return false;
	if (hasActiveNativeTray.value && props.nativeTrayState) {
		if (props.nativeTrayState.disableChat) return false;
		if (canSubmitEmptyNativeTray.value) return true;
	}

	return value.value.trim().length > 0;
});
const showModViewButton = computed(() => {
	const roles = props.ctx.actor.roles;
	return !!props.ctx.username && (roles.has("MODERATOR") || roles.has("BROADCASTER"));
});
const modViewHref = computed(() => `/moderator/${props.ctx.username}`);
const activeReply = computed(() => {
	const tray = activeReplyTray.value;
	return tray?.channelID === props.ctx.id ? tray : null;
});
const pointsDeltaFormatter = new Intl.NumberFormat(undefined, {
	signDisplay: "always",
});
const showNativeClaimButton = computed(
	() => props.mode === "native" && (nativeClaimVisible.value || nativeClaimPending.value || nativeClaimClaimed.value),
);
const nativeClaimPointsGainLabel = computed(() =>
	nativeClaimPointsGain.value && nativeClaimPointsGainVisible.value
		? pointsDeltaFormatter.format(nativeClaimPointsGain.value)
		: "",
);

useComponentHook<Twitch.ChatChannelPointsClaimComponent>(
	{
		parentSelector: ".community-points-summary",
		predicate: (el) => el.props && typeof el.onClick === "function",
	},
	{
		hooks: {
			render(inst, cur) {
				syncNativeClaimState(inst, cur);
				return cur;
			},
			unmount(inst) {
				if (!nativeClaimAction.value || typeof inst.component.onClick !== "function") return;
				nativeClaimVisible.value = false;
				nativeClaimAction.value = null;
				if (!nativeClaimPending.value && !nativeClaimClaimed.value) {
					resetNativeClaimState();
				}
			},
		},
	},
);

function syncNativeClaimState(inst: HookedInstance<Twitch.ChatChannelPointsClaimComponent>, cur: React.ReactNode): void {
	if (props.mode !== "native") {
		resetNativeClaimState();
		return;
	}

	const visible = !inst.component.props.hidden && reactNodeContainsVisibleClaim(cur);
	nativeClaimVisible.value = visible;
	nativeClaimAction.value = visible && typeof inst.component.onClick === "function" ? () => inst.component.onClick() : null;

	if (!visible && !nativeClaimPending.value && !nativeClaimClaimed.value) {
		clearNativeClaimResetTimeout();
		clearNativeClaimPollTimeout();
	}
}

function reactNodeContainsVisibleClaim(node: unknown): boolean {
	if (!node) return false;

	if (Array.isArray(node)) {
		return node.some((entry) => reactNodeContainsVisibleClaim(entry));
	}

	if (typeof node !== "object") return false;

	const candidate = node as {
		props?: {
			show?: unknown;
			children?: unknown;
		};
	};
	if (candidate.props?.show === true) return true;

	return reactNodeContainsVisibleClaim(candidate.props?.children);
}

function clearNativeClaimResetTimeout(): void {
	if (!nativeClaimResetTimeout) return;
	window.clearTimeout(nativeClaimResetTimeout);
	nativeClaimResetTimeout = 0;
}

function clearNativeClaimPollTimeout(): void {
	if (!nativeClaimPollTimeout) return;
	window.clearTimeout(nativeClaimPollTimeout);
	nativeClaimPollTimeout = 0;
}

function clearNativeClaimClaimedTimeout(): void {
	if (!nativeClaimClaimedTimeout) return;
	window.clearTimeout(nativeClaimClaimedTimeout);
	nativeClaimClaimedTimeout = 0;
}

function clearNativeClaimPointsGainTimeout(): void {
	if (!nativeClaimPointsGainTimeout) return;
	window.clearTimeout(nativeClaimPointsGainTimeout);
	nativeClaimPointsGainTimeout = 0;
}

function stopNativeChannelPointsMenuObserver(): void {
	nativeChannelPointsMenuObserver?.disconnect();
	nativeChannelPointsMenuObserver = null;
}

function normalizeNativeMenuText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisibleElement(el: Element | null | undefined): el is HTMLElement {
	if (!(el instanceof HTMLElement)) return false;

	const style = window.getComputedStyle(el);
	return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
}

function findNativeChannelPointsMoreOptionsButtons(): HTMLButtonElement[] {
	const scopes = [
		document.querySelector(".community-points-summary"),
		document.querySelector(".community-points-summary")?.parentElement,
		document.body,
	].filter((scope): scope is Element => !!scope);
	const seen = new Set<HTMLButtonElement>();
	const buttons: HTMLButtonElement[] = [];

	for (const scope of scopes) {
		for (const button of Array.from(scope.querySelectorAll<HTMLButtonElement>('button[aria-label="More options"]'))) {
			if (seen.has(button)) continue;
			seen.add(button);
			if (button.closest(".seventv-tverino-points-panel")) continue;
			if (!isVisibleElement(button)) continue;
			buttons.push(button);
		}
	}

	return buttons;
}

function findNativeChannelPointsPopupRoot(): HTMLElement | null {
	const poppers = Array.from(document.querySelectorAll<HTMLElement>('[data-popper-placement="bottom-end"]'));
	for (const popper of poppers) {
		if (popper.closest(".seventv-tverino-points-panel")) continue;
		if (!isVisibleElement(popper)) continue;
		if (
			popper.querySelector('[data-test-selector="requests-count"]') ||
			popper.querySelector('[data-a-target="report-button-report-button"]')
		) {
			return popper;
		}
	}

	for (const balloon of Array.from(document.querySelectorAll<HTMLElement>(".tw-balloon"))) {
		if (balloon.closest(".seventv-tverino-points-panel")) continue;
		if (!isVisibleElement(balloon)) continue;
		if (
			balloon.querySelector('[data-test-selector="requests-count"]') ||
			balloon.querySelector('[data-a-target="report-button-report-button"]')
		) {
			return balloon;
		}
	}

	return null;
}

function findNativeChannelPointsReviewRequestsButton(): HTMLButtonElement | null {
	const popupRoot = findNativeChannelPointsPopupRoot();
	if (!popupRoot) return null;

	const countNode = popupRoot.querySelector<HTMLElement>('[data-test-selector="requests-count"]');
	const countButton = countNode?.closest("button");
	if (countButton instanceof HTMLButtonElement) return countButton;

	for (const button of Array.from(popupRoot.querySelectorAll<HTMLButtonElement>("button"))) {
		if (normalizeNativeMenuText(button.textContent).startsWith("review requests")) return button;
	}

	return null;
}

function findNativeChannelPointsReportRewardsButton(): HTMLButtonElement | null {
	const popupRoot = findNativeChannelPointsPopupRoot();
	if (!popupRoot) return null;

	const reportButton = popupRoot.querySelector<HTMLButtonElement>('[data-a-target="report-button-report-button"]');
	if (reportButton) return reportButton;

	for (const button of Array.from(popupRoot.querySelectorAll<HTMLButtonElement>("button"))) {
		if (normalizeNativeMenuText(button.textContent) === "report rewards") return button;
	}

	return null;
}

function findNativeChannelPointsRequestCount(): number | null {
	const popupRoot = findNativeChannelPointsPopupRoot();
	if (!popupRoot) return null;

	const countNode = popupRoot.querySelector<HTMLElement>('[data-test-selector="requests-count"]');
	if (!countNode) return null;

	const match = countNode.textContent?.match(/\d[\d,]*/);
	if (!match) return null;

	const parsed = Number.parseInt(match[0].replaceAll(",", ""), 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function syncNativeChannelPointsMenuState(): void {
	const moreButtons = findNativeChannelPointsMoreOptionsButtons();
	const reviewButton = findNativeChannelPointsReviewRequestsButton();
	const reportButton = findNativeChannelPointsReportRewardsButton();

	channelPointsNativeMenuAvailable.value = moreButtons.length > 0 || !!reviewButton || !!reportButton;
	channelPointsReviewRequestsCount.value = findNativeChannelPointsRequestCount();
}

function startNativeChannelPointsMenuObserver(): void {
	stopNativeChannelPointsMenuObserver();
	syncNativeChannelPointsMenuState();

	nativeChannelPointsMenuObserver = new MutationObserver(() => {
		syncNativeChannelPointsMenuState();
	});
	nativeChannelPointsMenuObserver.observe(document.body, {
		subtree: true,
		childList: true,
		characterData: true,
	});
}

async function waitForNextFrame(): Promise<void> {
	await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForNativeChannelPointsMenuAction(
	findActionButton: () => HTMLButtonElement | null,
	maxAttempts = 8,
): Promise<HTMLButtonElement | null> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const actionButton = findActionButton();
		if (actionButton) return actionButton;

		await waitForNextFrame();
		await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
	}

	return null;
}

async function openNativeChannelPointsMenuAction(action: "review" | "report"): Promise<void> {
	const findActionButton =
		action === "review" ? findNativeChannelPointsReviewRequestsButton : findNativeChannelPointsReportRewardsButton;
	const directActionButton = await waitForNativeChannelPointsMenuAction(findActionButton, 1);
	if (directActionButton) {
		directActionButton.click();
		closeChannelPointsPanel();
		return;
	}

	for (const moreButton of findNativeChannelPointsMoreOptionsButtons()) {
		moreButton.click();
		const openedActionButton = await waitForNativeChannelPointsMenuAction(findActionButton);
		if (!openedActionButton) continue;

		openedActionButton.click();
		closeChannelPointsPanel();
		return;
	}

	syncNativeChannelPointsMenuState();
}

function resetNativeClaimState(): void {
	nativeClaimVisible.value = false;
	nativeClaimPending.value = false;
	nativeClaimClaimed.value = false;
	nativeClaimAction.value = null;
	nativeClaimPointsGain.value = null;
	nativeClaimPointsGainVisible.value = false;
	nativeClaimStartBalance = null;
	nativeClaimRequestToken += 1;
	clearNativeClaimResetTimeout();
	clearNativeClaimPollTimeout();
	clearNativeClaimClaimedTimeout();
	clearNativeClaimPointsGainTimeout();
}

function triggerNativeClaimSuccess(pointsGain: number | null): void {
	nativeClaimPending.value = false;
	nativeClaimClaimed.value = true;
	clearNativeClaimResetTimeout();
	clearNativeClaimPollTimeout();

	if (pointsGain && pointsGain > 0) {
		nativeClaimPointsGain.value = pointsGain;
		nativeClaimPointsGainVisible.value = false;
		clearNativeClaimPointsGainTimeout();
		requestAnimationFrame(() => {
			nativeClaimPointsGainVisible.value = true;
		});
		nativeClaimPointsGainTimeout = window.setTimeout(() => {
			nativeClaimPointsGainVisible.value = false;
			nativeClaimPointsGainTimeout = 0;
			window.setTimeout(() => {
				if (nativeClaimPointsGainVisible.value) return;
				nativeClaimPointsGain.value = null;
			}, 260);
		}, 1500);
	}

	clearNativeClaimClaimedTimeout();
	nativeClaimClaimedTimeout = window.setTimeout(() => {
		nativeClaimClaimed.value = false;
		nativeClaimClaimedTimeout = 0;
		if (!nativeClaimVisible.value) {
			nativeClaimAction.value = null;
		}
	}, 900);
}

function scheduleNativeClaimRefresh(token: number, attempt = 0): void {
	clearNativeClaimPollTimeout();
	nativeClaimPollTimeout = window.setTimeout(async () => {
		if (token !== nativeClaimRequestToken || !nativeClaimPending.value) return;

		try {
			await refreshChannelPointsState({ background: true });
		} catch {
			// Ignore refresh errors during the native claim handoff.
		}

		if (token !== nativeClaimRequestToken || !nativeClaimPending.value) return;

		if (!nativeClaimVisible.value && attempt >= 2) {
			triggerNativeClaimSuccess(null);
			return;
		}

		if (attempt >= 5) {
			nativeClaimPending.value = false;
			return;
		}

		scheduleNativeClaimRefresh(token, attempt + 1);
	}, attempt === 0 ? 420 : 700);
}

function claimNativeChannelPoints(): void {
	if (!showNativeClaimButton.value || nativeClaimPending.value || !nativeClaimAction.value) return;

	nativeClaimRequestToken += 1;
	const token = nativeClaimRequestToken;
	nativeClaimStartBalance = channelPointsBalance.value;
	nativeClaimClaimed.value = false;
	nativeClaimPointsGain.value = null;
	nativeClaimPointsGainVisible.value = false;
	clearNativeClaimClaimedTimeout();
	clearNativeClaimPointsGainTimeout();
	nativeClaimPending.value = true;
	nativeClaimAction.value();
	clearNativeClaimResetTimeout();
	nativeClaimResetTimeout = window.setTimeout(() => {
		if (token !== nativeClaimRequestToken) return;
		nativeClaimPending.value = false;
		nativeClaimResetTimeout = 0;
	}, 10_000);
	scheduleNativeClaimRefresh(token);
}

function resolveRecentEntry(entry: RecentSentEmoteEntry | RecentSentEmoteUsageEntry): ResolvedRecentEntry | null {
	const resolvedEmote =
		emotes.find(
			(ae) =>
				ae.id === entry.id &&
				ae.provider === entry.provider &&
				(ae.unicode ?? ae.name) === (entry.name || ae.name),
			true,
		) ??
		emotes.find((ae) => ae.id === entry.id && ae.provider === entry.provider, true) ??
		emotes.find(
			(ae) =>
				ae.id === entry.id &&
				ae.provider === entry.provider &&
				(ae.unicode ?? ae.name) === (entry.name || ae.name),
		) ??
		emotes.find((ae) => ae.id === entry.id && ae.provider === entry.provider);
	if (!resolvedEmote) return null;

	const count = "count" in entry ? entry.count : null;
	return {
		key: `${entry.provider}:${entry.id}`,
		emote: resolvedEmote,
		count,
		title:
			count === null
				? `${entry.name} - Click to send. Ctrl+Click or Alt+Click to insert.`
				: `${entry.name} - Sent ${count} ${count === 1 ? "time" : "times"} in this channel. Click to send. Ctrl+Click or Alt+Click to insert.`,
	};
}

function resolveRecentEntries(entries: (RecentSentEmoteEntry | RecentSentEmoteUsageEntry)[]): ResolvedRecentEntry[] {
	return entries
		.filter((entry) => recentSentEmotes.scopeAllows(entry.provider))
		.map((entry) => resolveRecentEntry(entry))
		.filter((entry): entry is ResolvedRecentEntry => !!entry);
}

const resolvedMostUsedEntries = computed(() => resolveRecentEntries(recentSentEmotes.getMostUsedEntries(props.ctx.id)));
const resolvedRecentEntries = computed(() => {
	const entries = resolveRecentEntries(recentSentEmotes.getEntries(props.ctx.id));
	if (!(showRecentBar.value && showMostUsedBar.value)) return entries;

	const mostUsedKeys = new Set(resolvedMostUsedEntries.value.map((entry) => entry.key));
	return entries.filter((entry) => !mostUsedKeys.has(entry.key));
});
const showRecentBar = computed(() => recentSentEmotes.showRecentBar.value);
const showMostUsedBar = computed(() => recentSentEmotes.showMostUsedBar.value);
const showAnyRecentBar = computed(() => recentSentEmotes.isEnabled.value);
const recentBarEmptyText = computed(
	() => "Recent emotes appear here after you send them. Ctrl+Click or Alt+Click inserts.",
);
const mostUsedBarEmptyText = computed(
	() => "Most-used emotes in this channel appear here after you send them. Ctrl+Click or Alt+Click inserts.",
);
const shouldShowSuggestions = computed(() => isFocused.value && !tabState.value && suggestionItems.value.length > 0);
const shouldShowTabCarousel = computed(
	() => shouldRenderAutocompleteCarousel.value && autocompleteMode.value !== AUTOCOMPLETION_MODE.ALWAYS_ON,
);

interface NativeAutocompleteResult {
	current: string;
	type: string;
	element: unknown;
	replacement: string;
}

type NativeCommandProvider = Twitch.ChatAutocompleteProvider<"command">;

function getNativeAutocompleteInstance(): HookedInstance<Twitch.ChatAutocompleteComponent> | null {
	const nativeChatInputModule = getModule<"TWITCH", "chat-input">("chat-input");
	const autocompleteInstances = nativeChatInputModule?.instance?.component?.instances ?? [];

	for (const instance of autocompleteInstances as HookedInstance<Twitch.ChatAutocompleteComponent>[]) {
		if (instance.component.props?.channelID !== props.ctx.id) continue;
		return instance;
	}

	return null;
}

function getNativeCommandProvider(): NativeCommandProvider | null {
	const instance = getNativeAutocompleteInstance();
	return (
		(instance?.component.providers.find(
			(entry) => entry.autocompleteType === "command",
		) as NativeCommandProvider | undefined) ?? null
	);
}

function findNativeAutocompleteProp(node: unknown, key: string): string {
	if (!node || typeof node !== "object") return "";
	if (Array.isArray(node)) {
		for (const entry of node) {
			const value = findNativeAutocompleteProp(entry, key);
			if (value) return value;
		}
		return "";
	}

	const props = (node as { props?: Record<string, unknown> }).props;
	if (props && typeof props[key] === "string") {
		return props[key] as string;
	}

	return findNativeAutocompleteProp(props?.children, key);
}

function flattenNativeAutocompleteText(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) {
		return node.map((entry) => flattenNativeAutocompleteText(entry)).filter(Boolean).join(" ");
	}
	if (!node || typeof node !== "object") return "";

	return flattenNativeAutocompleteText((node as { props?: { children?: unknown } }).props?.children);
}

function resolveSuggestionEmote(token: string, replacement: string): SevenTV.ActiveEmote | undefined {
	return (
		emotes.active[token] ??
		emotes.emojis[token] ??
		Object.values(emotes.emojis).find((emote) => emote.unicode === replacement) ??
		undefined
	);
}

function normalizeSuggestionText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function getNativeAutocompleteTrayRoot(): HTMLElement | null {
	if (props.mode !== "native") return null;

	const host = inputShellRef.value?.closest("seventv-container#seventv-tverino-input");
	const nativeRoot = host?.nextElementSibling;
	if (nativeRoot instanceof HTMLElement) {
		return nativeRoot.querySelector<HTMLElement>(".chat-input-tray__open");
	}

	return document.querySelector<HTMLElement>(".chat-input.seventv-tverino-native-input-hidden .chat-input-tray__open");
}

function getCommandSuggestionReplacement(tokenLabel: string): string {
	const command = normalizeSuggestionText(tokenLabel).match(/^\/\S+/)?.[0] ?? normalizeSuggestionText(tokenLabel);
	return command ? `${command} ` : tokenLabel;
}

function getNativeTraySuggestionItems(token: string): SuggestionItem[] {
	const trayRoot = getNativeAutocompleteTrayRoot();
	if (!trayRoot) return [];

	const buttons = Array.from(trayRoot.querySelectorAll<HTMLButtonElement>("button[data-a-target]"));
	if (!buttons.length) return [];

	const items = [] as SuggestionItem[];
	const seen = new Set<string>();

	for (const button of buttons) {
		const tokenLabel = normalizeSuggestionText(button.dataset.aTarget);
		if (!tokenLabel) continue;

		const key = tokenLabel.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		const description = normalizeSuggestionText(button.querySelector("p")?.textContent);
		const kind = tokenLabel.startsWith("/") ? "command" : token.startsWith(":") ? "emote" : "user";
		const replacement =
			kind === "command"
				? getCommandSuggestionReplacement(tokenLabel)
				: kind === "emote"
					? resolveSuggestionEmote(tokenLabel, tokenLabel)?.unicode || tokenLabel
					: tokenLabel;
		const emote = kind === "emote" ? resolveSuggestionEmote(tokenLabel, replacement) : undefined;

		items.push({
			token: tokenLabel,
			replacement,
			kind,
			description,
			emote,
		});

		if (items.length >= 8) break;
	}

	return items;
}

function getNativeSuggestionItems(token: string): SuggestionItem[] {
	const instance = getNativeAutocompleteInstance();
	if (!instance) return [];

	let matches: NativeAutocompleteResult[] = [];
	try {
		const result = instance.component.getMatches(token) as NativeAutocompleteResult[] | undefined;
		if (Array.isArray(result)) {
			matches = result;
		}
	} catch {
		matches = [];
	}

	if (!matches.length) return [];

	const items = [] as SuggestionItem[];
	for (const match of matches.slice(0, 8)) {
		const trayTarget = findNativeAutocompleteProp(match.element, "data-a-target");
		const flattened = flattenNativeAutocompleteText(match.element).replace(/\s+/g, " ").trim();
		const tokenLabel = trayTarget || match.replacement.trim() || flattened || token;
		const description =
			flattened && flattened !== tokenLabel
				? flattened.startsWith(tokenLabel)
					? flattened.slice(tokenLabel.length).trim()
					: flattened
				: "";
		const emote = match.type === "emote" ? resolveSuggestionEmote(tokenLabel, match.replacement) : undefined;

		items.push({
			token: tokenLabel,
			replacement: match.replacement,
			kind: match.type === "command" ? "command" : match.type === "emote" ? "emote" : "user",
			description,
			emote,
		});
	}

	return items;
}

function getCommandSuggestionItems(token: string): SuggestionItem[] {
	const provider = getNativeCommandProvider();
	if (!provider) return [];

	const commandSearch = token.slice(1).trim().toLowerCase();
	const commands = provider.props?.getCommands?.();
	if (!Array.isArray(commands)) return [];

	const test =
		!commandSearch
			? (_value: string) => true
			: autocompleteMatchMode.value === 0
			? (value: string) => value.startsWith(commandSearch)
			: (value: string) => value.includes(commandSearch);

	const items = [] as SuggestionItem[];
	const seen = new Set<string>();

	for (const command of commands as Twitch.ChatCommand[]) {
		if (!command?.name || command.hidden) continue;

		const normalizedName = command.name.toLowerCase();
		if (!test(normalizedName)) continue;

		const displayToken = `/${command.name}`;
		const key = displayToken.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		items.push({
			token: displayToken,
			replacement: `${displayToken} `,
			kind: "command",
			description: command.description || command.helpText || "",
		});
		if (items.length >= 8) break;
	}

	return items;
}

const suggestionItems = computed<SuggestionItem[]>(() => {
	const { token, start, end } = getTokenAtCursor();
	if (!isFocused.value || start === end || token.length < 1) return [] as SuggestionItem[];

	const isMentionToken = token.startsWith("@");
	const isColonToken = token.startsWith(":");
	const isCommandToken = token.startsWith("/");

	if (isMentionToken) {
		if (!shouldAutocompleteChatters.value) return [] as SuggestionItem[];

		const normalizedMention = token.slice(1).toLowerCase();
		if (normalizedMention.length < 2) return [] as SuggestionItem[];

		const items = [] as SuggestionItem[];
		const seen = new Set<string>();

		for (const chatter of Object.values(messages.chatters)) {
			const displayName = chatter.displayName || chatter.username;
			if (!displayName) continue;
			if (!displayName.toLowerCase().startsWith(normalizedMention)) continue;

			const tokenValue = `@${displayName}`;
			const key = `user:${tokenValue}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({
				token: tokenValue,
				replacement: tokenValue,
				kind: "user",
			});
			if (items.length >= 8) break;
		}

		return items;
	}

	if (isCommandToken) {
		const trayItems = getNativeTraySuggestionItems(token);
		if (trayItems.length) return trayItems;

		const nativeItems = getNativeSuggestionItems(token);
		if (nativeItems.length) return nativeItems;
		return getCommandSuggestionItems(token);
	}

	if (token.length < 2) return [] as SuggestionItem[];
	if (autocompleteMode.value === AUTOCOMPLETION_MODE.OFF) return [] as SuggestionItem[];
	if (autocompleteMode.value === AUTOCOMPLETION_MODE.COLON && !isColonToken) return [] as SuggestionItem[];

	if (isColonToken) {
		const trayItems = getNativeTraySuggestionItems(token);
		if (trayItems.length) return trayItems;

		const nativeItems = getNativeSuggestionItems(token);
		if (nativeItems.length) return nativeItems;
	}

	const normalized = (isColonToken ? token.slice(1) : token).toLowerCase();
	if (normalized.length < 2) return [] as SuggestionItem[];

	const items = [] as SuggestionItem[];
	for (const match of findMatchingTokens(normalized, "colon", 8)) {
		const emote = (match.item as SevenTV.ActiveEmote | undefined) ?? emotes.emojis[match.token];
		if (!emote) continue;

		items.push({
			token: match.token,
			replacement: emote.provider === "EMOJI" ? (emote.unicode || match.token) : match.token,
			kind: "emote",
			emote,
		});
	}

	return items;
});

function getTokenAtCursor(): { token: string; start: number; end: number } {
	const input = inputRef.value;
	const cursor = input?.selectionStart ?? value.value.length;
	const text = value.value;

	let start = cursor;
	let end = cursor;
	while (start > 0 && text[start - 1] !== " ") start--;
	while (end < text.length && text[end] !== " ") end++;

	return {
		token: text.slice(start, end),
		start,
		end,
	};
}

function getCursorTokenRange(): { token: string; rawToken: string; start: number; end: number; cursor: number } {
	const input = inputRef.value;
	const text = value.value;
	const selectionStart = input?.selectionStart ?? text.length;
	const selectionEnd = input?.selectionEnd ?? selectionStart;
	const cursor = Math.max(selectionStart, selectionEnd);
	const [start, end] = getSearchRange(text, cursor);
	const rawToken = text.slice(start, end);

	return {
		token: rawToken.trimEnd(),
		rawToken,
		start,
		end,
		cursor,
	};
}

function clearTabCycle(): void {
	tabState.value = null;
}

function resetMessageHistoryNavigation(): void {
	messageHistoryIndex.value = -1;
	messageHistoryDraft.value = null;
}

function pushMessageHistory(message: string): void {
	messageHistory.value.unshift(message);
	messageHistory.value.splice(MESSAGE_HISTORY_LIMIT, Infinity);
	resetMessageHistoryNavigation();
}

function setValueFromMessageHistory(nextValue: string): void {
	syncingMessageHistoryValue = true;
	value.value = nextValue;
	suggestionIndex.value = 0;
	clearTabCycle();
	queueMicrotask(() => {
		syncingMessageHistoryValue = false;
	});

	requestAnimationFrame(() => {
		const input = inputRef.value;
		const pos = nextValue.length;

		input?.focus();
		input?.setSelectionRange(pos, pos);
	});
}

function useMessageHistory(backwards = true): boolean {
	const input = inputRef.value;
	if (!input || messageHistory.value.length === 0) return false;
	if (suggestionItems.value.length && !tabState.value && messageHistoryIndex.value === -1) return false;

	const selectionStart = input.selectionStart ?? value.value.length;
	const selectionEnd = input.selectionEnd ?? selectionStart;
	if (selectionStart !== selectionEnd) return false;

	if (messageHistoryIndex.value === -1) {
		if (backwards) {
			if (selectionStart !== 0) return false;
		} else if (selectionStart !== value.value.length) {
			return false;
		}

		messageHistoryDraft.value = value.value;
	}

	const nextIndex = backwards ? messageHistoryIndex.value + 1 : messageHistoryIndex.value - 1;
	if (nextIndex < -1 || nextIndex >= messageHistory.value.length) return false;

	const nextValue = nextIndex === -1 ? (messageHistoryDraft.value ?? "") : messageHistory.value[nextIndex];
	setValueFromMessageHistory(nextValue);
	messageHistoryIndex.value = nextIndex;
	return true;
}

function normalizeTabMatchToken(token: string): string {
	return token.trimEnd();
}

function findMatchingTokens(search: string, mode: "tab" | "colon", limit?: number): TabToken[] {
	const normalizedSearch = search.toLowerCase();
	if (!normalizedSearch) return [];

	autocompleteIndex.rebuild({
		personalEmotes: actorCosmetics.value?.emotes ?? {},
		activeEmotes: emotes.active,
		providers: emotes.providers,
		emojis: emotes.emojis,
		chatters: messages.chatters,
	});

	const matches = autocompleteIndex.query(search, {
		mode,
		matchMode: (mode === "tab" ? tabCompletionMode.value : autocompleteMatchMode.value) === 0 ? 0 : 1,
		includeChatters: shouldAutocompleteChatters.value,
		limit,
	});

	if (mode !== "colon" || shouldAutocompleteEmoji.value) {
		return matches;
	}

	return matches.filter((item) => item.item?.provider !== "EMOJI");
}

watch(
	() => identity.value,
	(currentIdentity) => {
		if (!currentIdentity) return;
		const displayName = "displayName" in currentIdentity ? currentIdentity.displayName : currentIdentity.username;

		actorEmoteSetRequests.requestAuthorCosmetics({
			color: "",
			isIntl: false,
			isSubscriber: false,
			userDisplayName: displayName,
			displayName,
			userID: currentIdentity.id,
			userLogin: currentIdentity.username,
			userType: "",
		});
	},
	{ immediate: true },
);

function buildTabState(matches: TabToken[], index: number): TabCycleState {
	const currentMatch = matches[index]!;
	const backwardsMatches = [] as TabToken[];
	const forwardsMatches = [] as TabToken[];

	for (let offset = 1; offset <= TAB_AROUND_MATCH_COUNT && offset < matches.length; offset++) {
		backwardsMatches.unshift(matches[(index - offset + matches.length) % matches.length]!);
		forwardsMatches.push(matches[(index + offset) % matches.length]!);
	}

	return {
		index,
		matches,
		currentMatch,
		backwardsMatches,
		forwardsMatches,
	};
}

function replaceRange(start: number, end: number, nextToken: string): void {
	const input = inputRef.value;
	if (!input) return;

	const prefix = value.value.slice(0, start);
	const suffix = value.value.slice(end);
	value.value = `${prefix}${nextToken}${suffix}`;

	requestAnimationFrame(() => {
		const pos = prefix.length + nextToken.length;
		input.focus();
		input.setSelectionRange(pos, pos);
	});
}

function replaceToken(nextToken: string): void {
	const input = inputRef.value;
	if (!input) return;

	const { start, end } = getTokenAtCursor();
	const prefix = value.value.slice(0, start);
	const suffix = value.value.slice(end);
	const replacement = `${prefix}${nextToken}${suffix.startsWith(" ") || !suffix ? "" : " "}${suffix}`;
	value.value = replacement;

	requestAnimationFrame(() => {
		const pos = prefix.length + nextToken.length;
		input.focus();
		input.setSelectionRange(pos, pos);
	});

	clearTabCycle();
}

function insertToken(nextToken: string): void {
	const input = inputRef.value;
	if (!input) return;

	const text = value.value;
	const start = input.selectionStart ?? text.length;
	const end = input.selectionEnd ?? start;
	const prefix = text.slice(0, start);
	const suffix = text.slice(end);
	const tokenPrefix = prefix.length > 0 && !/\s$/.test(prefix) ? " " : "";
	const tokenSuffix = suffix.startsWith(" ") ? "" : " ";
	const insertion = `${tokenPrefix}${nextToken}${tokenSuffix}`;

	value.value = `${prefix}${insertion}${suffix}`;

	requestAnimationFrame(() => {
		const pos = prefix.length + insertion.length;
		input.focus();
		input.setSelectionRange(pos, pos);
	});

	clearTabCycle();
}

function appendToken(nextToken: string): void {
	const input = inputRef.value;
	if (!input) return;

	const prefix = value.value && value.value.at(-1) !== " " ? " " : "";
	value.value = `${value.value}${prefix}${nextToken} `;

	requestAnimationFrame(() => {
		const pos = value.value.length;
		input.focus();
		input.setSelectionRange(pos, pos);
	});

	clearTabCycle();
}

function applySuggestion(item: SuggestionItem): void {
	replaceToken(item.replacement);
	suggestionIndex.value = 0;
}

function handleTabPress(ev: KeyboardEvent, backwards = false): void {
	ev.preventDefault();
	ev.stopPropagation();

	const range = getCursorTokenRange();
	if (!range.token) {
		clearTabCycle();
		return;
	}

	let matches = tabState.value?.matches ?? [];
	let currentIndex = -1;
	if (
		tabState.value &&
		normalizeTabMatchToken(tabState.value.currentMatch.token) === normalizeTabMatchToken(range.token)
	) {
		currentIndex = tabState.value.index;
	} else {
		currentIndex = matches.findIndex((match) => normalizeTabMatchToken(match.token) === normalizeTabMatchToken(range.token));
	}

	if (currentIndex < 0) {
		matches = findMatchingTokens(range.token, "tab");
	}

	if (!matches.length) {
		clearTabCycle();
		return;
	}

	if (currentIndex < 0) {
		currentIndex = backwards ? matches.length - 1 : 0;
	} else {
		currentIndex += backwards ? -1 : 1;
		currentIndex %= matches.length;
		if (currentIndex < 0) currentIndex = matches.length - 1;
	}

	const match = matches[currentIndex];
	if (!match) {
		clearTabCycle();
		return;
	}

	const replacement =
		match.item?.provider === "PLATFORM" || match.token.endsWith(" ") ? match.token : `${match.token} `;

	replaceRange(range.start, range.end, replacement);
	tabState.value = buildTabState(matches, currentIndex);
}

function commitTabCycleSpace(ev: KeyboardEvent): boolean {
	const input = inputRef.value;
	if (!tabState.value || !input) return false;

	ev.preventDefault();
	ev.stopPropagation();

	const start = input.selectionStart ?? value.value.length;
	const end = input.selectionEnd ?? start;
	const prefix = value.value.slice(0, start);
	const suffix = value.value.slice(end);
	value.value = `${prefix} ${suffix}`;
	clearTabCycle();

	requestAnimationFrame(() => {
		const pos = prefix.length + 1;
		input.focus();
		input.setSelectionRange(pos, pos);
	});

	return true;
}

function onBlur(): void {
	window.setTimeout(() => {
		isFocused.value = false;
		suggestionIndex.value = 0;
		clearTabCycle();
	}, 100);
}

function closeNativeReplyTray(): void {
	activeReplyTray.value?.close?.();
}

function clearBadgeTriggerAnimation(): void {
	if (badgeTriggerStepTimeout !== null) {
		window.clearTimeout(badgeTriggerStepTimeout);
		badgeTriggerStepTimeout = null;
	}
}

function queueBadgeTriggerStep(nextIndex: number): void {
	clearBadgeTriggerAnimation();

	if (nextIndex >= triggerBadges.value.length) {
		badgeTriggerStepTimeout = window.setTimeout(() => {
			badgeTriggerIndex.value = 0;
			if (triggerBadges.value.length < 2) return;
			badgeTriggerStepTimeout = window.setTimeout(() => {
				queueBadgeTriggerStep(1);
			}, 1000);
		}, 1000);
		return;
	}

	badgeTriggerStepTimeout = window.setTimeout(
		() => {
			badgeTriggerIndex.value = nextIndex;
			queueBadgeTriggerStep(nextIndex + 1);
		},
		nextIndex === 1 ? 520 : 1320,
	);
}

function startBadgeTriggerAnimation(): void {
	badgeTriggerIndex.value = 0;
	if (triggerBadges.value.length < 2) return;
	queueBadgeTriggerStep(1);
}

function stopBadgeTriggerAnimation(): void {
	clearBadgeTriggerAnimation();
	badgeTriggerIndex.value = 0;
}

function onKeyDown(ev: KeyboardEvent): void {
	if (ev.key === "Escape" && activeReply.value) {
		ev.preventDefault();
		closeNativeReplyTray();
		return;
	}

	if (tabState.value && shouldListenToCarouselArrowKeys.value) {
		if (ev.key === "ArrowLeft") {
			handleTabPress(ev, true);
			return;
		}

		if (ev.key === "ArrowRight") {
			handleTabPress(ev, false);
			return;
		}
	}

	if (ev.key === "Tab") {
		handleTabPress(ev, ev.shiftKey);
		return;
	}

	if ((ev.key === " " || ev.code === "Space") && commitTabCycleSpace(ev)) {
		return;
	}

	if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
		if (ev.key === "ArrowUp" && useMessageHistory(true)) {
			ev.preventDefault();
			return;
		}

		if (ev.key === "ArrowDown" && useMessageHistory(false)) {
			ev.preventDefault();
			return;
		}
	}

	if (suggestionItems.value.length && !tabState.value) {
		if (ev.key === "ArrowDown") {
			ev.preventDefault();
			suggestionIndex.value = Math.min(suggestionIndex.value + 1, suggestionItems.value.length - 1);
			return;
		}

		if (ev.key === "ArrowUp") {
			ev.preventDefault();
			suggestionIndex.value = Math.max(suggestionIndex.value - 1, 0);
			return;
		}
	}

	if (ev.key === "Enter" && !ev.shiftKey) {
		ev.preventDefault();
		if (suggestionItems.value.length && !tabState.value) {
			applySuggestion(suggestionItems.value[suggestionIndex.value] ?? suggestionItems.value[0]!);
			return;
		}

		submit(undefined, ev);
		return;
	}

	if (tabState.value && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
		const shouldReset =
			ev.key === "Backspace" ||
			ev.key === "Delete" ||
			ev.key === "Escape" ||
			(ev.key.length === 1 && ev.key !== "\t");
		if (shouldReset) {
			clearTabCycle();
		}
	}
}

function createNonce(): string {
	return `tverino:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function shouldKeepDraftAfterSubmit(explicitText?: string, trigger?: Event | SubmitModifierLike): boolean {
	return !explicitText && !!trigger && "ctrlKey" in trigger && !!trigger.ctrlKey;
}

function finalizeSubmit(keepDraft: boolean): void {
	closeNativeReplyTray();
	if (!keepDraft) {
		value.value = "";
	}
	suggestionIndex.value = 0;
	clearTabCycle();

	if (!keepDraft) return;

	requestAnimationFrame(() => {
		const input = inputRef.value;
		if (!input) return;

		input.focus();
		const end = input.value.length;
		input.setSelectionRange(end, end);
	});
}

function submit(explicitText?: string, trigger?: Event | SubmitModifierLike): void {
	const rawMessage = explicitText ?? value.value;
	const message = rawMessage.trim();
	if ((!message && !canSubmitEmptyNativeTray.value) || !identity.value) return;
	const keepDraft = shouldKeepDraftAfterSubmit(explicitText, trigger);
	const replyMetadata = activeReply.value
		? {
				parentDeleted: activeReply.value.deleted,
				parentMsgId: activeReply.value.id,
				parentMessageBody: activeReply.value.body,
				parentUid: activeReply.value.authorID ?? "",
				parentUserLogin: activeReply.value.username ?? "",
				parentDisplayName: activeReply.value.displayName ?? activeReply.value.username ?? "",
				...(activeReply.value.thread
					? {
							threadParentDeleted: activeReply.value.thread.deleted,
							threadParentMsgId: activeReply.value.thread.id,
							threadParentUserLogin: activeReply.value.thread.login,
					  }
					: {}),
		  }
		: undefined;

	if (shouldRouteThroughNativeInput.value) {
		const didSend = props.nativeSendMessage?.(message, replyMetadata) ?? false;
		if (!didSend) return;

		if (message) {
			pushMessageHistory(message);
		}
		finalizeSubmit(keepDraft);
		return;
	}

	const nonce = createNonce();
	const selfState = getTVerinoSelfMessageState(props.ctx.id);
	const effectiveDisplayBadges = channelDisplayBadges.value.length
		? channelDisplayBadges.value
		: selectedDisplayBadges.value;
	const selectedBadgeMap = effectiveDisplayBadges.length ? toTVerinoBadgeMap(effectiveDisplayBadges) : {};
	const badges =
		selfState?.badges && Object.keys(selfState.badges).length > 0 ? { ...selfState.badges } : selectedBadgeMap;
	const displayName =
		selfState?.user?.userDisplayName ||
		selfState?.user?.displayName ||
		actorDisplayName.value ||
		identity.value.username;
	const isSubscriber = !!(badges.subscriber || badges.founder);

	if (Object.keys(badges).length > 0) {
		rememberTVerinoSelfMessageState(props.ctx.id, {
			badges,
			displayBadges: effectiveDisplayBadges.map((badge) => ({ ...badge })),
			user: {
				color: selfState?.user?.color || "",
				userID: identity.value.id,
				userLogin: identity.value.username,
				userDisplayName: displayName,
				displayName,
				userType: selfState?.user?.userType || "",
				isSubscriber,
			},
		});
	}

	processor.onMessage({
		id: nonce,
		type: MessageType.MESSAGE,
		nonce,
		channelID: props.ctx.id,
		user: {
			color: selfState?.user?.color || "",
			isIntl: false,
			isSubscriber,
			userDisplayName: displayName,
			displayName,
			userID: identity.value.id,
			userLogin: identity.value.username,
			userType: selfState?.user?.userType || "",
		},
		badgeDynamicData: { ...(selfState?.badgeDynamicData ?? {}) },
		badges,
		deleted: false,
		banned: false,
		hidden: false,
		isHistorical: false,
		isFirstMsg: false,
		isReturningChatter: false,
		isVip: false,
		messageBody: message,
		reply: replyMetadata,
		messageParts: [
			{
				type: MessagePartType.TEXT,
				content: message,
			},
		],
		messageType: 0,
		timestamp: Date.now(),
	} as Twitch.ChatMessage);

	recentSentEmotes.recordMessage(props.ctx.id, message, emotes.active);
	sendChatMessage(props.ctx.id, props.ctx.username, message, nonce, replyMetadata);
	pushMessageHistory(message);
	finalizeSubmit(keepDraft);
}

function onSendResult(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	const found = messages.find((msg) => msg.nonce === detail.nonce);
	if (!found) {
		if (props.mode === "native") {
			if (detail.ok) return;

			const systemMessage = new ChatMessage().setComponent(BasicSystemMessage, {
				text: detail.error || "Failed to send reply",
			});
			systemMessage.setTimestamp(Date.now());
			messages.add(systemMessage, true);
			return;
		}

		storePendingTVerinoSendResult(detail);
		return;
	}

	applyTVerinoSendResultToMessage(found, detail);

	if (detail.ok) {
		if (detail.messageID) {
			found.setID(detail.messageID);
		}
		found.setDeliveryState("SENT");
		return;
	}

	found.setDeliveryState("BOUNCED");
}

function onRecentClick(ev: MouseEvent, emote: SevenTV.ActiveEmote): void {
	ev.preventDefault();
	ev.stopPropagation();

	const token = emote.unicode ?? emote.name;

	if (ev.ctrlKey || ev.altKey) {
		appendToken(token);
		return;
	}

	submit(token);
}

function formatUsageCount(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${Math.floor(count / 1000)}k`;
}

function toggleEmoteMenu(): void {
	closeSettingsPanel();
	closeBadgePanel();
	closeChannelPointsPanel();
	emoteMenuCtx.channelID = props.ctx.id;
	emoteMenuCtx.open = !emoteMenuCtx.open;
}

function onEmoteMenuEmoteClick(emote: SevenTV.ActiveEmote): void {
	insertToken(emote.unicode ?? emote.name);
}

function onEmoteMenuClose(ev: MouseEvent): void {
	if (settingsMenu.open || !(ev.target instanceof Node)) return;
	if (brandButtonRef.value?.contains(ev.target)) return;
	if (inputShellRef.value?.contains(ev.target)) return;

	emoteMenuCtx.open = false;
}

function closeSettingsPanel(): void {
	settingsPanelOpen.value = false;
}

function closeChannelPointsPanel(): void {
	channelPointsPanelOpen.value = false;
	stopNativeChannelPointsMenuObserver();
	channelPointsNativeMenuAvailable.value = false;
	channelPointsReviewRequestsCount.value = null;
	clearRedeemedReward();
}

function closeBadgePanel(): void {
	badgePanelOpen.value = false;
}

function toggleSettingsPanel(): void {
	emoteMenuCtx.open = false;
	closeBadgePanel();
	closeChannelPointsPanel();
	settingsPanelOpen.value = !settingsPanelOpen.value;
}

function toggleBadgePanel(): void {
	emoteMenuCtx.open = false;
	closeChannelPointsPanel();
	closeSettingsPanel();
	badgePanelOpen.value = !badgePanelOpen.value;
}

function toggleChannelPointsPanel(): void {
	emoteMenuCtx.open = false;
	closeBadgePanel();
	closeSettingsPanel();
	channelPointsPanelOpen.value = !channelPointsPanelOpen.value;

	if (channelPointsPanelOpen.value) {
		void refreshChannelPointsState();
	}
}

function onSettingsPanelClickout(ev: PointerEvent): void {
	if (!(ev.target instanceof Node)) return;
	if (settingsButtonRef.value?.contains(ev.target)) return;

	closeSettingsPanel();
}

function onChannelPointsPanelClickout(ev: PointerEvent): void {
	if (!(ev.target instanceof Node)) return;
	if (channelPointsButtonRef.value?.contains(ev.target)) return;

	closeChannelPointsPanel();
}

function onBadgePanelClickout(ev: PointerEvent): void {
	if (!(ev.target instanceof Node)) return;
	if (badgeButtonRef.value?.contains(ev.target)) return;

	closeBadgePanel();
}

function onBadgeSelect(badge: TVerinoGlobalBadgeOption): void {
	void selectBadgeOption(badge);
}

function onChannelPointsRedeem(reward: import("./useTVerinoChannelPoints").TVerinoChannelPointsReward): void {
	void redeemReward(reward);
}

function onChannelPointsReviewRequests(): void {
	const channelLogin = props.ctx.username?.trim().toLowerCase();
	if (!channelLogin) return;

	window.open(
		`https://www.twitch.tv/popout/${channelLogin}/reward-queue`,
		"twitch-reward-queue",
		"popup=yes,width=960,height=860,noopener,noreferrer",
	);
	closeChannelPointsPanel();
}

function onChannelPointsReportRewards(): void {
	void openNativeChannelPointsMenuAction("report");
}

watch(
	() => triggerBadges.value.map((badge) => badge.key).join("|"),
	() => stopBadgeTriggerAnimation(),
);

watch(activeReply, (tray) => {
	if (!tray) return;
	requestAnimationFrame(() => inputRef.value?.focus());
});

watch(value, () => {
	if (syncingMessageHistoryValue || messageHistoryIndex.value === -1) return;
	resetMessageHistoryNavigation();
});

watch(channelPointsBalance, (nextBalance) => {
	if (!nativeClaimPending.value) return;
	if (nativeClaimStartBalance === null || nextBalance === null) return;
	if (nextBalance <= nativeClaimStartBalance) return;

	triggerNativeClaimSuccess(nextBalance - nativeClaimStartBalance);
});

watch(
	() => channelPointsPanelOpen.value,
	(open) => {
		if (open) {
			startNativeChannelPointsMenuObserver();
			return;
		}

		stopNativeChannelPointsMenuObserver();
		channelPointsNativeMenuAvailable.value = false;
		channelPointsReviewRequestsCount.value = null;
	},
	{ immediate: true },
);

watch(
	[nativeClaimVisible, autoClaimChannelPoints, () => props.mode] as const,
	([visible, enabled, mode]) => {
		if (!visible || mode !== "native") {
			nativeClaimAutoTriggered = false;
			return;
		}

		if (!enabled || nativeClaimAutoTriggered || nativeClaimPending.value) return;

		nativeClaimAutoTriggered = true;
		requestAnimationFrame(() => {
			claimNativeChannelPoints();
		});
	},
	{ immediate: true },
);

target.addEventListener("tverino_chat_send_result", onSendResult);

onUnmounted(() => {
	stopBadgeTriggerAnimation();
	closeChannelPointsPanel();
	closeBadgePanel();
	closeSettingsPanel();
	resetNativeClaimState();
	stopNativeChannelPointsMenuObserver();
	emoteMenuCtx.open = false;
	target.removeEventListener("tverino_chat_send_result", onSendResult);
});
</script>

<style scoped lang="scss">
.seventv-tverino-input {
	--tverino-twitch-purple: #9146ff;
	position: relative;
	z-index: 3;
	isolation: isolate;
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
	padding: 0.45rem 0.8rem 0.95rem;
	border-top: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-shade-1);

	&.disabled {
		opacity: 0.82;
	}
}

.seventv-tverino-reply-tray {
	display: flex;
	align-items: flex-start;
	gap: 0.8rem;
	margin: 0.65rem 0.65rem 0;
	padding: 0.8rem 1rem;
	border: 0.1rem solid rgb(255 255 255 / 0.12);
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.05);
}

.seventv-tverino-reply-tray-copy {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
	gap: 0.2rem;
}

.seventv-tverino-reply-tray-title {
	color: var(--seventv-text-color-normal);
	font-size: 1.18rem;
	font-weight: 700;
}

.seventv-tverino-reply-tray-body {
	color: var(--seventv-text-color-secondary);
	font-size: 1.18rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.seventv-tverino-reply-tray-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 2.2rem;
	height: 2.2rem;
	border-radius: 999px;
	color: var(--seventv-text-color-secondary);
	font-size: 1.8rem;
	line-height: 1;
	transition:
		background-color 120ms ease,
		color 120ms ease;

	&:hover {
		background: rgb(255 255 255 / 0.08);
		color: var(--seventv-text-color-normal);
	}
}

.seventv-tverino-compose {
	position: relative;
	overflow: hidden;
	border: 1px solid rgb(255 255 255 / 0.62);
	border-radius: 0.5rem;
	background:
		linear-gradient(180deg, rgb(255 255 255 / 0.028), transparent 42%),
		rgb(24 24 27 / 0.965);
	box-shadow:
		inset 0 1px 0 rgb(255 255 255 / 0.06),
		0 0.7rem 1.8rem rgb(0 0 0 / 0.2);

	&::after {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
		pointer-events: none;
	}

	&.focused {
		border-color: var(--color-border-input-focus, #a970ff);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.07),
			0 0 0 1px var(--color-border-input-focus, #a970ff),
			0 0.8rem 2rem rgb(0 0 0 / 0.24);

		&::after {
			box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
		}
	}
}

.seventv-tverino-recents-stack {
	display: flex;
	flex-direction: column;
	width: 100%;
}

.seventv-tverino-recents {
	display: flex;
	gap: 0.35rem;
	overflow-x: auto;
	align-items: center;
	width: 100%;
	padding: 0.3rem 0.45rem 0.26rem;
	border-bottom: 0.1rem solid rgb(255 255 255 / 0.14);
	background: transparent;
	box-sizing: border-box;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		width: 0;
		height: 0;
	}

	&.empty {
		padding: 0.34rem 0.45rem 0.3rem;
	}
}

.seventv-tverino-recents-item {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	min-width: calc(2.9rem - 2px);
	min-height: calc(2.7rem - 2px);
	padding: calc(0.2rem - 1px) calc(0.3rem - 1px);
	border: 0;
	border-radius: 0.45rem;
	background: transparent;
	cursor: pointer;
	transition:
		background-color 110ms ease,
		transform 110ms ease;

	&:hover,
	&:focus-visible {
		transform: translateY(-1px);
		background: rgb(255 255 255 / 0.08);
	}
}

.seventv-tverino-recents-count-pill {
	position: absolute;
	top: 0.18rem;
	left: 0.18rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.1rem;
	height: 1.1rem;
	padding: 0 0.28rem;
	border-radius: 999px;
	background: #fff;
	color: rgb(14 14 18 / 0.98);
	font-size: 0.74rem;
	font-weight: 800;
	line-height: 1;
	box-shadow: 0 0.22rem 0.65rem rgb(0 0 0 / 0.18);
	pointer-events: none;
	opacity: 0.98;
	transform: translateY(0) scale(1);
	transform-origin: top left;
	transition:
		opacity 150ms ease,
		transform 150ms ease;
}

.seventv-tverino-recents-count-pill.most-used {
	box-shadow:
		0 0.28rem 0.8rem rgb(0 0 0 / 0.24),
		0 0.08rem 0.22rem rgb(0 0 0 / 0.12);
}

.seventv-tverino-recents-item:hover .seventv-tverino-recents-count-pill,
.seventv-tverino-recents-item:focus-visible .seventv-tverino-recents-count-pill {
	opacity: 0;
	transform: translateY(-0.2rem) scale(0.82);
}

.seventv-tverino-recents-empty {
	font-size: 1.2rem;
	line-height: 1.3;
	color: var(--seventv-text-color-secondary);
	white-space: normal;
}

.seventv-tverino-input-shell {
	position: relative;
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: center;
	min-height: 4.7rem;
	background: transparent;
}

.seventv-tverino-input-field {
	width: 100%;
	height: 100%;
	padding: 0 1rem 0 4.3rem;
	border: 0;
	border-radius: 0;
	background: transparent;
	color: var(--seventv-text-color-normal);
	outline: none;
	font-family: inherit;
	font-size: 1.34rem;
	font-weight: 400;
	font-synthesis: none;
	line-height: 1.5;
	transform: translateY(-1px);
	transition:
		color 120ms ease,
		opacity 120ms ease;

	&::placeholder {
		color: var(--seventv-text-color-secondary);
		opacity: 1;
		font-family: inherit;
		font-weight: 400;
		font-synthesis: none;
	}

	&:disabled {
		cursor: not-allowed;
	}
}

.seventv-tverino-brand {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	align-self: stretch;
	width: 4.2rem;
	padding: 0;
	border-left: 0.1rem solid rgb(255 255 255 / 0.08);
	background: transparent;
	color: var(--seventv-text-color-secondary);
	transition:
		background-color 120ms ease,
		color 120ms ease,
		opacity 120ms ease;

	svg {
		width: 1.95rem;
		height: 1.95rem;
	}

	&:hover:not(:disabled) {
		background: rgb(255 255 255 / 0.05);
		color: var(--seventv-text-color-normal);
	}

	&.open {
		background: rgb(255 255 255 / 0.06);
		color: var(--tverino-twitch-purple);
	}

	&.open:hover:not(:disabled),
	&.open:focus-visible:not(:disabled) {
		background: rgb(255 255 255 / 0.08);
		color: color-mix(in srgb, var(--tverino-twitch-purple) 74%, white 26%);
	}

	&:disabled {
		opacity: 0.45;
	}
}

.seventv-tverino-footer {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	min-height: 3rem;
}

.seventv-tverino-points-trigger,
.seventv-tverino-points-claim {
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	height: 2.8rem;
	padding: 0 0.95rem 0 0.55rem;
	border: 0.1rem solid rgb(255 255 255 / 0.06);
	border-radius: 999px;
	background: rgb(255 255 255 / 0.02);
	color: var(--seventv-text-color-normal);
	transition:
		border-color 120ms ease,
		background-color 120ms ease,
		color 120ms ease,
		opacity 120ms ease;

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.13);
		background: rgb(255 255 255 / 0.035);
	}

	&.open {
		border-color: rgb(255 255 255 / 0.14);
		background: rgb(255 255 255 / 0.04);
	}

	&.loading {
		opacity: 0.8;
	}
}

.seventv-tverino-points-claim {
	justify-content: center;
	flex: 0 0 auto;
	width: 2.8rem;
	padding: 0;
	border-color: rgb(255 255 255 / 0.06);
	background: rgb(255 255 255 / 0.02);
	color: var(--seventv-text-color-secondary);

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.16);
		background: rgb(255 255 255 / 0.08);
		color: #fff;
	}

	&.claiming {
		border-color: rgb(255 255 255 / 0.16);
		background: rgb(255 255 255 / 0.08);
		color: #fff;
		opacity: 0.8;
	}

	&.claimed {
		border-color: rgb(255 255 255 / 0.16);
		background: rgb(255 255 255 / 0.08);
		color: #fff;
		animation: tverino-claim-button-pop 520ms cubic-bezier(0.22, 1, 0.36, 1);
	}
}

.seventv-tverino-points-trigger-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	background: rgb(255 255 255 / 0.055);
	color: rgb(255 255 255 / 0.72);

	svg,
	img {
		width: 1.28rem;
		height: 1.28rem;
		object-fit: contain;
	}
}

.seventv-tverino-points-trigger-value {
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
	font-weight: 700;
	letter-spacing: 0.01em;
	white-space: nowrap;
	transform: translateY(-1px);
	transition: color 120ms ease;
}

.seventv-tverino-points-trigger:hover .seventv-tverino-points-trigger-value,
.seventv-tverino-points-trigger:focus-visible .seventv-tverino-points-trigger-value,
.seventv-tverino-points-trigger.open .seventv-tverino-points-trigger-value {
	color: #fff;
}

.seventv-tverino-points-trigger-gain {
	position: absolute;
	top: -0.55rem;
	right: 0.15rem;
	padding: 0.14rem 0.42rem;
	border-radius: 999px;
	background: #fff;
	color: rgb(26 26 30 / 0.96);
	font-size: 1.05rem;
	font-weight: 800;
	letter-spacing: 0.01em;
	opacity: 0;
	transform: translate3d(0, 0.7rem, 0) scale(0.92);
	pointer-events: none;
	box-shadow:
		0 0 0 0.11rem rgb(255 255 255 / 1),
		0 0.38rem 0.95rem rgb(0 0 0 / 0.15);

	&.active {
		animation: tverino-points-gain 1500ms cubic-bezier(0.18, 0.84, 0.28, 1);
	}
}

.seventv-tverino-points-claim-icon {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.7rem;
	height: 1.7rem;
	color: currentColor;
	transform-origin: center;
	overflow: visible;

	svg {
		width: 1.7rem;
		height: 1.7rem;
		overflow: visible;
	}
}

.seventv-tverino-points-claim.claimed .seventv-tverino-points-claim-icon {
	animation: tverino-claim-icon-pop 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.seventv-tverino-points-claim-icon .pop-lines,
.seventv-tverino-points-claim-icon .chest-icon {
	transform-origin: 12px 12px;
}

.seventv-tverino-points-claim-icon .pop-lines {
	opacity: 0;
}

.seventv-tverino-points-claim.claimed .seventv-tverino-points-claim-icon .pop-lines {
	animation: tverino-claim-burst 520ms cubic-bezier(0.1, 0.8, 0.3, 1);
}

.seventv-tverino-points-claim.claimed .seventv-tverino-points-claim-icon .chest-icon {
	animation: tverino-claim-bounce 520ms cubic-bezier(0.1, 0.8, 0.3, 1);
}

@keyframes tverino-claim-button-pop {
	0% {
		transform: scale(1);
	}
	34% {
		transform: scale(1.08);
	}
	100% {
		transform: scale(1);
	}
}

@keyframes tverino-claim-icon-pop {
	0% {
		transform: scale(1);
	}
	26% {
		transform: scale(1.22);
	}
	58% {
		transform: scale(0.94);
	}
	100% {
		transform: scale(1);
	}
}

@keyframes tverino-claim-burst {
	0% {
		transform: scale(0.3);
		opacity: 0;
	}
	12% {
		opacity: 1;
	}
	42% {
		transform: scale(1.55);
		opacity: 0;
	}
	100% {
		opacity: 0;
		transform: scale(1.55);
	}
}

@keyframes tverino-claim-bounce {
	0%,
	42%,
	100% {
		transform: scale(1);
	}
	14% {
		transform: scale(1.14);
	}
	28% {
		transform: scale(0.98);
	}
}

@keyframes tverino-points-gain {
	0% {
		opacity: 0;
		transform: translate3d(0, 0.7rem, 0) scale(0.92);
	}
	15% {
		opacity: 1;
		transform: translate3d(0, 0, 0) scale(1);
	}
	78% {
		opacity: 1;
		transform: translate3d(0, -1.2rem, 0) scale(1);
	}
	100% {
		opacity: 0;
		transform: translate3d(0, -1.8rem, 0) scale(0.96);
	}
}

.seventv-tverino-badge-trigger {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0;
	width: 3rem;
	height: 3rem;
	padding: 0;
	border: 0.1rem solid rgb(255 255 255 / 0.08);
	border-radius: 999px;
	background: rgb(255 255 255 / 0.025);
	transition:
		border-color 120ms ease,
		background-color 120ms ease,
		color 120ms ease;

	&:hover,
	&:focus-visible {
		border-color: rgb(255 255 255 / 0.18);
		background: rgb(255 255 255 / 0.05);
	}

	&.open {
		border-color: rgb(145 71 255 / 0.45);
		background: rgb(145 71 255 / 0.12);
	}
}

.seventv-tverino-badge-trigger-inline {
	position: absolute;
	top: 50%;
	left: 0.65rem;
	z-index: 1;
	width: 2.72rem;
	height: 2.72rem;
	padding: 0;
	border: 0;
	border-radius: 0.6rem;
	background: rgb(255 255 255 / 0.05);
	transform: translateY(-50%);
	transition:
		background-color 120ms ease,
		transform 120ms ease;

	&:hover,
	&:focus-visible {
		background: rgb(255 255 255 / 0.075);
	}

	&.open {
		background: rgb(255 255 255 / 0.09);
	}

	.seventv-tverino-badge-trigger-figure {
		--tverino-badge-trigger-size: 2.052rem;
		--tverino-badge-trigger-gap: 0.12rem;
		width: var(--tverino-badge-trigger-size);
		height: var(--tverino-badge-trigger-size);
		background: rgb(255 255 255 / 0.02);
		transform: none;
	}

	.seventv-tverino-badge-trigger-track {
		width: var(--tverino-badge-trigger-size);
		height: var(--tverino-badge-trigger-size);
	}

	.seventv-tverino-badge-trigger-placeholder {
		font-size: 1rem;
	}
}

.seventv-tverino-badge-trigger-figure {
	--tverino-badge-trigger-size: 2.256rem;
	--tverino-badge-trigger-gap: 0.14rem;
	display: inline-flex;
	align-items: center;
	justify-content: flex-start;
	flex: 0 0 auto;
	width: var(--tverino-badge-trigger-size);
	height: var(--tverino-badge-trigger-size);
	border-radius: 0.45rem;
	background: rgb(255 255 255 / 0.08);
	color: rgb(255 255 255 / 0.86);
	overflow: hidden;
	transform: translate(0, 0);
}

.seventv-tverino-badge-trigger-track {
	display: flex;
	align-items: center;
	gap: var(--tverino-badge-trigger-gap);
	width: calc(
		(var(--tverino-badge-trigger-size) * var(--tverino-badge-count, 1)) +
			(var(--tverino-badge-trigger-gap) * (var(--tverino-badge-count, 1) - 1))
	);
	height: var(--tverino-badge-trigger-size);
	transform: translate3d(0, 0, 0);
	transition: transform 820ms cubic-bezier(0.16, 1, 0.3, 1);
	will-change: transform;
	backface-visibility: hidden;
}

.seventv-tverino-badge-trigger-item {
	flex: 0 0 var(--tverino-badge-trigger-size);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: var(--tverino-badge-trigger-size);
	height: var(--tverino-badge-trigger-size);
}

.seventv-tverino-badge-trigger-image {
	display: block;
	width: calc(var(--tverino-badge-trigger-size) - 0.2rem);
	height: calc(var(--tverino-badge-trigger-size) - 0.2rem);
	object-fit: contain;
	transform: none;
	filter: drop-shadow(0 0 0 transparent);
}

.seventv-tverino-points-trigger-image {
	object-fit: contain;
	transform: translateX(1px);
}

.seventv-tverino-badge-trigger-placeholder {
	font-size: 1.1rem;
	font-weight: 700;
	line-height: 1;
	text-transform: uppercase;
}

.seventv-tverino-footer-spacer {
	flex: 1 1 auto;
}

.seventv-tverino-footer-action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.85rem;
	height: 2.85rem;
	padding: 0;
	border-radius: 999px;
	color: var(--seventv-text-color-secondary);
	text-decoration: none;
	transition:
		background-color 120ms ease,
		color 120ms ease;

	svg {
		width: 1.7rem;
		height: 1.7rem;
	}

	&:hover {
		background: rgb(255 255 255 / 0.06);
		color: var(--seventv-text-color-normal);
	}

	&.open {
		background: rgb(255 255 255 / 0.08);
		color: #fff;
	}
}

.seventv-tverino-chat-button {
	min-width: 6.2rem;
	height: 3.35rem;
	padding: 0 1.5rem;
	border-radius: 999px;
	background: var(--tverino-twitch-purple);
	color: #fff;
	font-size: 1.34rem;
	font-weight: 700;
	letter-spacing: 0.01em;
	transition:
		transform 120ms ease,
		filter 120ms ease,
		opacity 120ms ease;

	&:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
	}

	&:disabled {
		opacity: 0.45;
	}
}

.seventv-tverino-suggestions {
	position: absolute;
	left: 0.8rem;
	right: 0.8rem;
	bottom: calc(100% + 0.4rem);
	display: grid;
	gap: 0.25rem;
	max-height: 24rem;
	overflow-y: auto;
	padding: 0.45rem;
	border: 0.1rem solid rgb(255 255 255 / 0.14);
	border-radius: 0.4rem;
	background: rgb(24 24 27 / 98%);
	box-shadow: 0 1.2rem 3rem rgb(0 0 0 / 38%);
	backdrop-filter: blur(6px);
	scrollbar-width: thin;
}

.seventv-tverino-carousel {
	position: absolute;
	left: 0.8rem;
	right: 0.8rem;
	bottom: calc(100% + 0.4rem);
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: stretch;
}

.seventv-tverino-carousel-group {
	display: inline-flex;
	align-items: center;
	gap: 0.55rem;
	min-height: 5rem;
	padding: 0.9rem 1rem;
	border: 0.1rem solid rgb(255 255 255 / 0.14);
	background: rgb(24 24 27 / 98%);
	box-shadow: 0 1.2rem 3rem rgb(0 0 0 / 38%);
	backdrop-filter: blur(6px);
	overflow: hidden;

	&.backwards {
		border-radius: 0.4rem 0 0 0.4rem;

		> svg {
			flex: 0 0 auto;
			transform: rotate(90deg);
		}
	}

	&.current {
		z-index: 1;
		justify-content: center;
		padding-inline: 1.2rem;
		background: var(--seventv-highlight-neutral-1);
	}

	&.forwards {
		justify-content: flex-end;
		border-radius: 0 0.4rem 0.4rem 0;

		> svg {
			flex: 0 0 auto;
			transform: rotate(-90deg);
		}
	}
}

.seventv-tverino-carousel-emote {
	flex: 0 0 auto;
}

.seventv-tverino-carousel-token {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	max-width: 12rem;
	padding: 0.45rem 0.75rem;
	border-radius: 999px;
	background: rgb(255 255 255 / 0.06);
	color: var(--seventv-text-color-normal);
	font-size: 1.2rem;
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	&.current {
		background: rgb(255 255 255 / 0.12);
	}
}

.seventv-tverino-suggestion {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.8rem;
	padding: 0.65rem 0.8rem;
	border-radius: 0.25rem;
	color: var(--seventv-text-color-normal);
	text-align: left;

	&.active,
	&:hover {
		background: rgb(255 255 255 / 0.06);
	}

	.main {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		gap: 0.7rem;
	}

	.preview {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 0.35rem;
		background: rgb(255 255 255 / 0.04);
	}

	.token {
		min-width: 0;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		flex: 0 0 auto;
		color: var(--seventv-text-color-secondary);
		font-size: 1.2rem;
		text-transform: uppercase;
	}
}

.seventv-tverino-status {
	padding: 0 0.2rem;
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
}
</style>
