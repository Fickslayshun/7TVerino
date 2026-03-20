<template>
	<div class="seventv-emote-menu-tab-container">
		<UiScrollable>
			<!-- Native Menu Toggle -->
			<div v-if="provider === 'PLATFORM'" class="seventv-native-menu-toggle" @click="emit('toggle-native-menu')">
				<Logo provider="PLATFORM" />
				<span v-t="'emote_menu.native'" />
			</div>

			<!-- Personal Set Promotion -->
			<template v-if="provider === '7TV' && !actor.sub">
				<EmoteMenuSet :es="promotionPersonalSet" :icon="getSetIcon(promotionPersonalSet)" :ephemeral="true">
					<div class="seventv-promotion-personal-emotes">
						<div>
							<p v-t="'emote_menu.personal_emotes_promo_1'" />
							<span>
								{{
									t("emote_menu.personal_emotes_promo_2", {
										PLATFORM: store.platform.charAt(0) + store.platform.slice(1).toLowerCase(),
									})
								}}
							</span>
						</div>

						<StoreSubscribeButton />
					</div>
				</EmoteMenuSet>
			</template>

			<template v-if="provider === 'FAVORITE' && !hasFavoriteEmotes()">
				<div class="seventv-promotion-personal-emotes">
					<div>
						<p v-t="'emote_menu.favorite_emotes_hint_1'" />
						<i18n-t keypath="emote_menu.favorite_emotes_hint_2" tag="span">
							<template #HOTKEY>
								<strong>ALT</strong>
							</template>
						</i18n-t>
					</div>
				</div>
			</template>

			<template v-for="es of sortedSets" :key="es.id">
				<EmoteMenuSet
					v-if="es.emotes.length"
					:ref="'es-' + es.id"
					:es="es"
					:icon="getSetIcon(es)"
					@emote-clicked="(ae) => emit('emote-clicked', ae)"
					@emotes-updated="(emotes) => updateVisibility(es, !!emotes.length)"
				/>
			</template>
		</UiScrollable>
		<div class="seventv-emote-menu-tab-sidebar">
			<div class="seventv-emote-menu-sidebar-icons">
				<template v-for="es in sortedSets" :key="es.id">
					<div
						v-if="es.emotes.length"
						class="seventv-emote-menu-set-sidebar-icon-container"
						:selected="selectedSet == es.id"
						@click="select(es.id, $refs['es-' + es.id] as InstanceType<typeof EmoteMenuSet>[])"
					>
						<div class="seventv-emote-menu-set-sidebar-icon">
							<div
								v-if="es.provider === 'EMOJI' && emojiCategories.indexOf(es.name) > -1"
								class="seventv-emote-menu-emoji-group"
							>
								<SingleEmoji :id="emojiGroupIcons[emojiCategories.indexOf(es.name)]" :alt="es.name" />
							</div>
							<img
								v-else-if="getSetIcon(es).kind === 'image'"
								:key="`${es.id}:${getSetIcon(es).src}`"
								:src="getSetIcon(es).src"
								:alt="es.name"
							/>
							<Logo
								v-else
								class="logo"
								:class="{ 'seventv-emote-menu-set-sidebar-icon-logo-accent': getSetIcon(es).tone === 'accent' }"
								:provider="getSetIcon(es).provider"
							/>
						</div>
					</div>
				</template>
			</div>
			<div class="seventv-emote-menu-settings-button-container">
				<div class="seventv-emote-menu-settings-button" @click="emit('toggle-settings')">
					<GearsIcon :provider="'7TV'" />
					<div v-if="!updater.isUpToDate" class="seventv-emote-menu-settings-button-update-flair" />
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "@/store/main";
import { debounceFn } from "@/common/Async";
import { type ChannelContext, resolveChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useActor } from "@/composable/useActor";
import { getModuleRef } from "@/composable/useModule";
import { useCosmetics } from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import useUpdater from "@/composable/useUpdater";
import SingleEmoji from "@/assets/svg/emoji/SingleEmoji.vue";
import GearsIcon from "@/assets/svg/icons/GearsIcon.vue";
import Logo from "@/assets/svg/logos/Logo.vue";
import type { EmoteMenuTabName } from "./EmoteMenu.vue";
import { useEmoteMenuContext } from "./EmoteMenuContext";
import { type EmoteSetIconDescriptor, getImageHostSource } from "./setIcon";
import EmoteMenuSet from "./EmoteMenuSet.vue";
import UiScrollable from "@/ui/UiScrollable.vue";
import StoreSubscribeButton from "../store/StoreSubscribeButton.vue";

const props = defineProps<{
	provider: EmoteMenuTabName;
	selected?: boolean;
	channelId?: string;
	channelCtx?: ChannelContext;
}>();

const emit = defineEmits<{
	(event: "emote-clicked", emote: SevenTV.ActiveEmote): void;
	(event: "provider-visible", state: boolean): void;
	(event: "toggle-settings"): void;
	(event: "toggle-native-menu"): void;
}>();

