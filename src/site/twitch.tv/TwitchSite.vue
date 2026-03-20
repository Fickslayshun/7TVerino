<template>
	<template v-for="[key, mod] of Object.entries(mountedModules)" :key="key">
		<ModuleWrapper :mod="mod.component" @mounted="onModuleUpdate(resolveModuleID(key) as TwModuleID, $event)" />
	</template>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import { useStore } from "@/store/main";
import { SITE_CURRENT_PLATFORM, SITE_NAV_PATHNAME } from "@/common/Constant";
import { useComponentHook, useElementFiberHook } from "@/common/ReactHooks";
import { useActor } from "@/composable/useActor";
import { useApollo } from "@/composable/useApollo";
import { useFrankerFaceZ } from "@/composable/useFrankerFaceZ";
import { getModule } from "@/composable/useModule";
import { synchronizeFrankerFaceZ, useConfig, useSettings } from "@/composable/useSettings";
import { useUserAgent } from "@/composable/useUserAgent";
import { useWorker } from "@/composable/useWorker";
import { setTwitchHelixAuth } from "./modules/chat/twitchHelixAuth";
import type { TwModuleID } from "@/types/tw.module";
import type { ApolloClient } from "@apollo/client";

const ModuleWrapper = defineAsyncComponent(() => import("@/site/global/ModuleWrapper.vue"));

const store = useStore();
const actor = useActor();
const ua = useUserAgent();
const ffz = useFrankerFaceZ();
const apollo = useApollo();
const { sendMessage: sendWorkerMessage } = useWorker();

ua.preferredFormat = store.avifSupported ? "AVIF" : "WEBP";
store.setPreferredImageFormat(ua.preferredFormat);
store.setPlatform("TWITCH", ["7TV", "FFZ", "BTTV"], ffz.active ? ["FFZ"] : []);

const currentPath = ref("");

provide(SITE_CURRENT_PLATFORM, "TWITCH");
provide(SITE_NAV_PATHNAME, currentPath);

const settings = useSettings();
const moduleConfigs = import.meta.glob<SevenTV.SettingNode[]>(
	[
		"./modules/autoclaim/AutoclaimModule.vue",
		"./modules/avatars/AvatarsModule.vue",
		"./modules/chat/ChatModule.vue",
		"./modules/chat-input/ChatInputModule.vue",
		"./modules/chat-vod/ChatVodModule.vue",
		"./modules/emote-menu/EmoteMenuModule.vue",
		"./modules/hidden-elements/HiddenElementsModule.vue",
		"./modules/mod-logs/ModLogsModule.vue",
		"./modules/player/PlayerModule.vue",
		"./modules/settings/SettingsModule.vue",
		"./modules/sidebar-previews/SidebarPreviewsModule.vue",
	],
	{
		eager: true,
		import: "config",
	},
);
settings.register(Object.values(moduleConfigs).flatMap((config) => config ?? []));

const moduleLoaders = import.meta.glob<ComponentFactory>("./modules/**/*Module.vue", {
	import: "default",
});
const mountedModules = reactive<Record<string, { component: ComponentFactory }>>({});
const modulePathsByKey = {} as Record<string, string>;
const loadingModules = new Set<string>();
const deferredModuleKeys = new Set([
	"autoclaim",
	"avatars",
	"custom-commands",
	"mod-logs",
	"player",
	"sidebar-previews",
]);

for (const path in moduleLoaders) {
	modulePathsByKey[getModuleKey(path)] = path;
}

const autoClaimEnabled = useConfig<boolean>("general.autoclaim.channel_points", false);
const animatedAvatarsEnabled = useConfig<boolean>("avatars.animation", true);
const modLogsEnabled = useConfig<boolean>("chat.mod_logs.enabled", true);
const showSidebarPreviews = useConfig<boolean>("ui.sidebar_previews", false);
const expandSidebarOnHover = useConfig<boolean>("ui.sidebar_hover_expand", false);
const replaceSidebarHoverBox = useConfig<boolean>("layout.sidebar_inline_hover_details", false);
const shouldSkipContentRestriction = useConfig<boolean>("player.skip_content_restriction", false);
const shouldShowVideoStats = useConfig<boolean>("player.video_stats", false);
const playerActionOnClick = useConfig<number>("player.action_onclick", 0);

for (const key of Object.keys(modulePathsByKey)) {
	if (deferredModuleKeys.has(key)) continue;
	void loadModule(key);
}

