import { computed, onUnmounted, reactive, watch } from "vue";
import { log } from "@/common/Logger";
import { ChannelContext } from "@/composable/channel/useChannelContext";
import { useConfig } from "@/composable/useSettings";

type PerformanceTier = "default" | "degraded" | "severe";

const LONG_TASK_WINDOW_MS = 5000;
const RECOVERY_WINDOW_MS = 10000;

const performanceMode = useConfig<boolean>("general.performance_mode");

const state = reactive({
	tier: "default" as PerformanceTier,
	backlogs: {} as Record<string, number>,
	longTasks: [] as number[],
	workerPathEnabled: true,
	virtualizationEnabled: false,
	asyncHydrationEnabled: true,
	recoverySince: 0,
	initialized: false,
});

let observer: PerformanceObserver | null = null;
let evaluationInterval: number | null = null;

function pruneLongTasks(now = Date.now()): void {
	while (state.longTasks.length && now - state.longTasks[0] > LONG_TASK_WINDOW_MS) {
		state.longTasks.shift();
	}
}

function maxBacklog(): number {
	return Math.max(0, ...Object.values(state.backlogs));
}

function evaluateTier(): void {
	const now = Date.now();
	pruneLongTasks(now);

	const backlog = maxBacklog();
	const longTaskCount = state.longTasks.length;
	const nextTier: PerformanceTier =
		longTaskCount >= 6 || backlog > 200 ? "severe" : longTaskCount >= 3 || backlog > 75 ? "degraded" : "default";

	if (nextTier !== "default") {
		state.tier = nextTier;
		state.recoverySince = 0;
		return;
	}

	if (state.tier === "default") return;

	if (!state.recoverySince) {
		state.recoverySince = now;
		return;
	}

	if (now - state.recoverySince < RECOVERY_WINDOW_MS) return;

	state.tier = state.tier === "severe" ? "degraded" : "default";
	state.recoverySince = now;
}

function ensureRuntime(): void {
	if (state.initialized) return;
	state.initialized = true;

	if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
		observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 50) continue;
				state.longTasks.push(Date.now());
			}

			evaluateTier();
		});

		try {
			observer.observe({ type: "longtask", buffered: true });
		} catch {
			observer.disconnect();
			observer = null;
		}
	}

	evaluationInterval = window.setInterval(evaluateTier, 1000);
}

function syncExperimentalPaths(enabled: boolean): void {
	state.virtualizationEnabled = enabled;
}

syncExperimentalPaths(performanceMode.value);
watch(performanceMode, (enabled) => {
	syncExperimentalPaths(enabled);
	evaluateTier();
});

export function useChatPerformance(ctx?: Pick<ChannelContext, "id">) {
	ensureRuntime();

	const backlogKey = ctx?.id;
	if (backlogKey && !(backlogKey in state.backlogs)) {
		state.backlogs[backlogKey] = 0;
	}

	onUnmounted(() => {
		if (!backlogKey) return;

		delete state.backlogs[backlogKey];
		evaluateTier();
	});

	return {
		enabled: performanceMode,
		tier: computed(() => state.tier),
		workerPathEnabled: computed(() => state.workerPathEnabled),
		virtualizationEnabled: computed(() => performanceMode.value && state.virtualizationEnabled),
		asyncHydrationEnabled: computed(() => state.asyncHydrationEnabled),
		animatedEmoteThrottlingEnabled: computed(() => true),
		prewarmEnabled: computed(() => performanceMode.value && state.tier !== "severe"),
		heavyRowsHydratedOnly: computed(() => performanceMode.value && state.tier !== "default"),
		richEmbedsEnabled: computed(() => !performanceMode.value || state.tier !== "severe"),
		animatedAvatarsEnabled: computed(() => state.tier !== "severe"),
		effectiveBatchDurationMin: computed(() => {
			if (!performanceMode.value) return 0;
			if (state.tier === "severe") return 300;
			if (state.tier === "degraded") return 150;
			return 0;
		}),
		effectiveLineLimitCap: computed(() => {
			if (!performanceMode.value) return null;
			if (state.tier === "severe") return 120;
			if (state.tier === "degraded") return 200;
			return null;
		}),
		smoothScrollEnabled: computed(() => !performanceMode.value || state.tier === "default"),
		setBacklog(value: number) {
			if (!backlogKey) return;

			state.backlogs[backlogKey] = value;
			evaluateTier();
		},
		disableWorkerPath(reason: string) {
			if (!state.workerPathEnabled) return;

			log.warn("<PerformanceMode>", `Disabling worker chat preprocessing for this session: ${reason}`);
			state.workerPathEnabled = false;
		},
		disableVirtualization(reason: string) {
			if (!state.virtualizationEnabled) return;

			log.warn("<PerformanceMode>", `Disabling virtualized chat rendering for this session: ${reason}`);
			state.virtualizationEnabled = false;
		},
		disableAsyncHydration(reason: string) {
			if (!state.asyncHydrationEnabled) return;

			log.warn("<PerformanceMode>", `Disabling async hydration for this session: ${reason}`);
			state.asyncHydrationEnabled = false;
		},
		resetExperimentalPaths() {
			state.workerPathEnabled = true;
			state.asyncHydrationEnabled = true;
			syncExperimentalPaths(performanceMode.value);
			evaluateTier();
		},
	};
}

window.addEventListener("beforeunload", () => {
	if (evaluationInterval !== null) {
		clearInterval(evaluationInterval);
		evaluationInterval = null;
	}

	if (observer) {
		observer.disconnect();
		observer = null;
	}
});
