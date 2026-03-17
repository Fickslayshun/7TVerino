<template>
	<UiFloating
		:anchor="anchorEl"
		emit-clickout
		placement="top-start"
		:middleware="middleware"
		@clickout="emit('clickout', $event)"
	>
		<div class="seventv-tverino-points-panel">
			<div class="panel-header">
				<div class="panel-title-wrap">
					<h3>Power-ups &amp; Rewards</h3>
					<p>{{ channelLabel }}</p>
				</div>

				<button class="panel-close" type="button" aria-label="Close rewards panel" @click="emit('close')">
					&times;
				</button>
			</div>

			<section class="panel-section">
				<header class="panel-section-title">Balance</header>
				<div class="panel-balance-card">
					<span class="panel-balance-icon" :style="iconStyle">
						<img v-if="iconSource" class="panel-balance-image" :src="iconSource" :alt="pointName" />
						<TwitchChannelPointsIcon v-else />
					</span>

					<div class="panel-balance-copy">
						<span class="panel-balance-value" :class="{ animating: balanceAnimating }">
							{{ animatedBalanceDisplay }}
						</span>
						<span class="panel-balance-name">{{ pointName }}</span>
					</div>
				</div>

				<p v-if="notice" class="panel-feedback" :class="{ error: noticeIsError }">
					{{ notice }}
				</p>
			</section>

			<section class="panel-section">
				<header class="panel-section-title">Rewards</header>
				<p class="panel-section-description">Remote-aware rewards list for {{ channelLabel }}.</p>

				<p v-if="loading" class="panel-empty">Loading rewards...</p>

				<div v-else-if="rewards.length" class="panel-reward-list">
					<div
						v-for="reward of rewards"
						:key="reward.id"
						class="panel-reward-entry"
						:class="{ expanded: expandedRewardId === reward.id }"
					>
						<button
							class="panel-reward-row"
							:class="{
								expandable: isRewardExpandable(reward),
								redeemable: isRewardRedeemable(reward),
								redeeming: redeemingRewardId === reward.id,
								cooldown: isRewardOnCooldown(reward),
							}"
							type="button"
							:disabled="!isRewardClickable(reward)"
							@click="toggleRewardExpansion(reward)"
						>
							<span class="panel-reward-accent">
								<TwitchChannelPointsIcon />
							</span>

							<span class="panel-reward-copy">
								<span class="panel-reward-title">{{ reward.title }}</span>
								<span v-if="reward.prompt && reward.prompt !== reward.title" class="panel-reward-meta">
									{{ reward.prompt }}
								</span>
								<span
									v-if="getRewardStatusText(reward)"
									class="panel-reward-meta panel-reward-meta-status"
									:class="{ cooldown: isRewardOnCooldown(reward) }"
								>
									{{ getRewardStatusText(reward) }}
								</span>
								<span
									v-if="!isRewardExpandable(reward)"
									class="panel-reward-meta panel-reward-meta-muted"
								>
									Native automatic reward
								</span>
							</span>

							<span class="panel-reward-cost">
								<span v-if="redeemingRewardId === reward.id">Redeeming...</span>
								<span v-else-if="isRewardOnCooldown(reward)" class="panel-reward-cooldown">
									{{ formatRewardCooldown(reward) }}
								</span>
								<template v-else>
									<TwitchChannelPointsIcon />
									{{ formatPoints(reward.cost) }}
								</template>
							</span>
						</button>

						<transition name="panel-reward-confirm">
							<div
								v-if="expandedRewardId === reward.id && isRewardRedeemable(reward)"
								class="panel-reward-confirm"
							>
								<button
									class="panel-reward-confirm-button"
									:class="{
										redeemed: isRewardRedeemed(reward),
										cooldown: isRewardOnCooldown(reward),
									}"
									type="button"
									:disabled="
										redeemingRewardId.length > 0 ||
										isRewardRedeemed(reward) ||
										!isRewardRedeemable(reward)
									"
									@click="confirmRedeem(reward)"
								>
									<span
										v-if="isRewardRedeemed(reward)"
										class="panel-reward-confirm-check"
										aria-hidden="true"
										>&#10003;</span
									>
									<span>{{ getRewardConfirmLabel(reward) }}</span>
									<span v-if="showRewardConfirmCost(reward)" class="panel-reward-confirm-cost">
										<TwitchChannelPointsIcon />
										{{ formatPoints(reward.cost) }}
									</span>
								</button>
							</div>
						</transition>
					</div>
				</div>

				<p v-else class="panel-empty">No channel-point rewards were found for this chat.</p>
			</section>

			<section class="panel-section panel-section-note">
				<p class="panel-note">
					Custom rewards expand with a confirm action here. Native automatic rewards still use Twitch's
					separate flow.
				</p>
			</section>
		</div>
	</UiFloating>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import TwitchChannelPointsIcon from "@/assets/svg/icons/TwitchChannelPointsIcon.vue";
