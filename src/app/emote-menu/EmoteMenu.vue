<template>
	<UiFloating
		:anchor="anchorEl"
		placement="top-end"
		:middleware="[shift({ padding: 4, mainAxis: true, crossAxis: true }), offset({ mainAxis: 4, crossAxis: -4 })]"
	>
		<div v-if="ctx.open && ctx.channelID" ref="containerRef" class="seventv-emote-menu">
			<div class="seventv-emote-menu-header" :class="{ 'disabled-search-input': isSearchInputEnabled }">
				<!-- Emote Menu Header -->
				<div class="seventv-emote-menu-providers">
					<template v-for="(b, key) in visibleProviders">
						<div
							v-if="b || key === resolvedActiveProvider"
							:key="key"
							class="seventv-emote-menu-provider-icon"
							:selected="key === resolvedActiveProvider"
							@click="activeProvider = key"
						>
							<Logo v-if="key !== 'FAVORITE'" :provider="key" />
							<StarIcon v-else />
							<span v-show="key === resolvedActiveProvider">
								<template v-if="key === 'PLATFORM'">{{ platform }}</template>
								<template v-else>{{ key }}</template>
							</span>
						</div>
					</template>
				</div>
				<div v-if="!isSearchInputEnabled" class="seventv-emote-menu-search">
					<input
						ref="searchInputRef"
						v-model="ctx.filter"
						class="seventv-emote-menu-search-input"
						autofocus
					/>
					<div class="search-icon">
						<SearchIcon />
					</div>
				</div>
			</div>

			<!-- Emote menu body -->
			<div
				v-if="resolvedActiveProvider"
				:key="`${props.channelId ?? ctx.channelID}:${resolvedActiveProvider}`"
				class="seventv-emote-menu-body"
			>
				<EmoteMenuTab
					:channel-ctx="props.channelCtx"
					:channel-id="props.channelId ?? ctx.channelID"
					:provider="resolvedActiveProvider"
					:selected="true"
					@emote-clicked="emit('emote-click', $event)"
					@toggle-settings="settingsContext.toggle()"
					@toggle-native-menu="[toggle(), emit('toggle-native-menu')]"
				/>
			</div>
		</div>
	</UiFloating>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch, watchEffect } from "vue";
import { onClickOutside, onKeyStroke, useEventListener, useKeyModifier } from "@vueuse/core";
import { useStore } from "@/store/main";
import { CHANNEL_CTX, type ChannelContext, useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useCosmetics } from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import SearchIcon from "@/assets/svg/icons/SearchIcon.vue";
import StarIcon from "@/assets/svg/icons/StarIcon.vue";
import Logo from "@/assets/svg/logos/Logo.vue";
import { useEmoteMenuContext } from "./EmoteMenuContext";
import EmoteMenuTab from "./EmoteMenuTab.vue";
import { useSettingsMenu } from "@/app/settings/Settings";
import UiFloating from "@/ui/UiFloating.vue";
import { offset, shift } from "@floating-ui/dom";

export type EmoteMenuTabName = SevenTV.Provider | "FAVORITE";

const props = defineProps<{
	anchorEl: HTMLElement;
	width?: string;
	scale?: string;
	channelId?: string;
	channelCtx?: ChannelContext;
}>();

const emit = defineEmits<{
	(e: "emote-click", emote: SevenTV.ActiveEmote): void;
	(e: "toggle-native-menu"): void;
	(e: "close", ev: MouseEvent): void;
}>();

const containerRef = ref<HTMLElement | undefined>();

const inheritedChannelCtx = useChannelContext();
const channelCtx = props.channelCtx ?? inheritedChannelCtx;
provide(CHANNEL_CTX, channelCtx);
const ctx = useEmoteMenuContext();
watch(
	() => props.channelId,
	(id) => {
		if (props.channelCtx || !id || channelCtx.id === id) return;

		channelCtx.setCurrentChannel({
			id,
			username: channelCtx.username,
			displayName: channelCtx.displayName,
			active: true,
		});
	},
	{ immediate: true },
);
watch(
	() => props.channelId ?? channelCtx.id,
	(id) => {
		ctx.channelID = id;
	},
	{ immediate: true },
);