const { t } = useI18n();
const ctx = useEmoteMenuContext();
const channelContext = props.channelCtx ?? resolveChannelContext(props.channelId ?? ctx.channelID);
const emotes = useChatEmotes(channelContext);
const updater = useUpdater();
const selectedSet = ref("");

// The source emote sets from this emote provider
const sets = emotes.byProvider(props.provider as SevenTV.Provider) ?? reactive({});
const store = useStore();
const cosmetics = useCosmetics(store.identity?.id ?? "");
const actor = useActor();
const avatarModule = getModuleRef("avatars");
const visibleSets = reactive<Set<string>>(new Set());
const sortedSets = ref([] as SevenTV.EmoteSet[]);
const favorites = useConfig<Set<string>>("ui.emote_menu.favorites");
// const usage = useConfig<Map<string, number>>("ui.emote_menu.usage");
// const shouldShowUsage = useConfig<boolean>("ui.emote_menu.most_used");
const personalSets = computed(() =>
	Array.from(cosmetics.emoteSets?.values() ?? []).filter((set) => set.provider === props.provider),
);
const providerSetSignature = computed(() =>
	Object.values(sets)
		.map((set) => `${set.id}:${set.name}:${set.emotes.length}`)
		.sort()
		.join("|"),
);
const personalSetSignature = computed(() =>
	personalSets.value
		.map((set) => `${set.id}:${set.name}:${set.emotes.length}`)
		.sort()
		.join("|"),
);

// Emote icons for groups
const emojiGroupIcons = ["1f603", "1f44b", "1f343", "1f354", "26bd", "1f698", "1f4a1", "1f523", "1f6a9"];
const emojiCategories = [
	"Smileys & Emotion",
	"People & Body",
	"Animals & Nature",
	"Food & Drink",
	"Activities",
	"Travel & Places",
	"Objects",
	"Symbols",
	"Flags",
];

const promotionPersonalSet: SevenTV.EmoteSet = {
	id: "personal-ad",
	name: "Personal Emotes",
	provider: "7TV",
	emotes: [],
};

function updateFavorites() {
	if (!favorites.value) return [];

	return Array.from(favorites.value.values())
		.map((eid) => emotes.find((ae) => ae.id === eid))
		.filter((ae) => !!ae) as SevenTV.ActiveEmote[];
}

if (props.provider === "FAVORITE") {
	// create favorite set
	const favSet = (sets["FAVORITE"] = reactive({
		id: "FAVORITE",
		name: t("emote_menu.favorite_set"),
		emotes: updateFavorites(),
	} as SevenTV.EmoteSet));

	watch(favorites, () => {
		favSet.emotes = updateFavorites();
	});
}

function hasFavoriteEmotes() {
	return props.provider === "FAVORITE" && sets["FAVORITE"].emotes.length > 0;
}

// Select an Emote Set to jump-scroll to
function select(setID: string, coms: InstanceType<typeof EmoteMenuSet>[] | null | undefined) {
	if (!coms || !coms.length) return;
	const com = coms[0];
	if (!com.containerEl) return;

	selectedSet.value = setID;
	com.containerEl.scrollIntoView({ behavior: "auto" });
}

function sortCase(es: SevenTV.EmoteSet) {
	if (es.scope === "GLOBAL") return 1;

	if (channelContext.id && es.owner && es.owner.id === channelContext.id) return -1;
	if ((es.flags ?? 0) & 4) return -2;
	return 0;
}

function sortFn(a: SevenTV.EmoteSet, b: SevenTV.EmoteSet) {
	const c1 = sortCase(a);
	const c2 = sortCase(b);

	if (
		a.provider === "EMOJI" &&
		b.provider === "EMOJI" &&
		emojiCategories.indexOf(a.name) > -1 &&
		emojiCategories.indexOf(b.name) > -1
	)
		return emojiCategories.indexOf(a.name) - emojiCategories.indexOf(b.name);

	return c1 == c2 ? a.name.localeCompare(b.name) : c1 > c2 ? 1 : -1;
}

function getAnimatedAvatarSource(username?: string): string {
	const login = username?.trim().toLowerCase();
	if (!login) return "";

	const avatars = avatarModule.value?.instance?.avatars as Record<string, SevenTV.Cosmetic<"AVATAR">> | undefined;
	if (!avatars) return "";

	return getImageHostSource(avatars[login]?.data?.host);
}

function getActorAvatarSource(): string {
	return getAnimatedAvatarSource(store.identity?.username) || actor.user?.avatar_url || "";
}

function getChannelAvatarSource(es: SevenTV.EmoteSet): string {
	return (
		getAnimatedAvatarSource(channelContext.username) ||
		channelContext.user?.avatar_url ||
		es.owner?.avatar_url ||
		""
	);
}