// Session User
useComponentHook<Twitch.UserAndSessionUserComponent>(
	{
		predicate: (n) => {
			return !!n.props?.user || !!n.props?.sessionUser;
		},
		maxDepth: 200,
	},
	{
		hooks: {
			update: (inst) => {
				if (!inst.component || !inst.component.props) return;
				const user = inst.component.props.user ?? inst.component.props.sessionUser;
				store.setIdentity("TWITCH", {
					id: user.id,
					username: user.login,
					displayName: user.displayName,
				});
				actor.setPlatformUserID("TWITCH", user.id);

				if (user.authToken) {
					setTwitchHelixAuth({
						token: user.authToken,
					});

					sendWorkerMessage("TVERINO_CHAT_AUTH", {
						login: user.login,
						userID: user.id,
						token: user.authToken,
					});
				}
			},
		},
	},
);

// Router updates
useComponentHook<Twitch.RouterComponent>(
	{
		predicate: (n) => n.props && n.props.params && n.props.navigate,
	},
	{
		hooks: {
			update(v) {
				if (!v.component || !v.component.props || !v.component.props.location) return;

				currentPath.value = v.component.props.location.pathname;
			},
		},
	},
);

useElementFiberHook<{ client: ApolloClient<object> }>(
	{
		maxDepth: 50,
		predicate: (n) => !!(n.memoizedProps && n.memoizedProps.client && n.memoizedProps.client.query),
	},
	{
		hooks: {
			render(old, props, ref) {
				apollo.value = props.client;

				return old?.call(this, props, ref) ?? null;
			},
		},
	},
);

function onModuleUpdate(mod: TwModuleID, inst: InstanceType<ComponentFactory>) {
	const modInst = getModule(mod);
	if (!modInst) return;

	modInst.instance = inst;
}

let deferredLoadFrame: number | null = null;
let deferredLoadObserver: MutationObserver | null = null;

function getModuleKey(path: string): string {
	const modPath = path.split("/");
	return modPath.splice(modPath.length - 2, 1).pop() ?? path;
}

function resolveModuleID(key: string): string {
	return key === "custom-commands" ? "command-manager" : key;
}

async function loadModule(key: string): Promise<void> {
	if (mountedModules[key] || loadingModules.has(key)) return;

	const path = modulePathsByKey[key];
	const loader = path ? moduleLoaders[path] : null;
	if (!loader) return;

	loadingModules.add(key);
	try {
		mountedModules[key] = {
			component: await loader(),
		};
		deferredModuleKeys.delete(key);
		if (!deferredModuleKeys.size && deferredLoadObserver) {
			deferredLoadObserver.disconnect();
			deferredLoadObserver = null;
		}
	} finally {
		loadingModules.delete(key);
	}
}

function shouldLoadDeferredModule(key: string): boolean {
	if (mountedModules[key] || loadingModules.has(key)) return false;

	switch (key) {
		case "autoclaim":
			return autoClaimEnabled.value && !!document.querySelector(".community-points-summary");
		case "avatars":
			return animatedAvatarsEnabled.value && !!document.querySelector(".tw-avatar");
		case "custom-commands":
			return !!document.querySelector(".chat-input__textarea");
		case "mod-logs":
			return modLogsEnabled.value && !!document.querySelector(".chat-input");
		case "player":
			return (
				(shouldSkipContentRestriction.value || shouldShowVideoStats.value || playerActionOnClick.value > 0) &&
				!!document.querySelector(".persistent-player")
			);
		case "sidebar-previews":
			return (
				(showSidebarPreviews.value || expandSidebarOnHover.value || replaceSidebarHoverBox.value) &&
				!!document.querySelector(".side-nav")
			);
		default:
			return true;
	}
}

function queueDeferredModuleLoad(): void {
	if (deferredLoadFrame !== null) return;

	deferredLoadFrame = requestAnimationFrame(() => {
		deferredLoadFrame = null;

		for (const key of deferredModuleKeys) {
			if (!shouldLoadDeferredModule(key)) continue;
			void loadModule(key);
		}
	});
}

watch(
	[
		currentPath,
		autoClaimEnabled,
		animatedAvatarsEnabled,
		modLogsEnabled,
		showSidebarPreviews,
		expandSidebarOnHover,
		replaceSidebarHoverBox,
		shouldSkipContentRestriction,
		shouldShowVideoStats,
		playerActionOnClick,
	],
	() => queueDeferredModuleLoad(),
	{ immediate: true },
);

onMounted(() => {
	synchronizeFrankerFaceZ();
	queueDeferredModuleLoad();

	if (deferredModuleKeys.size) {
		deferredLoadObserver = new MutationObserver(() => queueDeferredModuleLoad());
		deferredLoadObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}
});

onUnmounted(() => {
	if (deferredLoadFrame !== null) {
		cancelAnimationFrame(deferredLoadFrame);
		deferredLoadFrame = null;
	}

	deferredLoadObserver?.disconnect();
	deferredLoadObserver = null;
});
</script>