const settingsContext = useSettingsMenu();
const store = useStore();
const { providers, platform } = store;
const emotes = useChatEmotes(channelCtx);
const cosmetics = useCosmetics(store.identity?.id ?? "");
const favorites = useConfig<Set<string>>("ui.emote_menu.favorites");
const PROVIDER_ORDER = ["FAVORITE", "7TV", "FFZ", "BTTV", "PLATFORM", "EMOJI"] as const satisfies readonly EmoteMenuTabName[];

const searchInputRef = ref<HTMLInputElement | undefined>();

const isSearchInputEnabled = useConfig<boolean>("ui.emote_menu_search");
const defaultTab = useConfig<EmoteMenuTabName>("ui.emote_menu.default_tab", "7TV");

const activeProvider = ref<EmoteMenuTabName | null>(defaultTab.value);
const searchFilter = computed(() => ctx.filter.trim().toLowerCase());
const personalSets = computed(() =>
	Array.from(cosmetics.emoteSets?.values() ?? []).filter((set) => set.provider !== "EMOJI"),
);

function emoteMatchesFilter(emote: SevenTV.ActiveEmote, filter: string): boolean {
	return !filter || emote.name.toLowerCase().includes(filter);
}

function setHasVisibleEmote(set: SevenTV.EmoteSet, filter: string): boolean {
	if (!set.emotes.length) return false;
	if (!filter) return true;

	return set.emotes.some((emote) => emoteMatchesFilter(emote, filter));
}

function providerExists(provider: EmoteMenuTabName): boolean {
	switch (provider) {
		case "7TV":
		case "FFZ":
		case "BTTV":
			return providers.has(provider);
		default:
			return true;
	}
}

function providerHasVisibleContent(provider: EmoteMenuTabName, filter: string): boolean {
	if (!providerExists(provider)) return false;

	if (provider === "FAVORITE") {
		if (!favorites.value?.size) return false;

		for (const emoteID of favorites.value) {
			const emote = emotes.find((ae) => ae.id === emoteID);
			if (emote && emoteMatchesFilter(emote, filter)) return true;
		}

		return false;
	}

	for (const set of Object.values(emotes.byProvider(provider as SevenTV.Provider) ?? {})) {
		if (setHasVisibleEmote(set, filter)) return true;
	}

	for (const set of personalSets.value) {
		if (set.provider === provider && setHasVisibleEmote(set, filter)) return true;
	}

	return false;
}

const visibleProviders = computed<Record<EmoteMenuTabName, boolean>>(() => ({
	FAVORITE: providerHasVisibleContent("FAVORITE", searchFilter.value),
	"7TV": providerHasVisibleContent("7TV", searchFilter.value),
	FFZ: providerHasVisibleContent("FFZ", searchFilter.value),
	BTTV: providerHasVisibleContent("BTTV", searchFilter.value),
	PLATFORM: providerHasVisibleContent("PLATFORM", searchFilter.value),
	EMOJI: providerHasVisibleContent("EMOJI", searchFilter.value),
}));
const orderedVisibleProviders = computed(() =>
	PROVIDER_ORDER.filter((provider) => visibleProviders.value[provider]),
);
const resolvedActiveProvider = computed<EmoteMenuTabName | null>(() => {
	if (activeProvider.value && visibleProviders.value[activeProvider.value]) {
		return activeProvider.value;
	}

	if (visibleProviders.value[defaultTab.value]) {
		return defaultTab.value;
	}

	return orderedVisibleProviders.value[0] ?? null;
});

watch(
	[resolvedActiveProvider, () => ctx.open] as const,
	([provider, open]) => {
		if (!open || provider === activeProvider.value) return;
		activeProvider.value = provider;
	},
	{ immediate: true },
);

watchEffect(() => {
	if (!containerRef.value) return;

	containerRef.value.style.setProperty("--width", props.width ?? "unset");
	containerRef.value.style.setProperty("--seventv-emote-menu-scale", props.scale ?? "3rem");

	if (searchInputRef.value) {
		searchInputRef.value.focus();
	}
});