function getSetIcon(es: SevenTV.EmoteSet): EmoteSetIconDescriptor {
	if (es.provider === "7TV") {
		const isPersonalSet = es.id === "personal-ad" || es.scope === "PERSONAL" || ((es.flags ?? 0) & 4) !== 0;
		if (isPersonalSet) {
			const source = getActorAvatarSource();
			if (source) return { kind: "image", src: source };
		}

		const isCurrentChannelSet =
			es.id !== "global" &&
			es.scope === "CHANNEL" &&
			Object.prototype.hasOwnProperty.call(sets, es.id);
		if (isCurrentChannelSet) {
			const source = getChannelAvatarSource(es);
			if (source) return { kind: "image", src: source };
		}

		if (es.scope === "GLOBAL" || es.id === "global") {
			return { kind: "logo", provider: "7TV", tone: "default" };
		}

		return { kind: "logo", provider: "7TV", tone: "accent" };
	}

	if (es.owner?.avatar_url) {
		return { kind: "image", src: es.owner.avatar_url };
	}

	return {
		kind: "logo",
		provider: es.provider ?? "7TV",
		tone: "default",
	};
}

function updateVisibility(es: SevenTV.EmoteSet, state: boolean): void {
	if (state) {
		visibleSets.add(es.id);
	} else {
		visibleSets.delete(es.id);
	}

	emit("provider-visible", !!visibleSets.size);
}

const filterSets = debounceFn(() => {
	const ary = Object.values(sets) as SevenTV.EmoteSet[];
	if (personalSets.value.length) {
		ary.push(...personalSets.value);
	}

	if (props.provider === "PLATFORM") {
		const res = ary.reduce(
			(accu, cur) => {
				const p = accu[cur.name];
				if (p) {
					p.emotes.push(...cur.emotes);
				} else {
					accu[cur.name] = { set: cur, emotes: [...cur.emotes] };
				}
				return accu;
			},
			{} as Record<string, { set: SevenTV.EmoteSet; emotes: SevenTV.ActiveEmote[] }>,
		);

		ary.splice(0, ary.length, ...Object.values(res).map((e) => ({ ...e.set, emotes: e.emotes })));
	}

	// Sort emote sets
	ary.sort(sortFn);
	sortedSets.value = ary;
}, 50);
// Watch for changes to the emote sets and perform sorting operations
watch(() => [ctx.filter, providerSetSignature.value, personalSetSignature.value], filterSets, {
	immediate: true,
});
</script>
<style scoped lang="scss">
@import "@/assets/style/flair";

.seventv-emote-menu-tab-container {
	display: grid;
	grid-template-columns: 1fr auto;
	grid-template-rows: 1fr;
	overflow: hidden;
}

.seventv-native-menu-toggle {
	display: inline-block;
	text-align: center;
	grid-template-columns: 3em 1fr;
	width: 100%;
	padding: 0.25em 1em;
	cursor: pointer;
	transition: background 0.2s ease-in-out;

	svg,
	span {
		display: inline-block;
		vertical-align: middle;
		font-size: 1.25em;
		margin: 0.5em;
	}

	&:hover {
		background: hsla(0deg, 0%, 50%, 6%);
	}
}

.seventv-emote-menu-tab-sidebar {
	overflow: hidden;
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	background: hsla(0deg, 0%, 50%, 6%);
	border-left: 1px solid var(--seventv-border-transparent-1);

	.seventv-emote-menu-sidebar-icons {
		overflow-y: scroll;
		scrollbar-width: none;

		&::-webkit-scrollbar {
			width: 0;
			height: 0;
		}
	}

	.seventv-emote-menu-settings-button-container {
		justify-content: center;
		width: 100%;
		margin-top: auto;
		float: bottom;
		height: 4em;
		flex-shrink: 0;
		padding: auto;
		border-top: 1px solid var(--seventv-border-transparent-1);

		.seventv-emote-menu-settings-button {
			display: flex;
			margin: 0.5em;
			padding: 0.5em;
			border-radius: 0.25em;
			justify-content: center;
			cursor: pointer;

			&:hover {
				background: hsla(0deg, 0%, 50%, 32%);
			}

			> svg {
				height: 2em;
				width: 2em;
			}

			> .seventv-emote-menu-settings-button-update-flair {
				position: absolute;
				height: 1em;
				width: 1em;
				transform: translateY(-0.25em);
				right: 0.65em;

				@include flair-pulsating(#3eed58);
			}
		}
	}
}

.seventv-emote-menu-set-sidebar-icon-container {
	width: 100%;
	padding: 0.5em 0;

	&[selected="true"] {
		background: hsla(0deg, 0%, 50%, 32%);
	}
}

.seventv-emote-menu-set-sidebar-icon {
	width: 2.8em;
	height: 2.8em;
	border-radius: 0.5em;
	overflow: clip;
	margin: auto;
	cursor: pointer;
}

.seventv-emote-menu-set-sidebar-icon img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.logo {
	width: 100%;
	height: 100%;
}

.seventv-emote-menu-set-sidebar-icon-logo-accent {
	color: var(--seventv-primary);
}

.seventv-emote-menu-emoji-group {
	width: 100%;
	height: 100%;
}

.seventv-promotion-personal-emotes {
	display: grid;
	row-gap: 0.25rem;
	justify-items: center;
	text-align: center;
	margin: 0.5em 1em;

	p {
		font-size: 1.088em;
		font-weight: bold;
	}

	span {
		font-size: 0.9em;
	}

	button {
		font-size: 1.5em;
	}
}
</style>