import type { TVerinoChannelPointsReward } from "./useTVerinoChannelPoints";
import UiFloating from "@/ui/UiFloating.vue";
import { offset, shift } from "@floating-ui/dom";

const props = defineProps<{
	anchorEl: HTMLElement;
	channelLabel: string;
	pointName: string;
	balance: number | null;
	balanceDisplay: string;
	loading: boolean;
	notice: string;
	noticeIsError: boolean;
	rewards: TVerinoChannelPointsReward[];
	redeemableRewardIds: string[];
	redeemedRewardId: string;
	redeemingRewardId: string;
	iconImage: string;
	iconBackgroundColor: string;
}>();

const emit = defineEmits<{
	(event: "close"): void;
	(event: "clickout", native: PointerEvent): void;
	(event: "redeem", reward: TVerinoChannelPointsReward): void;
}>();

const middleware = [offset({ mainAxis: 10 }), shift({ padding: 8 })];
const numberFormatter = new Intl.NumberFormat(undefined);
const iconSource = computed(() => props.iconImage || "");
const iconStyle = computed(() => ({
	backgroundColor: "rgb(255 255 255 / 0.08)",
}));
const expandedRewardId = ref("");
const animatedBalance = ref<number | null>(props.balance);
const balanceAnimating = ref(false);
const rewardCooldownNow = ref(Date.now());
let balanceAnimationFrame = 0;
let balanceAnimationToken = 0;
let rewardCooldownInterval = 0;
let lastAnimatedBalance = props.balance;
const hasActiveRewardCooldowns = computed(() =>
	props.rewards.some((reward) => getRewardCooldownRemainingMs(reward) > 0),
);

const animatedBalanceDisplay = computed(() => {
	if (animatedBalance.value === null) return props.balanceDisplay;
	return numberFormatter.format(animatedBalance.value);
});

watch(
	() => props.redeemingRewardId,
	(nextRewardId) => {
		if (nextRewardId) {
			expandedRewardId.value = nextRewardId;
		}
	},
);

watch(
	() => props.redeemedRewardId,
	(nextRewardId) => {
		if (nextRewardId) {
			expandedRewardId.value = nextRewardId;
		}
	},
);

watch(
	() => props.rewards.map((reward) => reward.id),
	(nextRewardIds) => {
		if (expandedRewardId.value && !nextRewardIds.includes(expandedRewardId.value)) {
			expandedRewardId.value = "";
		}
	},
);

watch(
	() => props.balance,
	(nextBalance) => {
		const previousBalance = lastAnimatedBalance;
		lastAnimatedBalance = nextBalance;

		if (nextBalance === null) {
			stopBalanceAnimation();
			animatedBalance.value = null;
			balanceAnimating.value = false;
			return;
		}

		if (previousBalance === null || previousBalance === undefined) {
			stopBalanceAnimation();
			animatedBalance.value = nextBalance;
			balanceAnimating.value = false;
			return;
		}

		if (previousBalance === nextBalance) {
			stopBalanceAnimation();
			animatedBalance.value = nextBalance;
			balanceAnimating.value = false;
			return;
		}

		animateBalance(previousBalance, nextBalance);
	},
);

watch(
	hasActiveRewardCooldowns,
	(active) => {
		if (active) {
			startRewardCooldownTicker();
			return;
		}

		stopRewardCooldownTicker();
		rewardCooldownNow.value = Date.now();
	},
	{ immediate: true },
);

onUnmounted(() => {
	stopBalanceAnimation();
	stopRewardCooldownTicker();
});