// Shortcut (ctrl+e)
const isCtrl = useKeyModifier("Control", { initial: false });
onKeyStroke("e", (ev) => {
	if (!isCtrl.value) return;

	toggle();
	ev.preventDefault();
});

// Up/Down Arrow iterates providers
useEventListener("keydown", (ev) => {
	if (!ctx.open) return;
	if (ev.isComposing) return;
	if (!["ArrowUp", "ArrowDown"].includes(ev.key)) return;

	const visibleProviderList = orderedVisibleProviders.value;
	const cur = visibleProviderList.indexOf(resolvedActiveProvider.value ?? defaultTab.value);
	const next = ev.key === "ArrowUp" ? cur + 1 : cur - 1;
	const nextProvider = visibleProviderList[next];

	if (nextProvider) {
		activeProvider.value = nextProvider;
	}
});

// Toggle the menu's visibility
function toggle() {
	ctx.open = !ctx.open;
}

onClickOutside(containerRef, (ev) => {
	emit("close", ev);
});
</script>

<style scoped lang="scss">
.seventv-emote-menu {
	display: grid;
	grid-template-columns: 1fr;
	grid-template-rows: auto 1fr;
	grid-template-areas:
		"header"
		"body";
	outline: 0.1em solid var(--seventv-border-transparent-1);
	background-color: var(--seventv-background-transparent-1);
	border-radius: 0.25em;
	width: var(--width);
	font-size: var(--seventv-emote-menu-scale);

	@at-root .seventv-transparent & {
		backdrop-filter: blur(1em);
	}
}

.seventv-emote-menu-header {
	grid-area: header;
	display: grid;
	grid-template-rows: 1fr 0.75fr;
	border-bottom: 0.1em solid var(--seventv-border-transparent-1);
	border-radius: 0.25em 0.25em 0 0;
	background: hsla(0deg, 0%, 50%, 6%);

	&.disabled-search-input {
		grid-template-rows: 1fr 0fr;
	}

	.seventv-emote-menu-providers {
		display: flex;
		flex-direction: row;
		justify-content: space-evenly;
		column-gap: 0.5em;
		align-items: center;
		margin: 1em 0.75em;

		.seventv-emote-menu-provider-icon {
			cursor: pointer;
			display: grid;
			place-items: center;
			grid-template-columns: 1fr;
			width: 40%;
			padding: 0.5em 0.25em;
			background: hsla(0deg, 0%, 50%, 6%);
			color: var(--seventv-text-color-secondary);
			border-radius: 0.25em;

			&:hover {
				background: #80808029;
			}

			> svg {
				width: 2em;
				height: 2em;
			}

			> span {
				font-family: Roboto, monospace;
				font-weight: 600;
				font-size: 1.5em;
			}

			transition:
				width 120ms ease-in-out,
				background 150ms ease-in-out;

			&[selected="true"] {
				background: var(--seventv-highlight-neutral-1);
				color: var(--seventv-text-color-normal);
				width: 100%;
				grid-template-columns: 3em 1fr;
			}
		}
	}

	.seventv-emote-menu-search {
		height: 100%;
		position: relative;

		.search-icon {
			position: absolute;
			display: grid;
			place-items: center;
			top: 0;
			left: 0.5em;
			height: 100%;
			user-select: none;
			pointer-events: none;
			padding: 0.85em;
			color: var(--seventv-border-transparent-1);
		}

		.seventv-emote-menu-search-input {
			background-color: var(--seventv-background-shade-1);
			width: 100%;
			height: 100%;
			border: none;
			padding-left: 3em;
			color: currentcolor;
			outline: none;
			transition: background-color 140ms;

			&:focus {
				background-color: var(--seventv-background-shade-2);
			}
		}
	}
}

.seventv-emote-menu-body {
	grid-area: body;
	display: grid;
	overflow: hidden;
	height: 40vh;

	&[selected="false"] {
		display: none;
	}
}
</style>