function formatPoints(value: number): string {
	return numberFormatter.format(value);
}

function animateBalance(from: number, to: number): void {
	stopBalanceAnimation();

	const directionDistance = Math.abs(to - from);
	const duration = Math.min(900, Math.max(320, directionDistance * 1.1));
	const startedAt = performance.now();
	const token = ++balanceAnimationToken;
	balanceAnimating.value = true;
	animatedBalance.value = from;

	const tick = (now: number): void => {
		if (token !== balanceAnimationToken) return;

		const elapsed = now - startedAt;
		const progress = Math.min(1, elapsed / duration);
		const eased = 1 - Math.pow(1 - progress, 3);
		const nextValue = Math.round(from + (to - from) * eased);
		animatedBalance.value = progress >= 1 ? to : nextValue;

		if (progress < 1) {
			balanceAnimationFrame = window.requestAnimationFrame(tick);
			return;
		}

		balanceAnimating.value = false;
		balanceAnimationFrame = 0;
	};

	balanceAnimationFrame = window.requestAnimationFrame(tick);
}

function stopBalanceAnimation(): void {
	if (balanceAnimationFrame) {
		window.cancelAnimationFrame(balanceAnimationFrame);
		balanceAnimationFrame = 0;
	}
	balanceAnimationToken++;
}

function startRewardCooldownTicker(): void {
	if (rewardCooldownInterval) return;
	rewardCooldownNow.value = Date.now();
	rewardCooldownInterval = window.setInterval(() => {
		rewardCooldownNow.value = Date.now();
		if (!hasActiveRewardCooldowns.value) {
			stopRewardCooldownTicker();
		}
	}, 1000);
}

function stopRewardCooldownTicker(): void {
	if (!rewardCooldownInterval) return;
	window.clearInterval(rewardCooldownInterval);
	rewardCooldownInterval = 0;
}

function isRewardExpandable(reward: TVerinoChannelPointsReward): boolean {
	return props.redeemableRewardIds.includes(reward.id);
}

function isRewardRedeemable(reward: TVerinoChannelPointsReward): boolean {
	if (!isRewardExpandable(reward)) return false;
	if (!reward.isEnabled || reward.isPaused) return false;

	const cooldownRemainingMs = getRewardCooldownRemainingMs(reward);
	if (cooldownRemainingMs > 0) return false;
	if (reward.cooldownExpiresAt && cooldownRemainingMs === 0) return true;

	return reward.isInStock;
}

function isRewardRedeemed(reward: TVerinoChannelPointsReward): boolean {
	return props.redeemedRewardId === reward.id;
}

function isRewardClickable(reward: TVerinoChannelPointsReward): boolean {
	return isRewardExpandable(reward) && !props.redeemingRewardId.length;
}

function toggleRewardExpansion(reward: TVerinoChannelPointsReward): void {
	if (!isRewardClickable(reward)) return;
	if (isRewardRedeemed(reward) && expandedRewardId.value === reward.id) return;
	expandedRewardId.value = expandedRewardId.value === reward.id ? "" : reward.id;
}

function confirmRedeem(reward: TVerinoChannelPointsReward): void {
	if (!isRewardClickable(reward) || !isRewardRedeemable(reward)) return;
	expandedRewardId.value = reward.id;
	emit("redeem", reward);
}

function getRewardCooldownRemainingMs(reward: TVerinoChannelPointsReward): number {
	if (!reward.cooldownExpiresAt) return 0;

	const cooldownExpiresAt = Date.parse(reward.cooldownExpiresAt);
	if (Number.isNaN(cooldownExpiresAt)) return 0;

	return Math.max(0, cooldownExpiresAt - rewardCooldownNow.value);
}

function isRewardOnCooldown(reward: TVerinoChannelPointsReward): boolean {
	return getRewardCooldownRemainingMs(reward) > 0;
}

function formatRewardCooldown(reward: TVerinoChannelPointsReward): string {
	return formatCooldown(getRewardCooldownRemainingMs(reward));
}

function formatCooldown(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getRewardStatusText(reward: TVerinoChannelPointsReward): string {
	if (isRewardOnCooldown(reward)) {
		return `Cooldown: ${formatRewardCooldown(reward)}`;
	}
	if (reward.isPaused) {
		return "Reward paused";
	}
	if (!reward.isEnabled) {
		return "Reward disabled";
	}
	if (!reward.isInStock && !reward.cooldownExpiresAt) {
		return "Temporarily unavailable";
	}
	return "";
}

function getRewardConfirmLabel(reward: TVerinoChannelPointsReward): string {
	if (isRewardRedeemed(reward)) return "Redeemed";
	if (isRewardOnCooldown(reward)) return `Available in ${formatRewardCooldown(reward)}`;
	if (reward.isPaused) return "Reward paused";
	if (!reward.isEnabled) return "Reward disabled";
	if (!reward.isInStock && !reward.cooldownExpiresAt) return "Temporarily unavailable";
	return "Redeem";
}

function showRewardConfirmCost(reward: TVerinoChannelPointsReward): boolean {
	return !isRewardRedeemed(reward) && isRewardRedeemable(reward);
}
</script>

<style scoped lang="scss">
.seventv-tverino-points-panel {
	width: 33rem;
	max-width: min(33rem, calc(100vw - 1.6rem));
	padding: 1.5rem 0 1.2rem;
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
	gap: 1rem;
	padding: 0 1.5rem 1.15rem;
	border-bottom: 0.1rem solid rgb(255 255 255 / 0.08);
}

.panel-title-wrap {
	min-width: 0;

	h3 {
		margin: 0;
		color: #fff;
		font-size: 1.95rem;
		font-weight: 700;
		line-height: 1.2;
	}

	p {
		margin: 0.4rem 0 0;
		color: rgb(255 255 255 / 0.62);
		font-size: 1.2rem;
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
	padding: 1.25rem 1.5rem 0;
}

.panel-section-title {
	margin-bottom: 0.95rem;
	color: rgb(255 255 255 / 0.74);
	font-size: 1.15rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.panel-section-description,
.panel-note {
	margin: 0;
	color: rgb(255 255 255 / 0.58);
	font-size: 1.2rem;
	line-height: 1.45;
}

.panel-balance-card {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 1rem 1.05rem;
	border: 0.1rem solid rgb(255 255 255 / 0.08);
	border-radius: 0.7rem;
	background: rgb(255 255 255 / 0.03);
}

.panel-balance-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 3.3rem;
	height: 3.3rem;
	border-radius: 999px;
	color: rgb(255 255 255 / 0.7);

	svg,
	img {
		width: 1.9rem;
		height: 1.9rem;
		object-fit: contain;
	}
}

.panel-balance-copy {
	display: grid;
	min-width: 0;
}

.panel-balance-value {
	color: rgb(255 255 255 / 0.9);
	font-size: 1.95rem;
	font-weight: 700;
	line-height: 1.1;
	font-variant-numeric: tabular-nums;
	transition:
		color 160ms ease,
		text-shadow 160ms ease;

	&.animating {
		color: rgb(255 255 255 / 0.94);
		text-shadow: 0 0 1.2rem rgb(255 255 255 / 0.05);
	}
}

.panel-balance-name {
	margin-top: 0.25rem;
	color: rgb(255 255 255 / 0.62);
	font-size: 1.2rem;
	line-height: 1.35;
}

.panel-feedback {
	margin: 1rem 0 0;
	color: rgb(255 255 255 / 0.76);
	font-size: 1.2rem;
	line-height: 1.45;

	&.error {
		color: #ff8f8f;
	}
}

.panel-reward-list {
	display: grid;
	gap: 0.55rem;
	max-height: 24rem;
	overflow-y: auto;
	padding-right: 0.1rem;
}

.panel-reward-entry {
	display: grid;
	gap: 0.45rem;
}

.panel-reward-row {
	display: grid;
	grid-template-columns: auto 1fr auto;
	align-items: center;
	gap: 0.9rem;
	padding: 0.8rem 0.95rem;
	border: 0;
	border-radius: 0.65rem;
	background: rgb(255 255 255 / 0.04);
	text-align: left;
	transition:
		background-color 120ms ease,
		opacity 120ms ease;

	&.expandable:hover:not(:disabled),
	&.expandable:focus-visible:not(:disabled) {
		background: rgb(255 255 255 / 0.08);
	}

	&:disabled {
		cursor: default;
	}

	&:not(.redeemable) {
		opacity: 0.72;
	}
}

.panel-reward-entry.expanded .panel-reward-row {
	border-bottom-left-radius: 0.45rem;
	border-bottom-right-radius: 0.45rem;
	background: rgb(255 255 255 / 0.08);
}

.panel-reward-accent {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 2.6rem;
	height: 2.6rem;
	border-radius: 0.6rem;
	background: rgb(255 255 255 / 0.06);
	color: rgb(255 255 255 / 0.88);

	svg {
		width: 1.45rem;
		height: 1.45rem;
	}
}

.panel-reward-copy {
	display: grid;
	min-width: 0;
}

.panel-reward-title {
	color: rgb(255 255 255 / 0.92);
	font-size: 1.25rem;
	font-weight: 600;
	line-height: 1.3;
}

.panel-reward-meta {
	margin-top: 0.15rem;
	color: rgb(255 255 255 / 0.52);
	font-size: 1.1rem;
	line-height: 1.35;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.panel-reward-meta-muted {
	color: rgb(255 255 255 / 0.42);
}

.panel-reward-meta-status {
	color: rgb(255 255 255 / 0.62);

	&.cooldown {
		color: rgb(255 255 255 / 0.78);
	}
}

.panel-reward-cost {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	color: rgb(255 255 255 / 0.76);
	font-size: 1.2rem;
	font-weight: 700;
	white-space: nowrap;

	svg {
		width: 1.35rem;
		height: 1.35rem;
	}
}

.panel-reward-cooldown {
	color: rgb(255 255 255 / 0.78);
	font-variant-numeric: tabular-nums;
}

.panel-reward-confirm {
	overflow: hidden;
	padding: 0 0.3rem 0.2rem;
}

.panel-reward-confirm-button {
	display: inline-flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	min-height: 3.6rem;
	padding: 0.85rem 1rem;
	border: 0.1rem solid rgb(255 255 255 / 0.14);
	border-radius: 0.6rem;
	background: rgb(255 255 255 / 0.06);
	color: #fff;
	font-size: 1.2rem;
	font-weight: 700;
	line-height: 1.2;
	transition:
		border-color 120ms ease,
		background-color 120ms ease,
		opacity 120ms ease;

	&:hover:not(:disabled),
	&:focus-visible:not(:disabled) {
		border-color: rgb(255 255 255 / 0.2);
		background: rgb(255 255 255 / 0.1);
	}

	&:disabled {
		opacity: 0.72;
	}

	&.redeemed {
		justify-content: center;
		gap: 0.7rem;
		border-color: rgb(0 186 124 / 0.3);
		background: rgb(0 186 124 / 0.14);
		color: rgb(226 255 242 / 0.98);
		cursor: default;
	}

	&.cooldown {
		border-color: rgb(255 255 255 / 0.14);
		background: rgb(255 255 255 / 0.05);
		color: rgb(255 255 255 / 0.78);
		cursor: default;
	}
}

.panel-reward-confirm-cost {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	color: rgb(255 255 255 / 0.84);
	white-space: nowrap;

	svg {
		width: 1.35rem;
		height: 1.35rem;
	}
}

.panel-reward-confirm-check {
	font-size: 1.5rem;
	line-height: 1;
	font-weight: 700;
}

.panel-reward-confirm-enter-active,
.panel-reward-confirm-leave-active {
	transition:
		max-height 160ms ease,
		opacity 160ms ease,
		transform 160ms ease,
		margin-top 160ms ease;
}

.panel-reward-confirm-enter-from,
.panel-reward-confirm-leave-to {
	max-height: 0;
	opacity: 0;
	transform: translateY(-0.35rem);
	margin-top: -0.2rem;
}

.panel-reward-confirm-enter-to,
.panel-reward-confirm-leave-from {
	max-height: 6rem;
	opacity: 1;
	transform: translateY(0);
	margin-top: 0;
}

.panel-empty {
	margin: 0;
	color: rgb(255 255 255 / 0.56);
	font-size: 1.2rem;
	line-height: 1.45;
}

.panel-section-note {
	padding-top: 1.1rem;
}
</style>
