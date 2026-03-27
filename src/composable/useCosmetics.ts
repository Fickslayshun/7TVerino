import { ComputedRef, computed, reactive, ref, toRaw, toRef, watch } from "vue";
import { until, useTimeout } from "@vueuse/core";
import { DecimalToStringRGBA } from "@/common/Color";
import { log } from "@/common/Logger";
import { db } from "@/db/idb";
import { useConfig } from "@/composable/useSettings";
import { useLiveQuery } from "./useLiveQuery";
import { useWorker } from "./useWorker";

const data = reactive({
	cosmetics: {} as Record<SevenTV.ObjectID, SevenTV.Cosmetic>,
	sets: {} as Record<SevenTV.ObjectID, SevenTV.EmoteSet>,
	activeSets: new Set<SevenTV.ObjectID>(),

	entitlementBuffers: {
		"+": [] as SevenTV.Entitlement[],
		"-": [] as SevenTV.Entitlement[],
	},

	userBadges: {} as Record<string, CosmeticMap<"BADGE">>,
	userPaints: {} as Record<string, CosmeticMap<"PAINT">>,
	userEmoteSets: {} as Record<string, Map<string, SevenTV.EmoteSet>>,
	userEmoteMap: {} as Record<string, ComputedRef<Record<string, SevenTV.ActiveEmote>>>,
	userBadgeList: {} as Record<string, ComputedRef<SevenTV.Cosmetic<"BADGE">[]>>,
	userPrimaryPaint: {} as Record<string, ComputedRef<SevenTV.Cosmetic<"PAINT"> | null>>,

	staticallyAssigned: {} as Record<string, Record<string, never> | undefined>,
});
const dropShadowRender = useConfig<0 | 1 | 2>("vanity.paints_drop_shadows");

watch(dropShadowRender, () =>
	Object.values(data.cosmetics)
		.filter((c) => c.kind === "PAINT")
		.forEach((c) => updatePaintStyle(c as SevenTV.Cosmetic<"PAINT">)),
);

class CosmeticMap<T extends SevenTV.CosmeticKind> extends Map<string, SevenTV.Cosmetic<T>> {
	private providers = new Set<SevenTV.Provider>();

	hasProvider(provider: SevenTV.Provider) {
		return this.providers.has(provider);
	}

	set(key: string, value: SevenTV.Cosmetic<T>): this {
		if (value.provider) this.providers.add(value.provider);
		return super.set(key, value);
	}

	delete(key: string): boolean {
		const value = this.get(key);
		if (!value) return false;

		this.providers.delete(value.provider);
		return super.delete(key);
	}

	clear(): void {
		this.providers.clear();
		super.clear();
	}
}

let flushTimeout: number | null = null;
const firstFlush = ref(false);

function getOrCreateUserCosmeticMap<T extends "BADGE" | "PAINT">(kind: T, userID: string): CosmeticMap<T> {
	const source = kind === "BADGE" ? data.userBadges : data.userPaints;
	if (!source[userID]) {
		(source[userID] as CosmeticMap<T>) = new CosmeticMap();
	}

	return source[userID] as CosmeticMap<T>;
}

function registerLocalCosmetic<T extends "BADGE" | "PAINT">(cosmetic: SevenTV.Cosmetic<T>): SevenTV.Cosmetic<T> {
	const existing = data.cosmetics[cosmetic.id] as SevenTV.Cosmetic<T> | undefined;
	if (existing) return existing;

	const next = reactive(cloneLocalCosmetic(cosmetic)) as SevenTV.Cosmetic<T>;
	data.cosmetics[next.id] = next;

	if (next.kind === "PAINT") {
		updatePaintStyle(next as SevenTV.Cosmetic<"PAINT">);
	}

	return next;
}

function cloneLocalCosmetic<T extends "BADGE" | "PAINT">(cosmetic: SevenTV.Cosmetic<T>): SevenTV.Cosmetic<T> {
	const raw = toRaw(cosmetic) as SevenTV.Cosmetic<T>;

	if (raw.kind === "PAINT") {
		return cloneLocalPaintCosmetic(raw as SevenTV.Cosmetic<"PAINT">) as SevenTV.Cosmetic<T>;
	}

	return cloneLocalBadgeCosmetic(raw as SevenTV.Cosmetic<"BADGE">) as SevenTV.Cosmetic<T>;
}

function cloneLocalBadgeCosmetic(cosmetic: SevenTV.Cosmetic<"BADGE">): SevenTV.Cosmetic<"BADGE"> {
	return {
		id: cosmetic.id,
		kind: cosmetic.kind,
		provider: cosmetic.provider,
		user_ids: cosmetic.user_ids ? [...cosmetic.user_ids] : undefined,
		data: {
			name: cosmetic.data.name,
			tooltip: cosmetic.data.tooltip,
			backgroundColor: cosmetic.data.backgroundColor,
			replace: cosmetic.data.replace,
			host: cloneImageHost(cosmetic.data.host),
		},
	};
}

function cloneLocalPaintCosmetic(cosmetic: SevenTV.Cosmetic<"PAINT">): SevenTV.Cosmetic<"PAINT"> {
	return {
		id: cosmetic.id,
		kind: cosmetic.kind,
		provider: cosmetic.provider,
		user_ids: cosmetic.user_ids ? [...cosmetic.user_ids] : undefined,
		data: {
			name: cosmetic.data.name,
			color: cosmetic.data.color,
			gradients: (cosmetic.data.gradients ?? []).map(clonePaintGradient),
			layers: cosmetic.data.layers?.map(clonePaintLayer),
			shadows: cosmetic.data.shadows?.map(clonePaintShadow),
			flairs: cosmetic.data.flairs?.map(clonePaintFlair),
			text: cosmetic.data.text ? clonePaintText(cosmetic.data.text) : undefined,
			function: cosmetic.data.function,
			stops: cosmetic.data.stops?.map(clonePaintGradientStop),
			repeat: cosmetic.data.repeat,
			angle: cosmetic.data.angle,
			shape: cosmetic.data.shape,
			image_url: cosmetic.data.image_url,
		},
	};
}

function cloneImageHost(host: SevenTV.ImageHost): SevenTV.ImageHost {
	return {
		url: host.url,
		srcset: host.srcset,
		files: (host.files ?? []).map((file) => ({
			name: file.name,
			static_name: file.static_name,
			scale: file.scale,
			width: file.width,
			height: file.height,
			frame_count: file.frame_count,
			size: file.size,
			format: file.format,
		})),
	};
}

function clonePaintGradient(gradient: SevenTV.CosmeticPaintGradient): SevenTV.CosmeticPaintGradient {
	return {
		function: gradient.function,
		canvas_repeat: gradient.canvas_repeat,
		size: gradient.size ? [gradient.size[0], gradient.size[1]] : null,
		at: gradient.at ? [gradient.at[0], gradient.at[1]] : undefined,
		stops: (gradient.stops ?? []).map(clonePaintGradientStop),
		image_url: gradient.image_url,
		shape: gradient.shape,
		angle: gradient.angle,
		repeat: gradient.repeat,
	};
}

function clonePaintGradientStop(stop: SevenTV.CosmeticPaintGradientStop): SevenTV.CosmeticPaintGradientStop {
	return {
		at: stop.at,
		color: stop.color,
	};
}

function clonePaintShadow(shadow: SevenTV.CosmeticPaintShadow): SevenTV.CosmeticPaintShadow {
	return {
		x_offset: shadow.x_offset,
		y_offset: shadow.y_offset,
		radius: shadow.radius,
		color: shadow.color,
	};
}

function clonePaintText(text: SevenTV.CosmeticPaintText): SevenTV.CosmeticPaintText {
	return {
		weight: text.weight,
		shadows: text.shadows?.map(clonePaintShadow),
		transform: text.transform,
		stroke: text.stroke
			? {
					color: text.stroke.color,
					width: text.stroke.width,
			  }
			: undefined,
	};
}

function clonePaintFlair(flair: SevenTV.CosmeticPaintFlair): SevenTV.CosmeticPaintFlair {
	return {
		kind: flair.kind,
		x_offset: flair.x_offset,
		y_offset: flair.y_offset,
		width: flair.width,
		height: flair.height,
		data: flair.data,
	};
}

function clonePaintLayer(layer: SevenTV.CosmeticPaintLayer): SevenTV.CosmeticPaintLayer {
	return {
		id: layer.id,
		opacity: layer.opacity,
		ty: clonePaintLayerType(layer.ty),
	};
}

function clonePaintLayerType(ty: SevenTV.CosmeticPaintLayerType): SevenTV.CosmeticPaintLayerType {
	switch (ty.__typename) {
		case "PaintLayerTypeSingleColor":
			return {
				__typename: ty.__typename,
				color: cloneCosmeticColor(ty.color),
			};
		case "PaintLayerTypeLinearGradient":
			return {
				__typename: ty.__typename,
				angle: ty.angle,
				repeating: ty.repeating,
				stops: ty.stops.map(clonePaintLayerStop),
			};
		case "PaintLayerTypeRadialGradient":
			return {
				__typename: ty.__typename,
				repeating: ty.repeating,
				shape: ty.shape,
				stops: ty.stops.map(clonePaintLayerStop),
			};
		case "PaintLayerTypeImage":
			return {
				__typename: ty.__typename,
				images: ty.images.map(cloneCosmeticAssetImage),
			};
	}
}

function clonePaintLayerStop(stop: SevenTV.CosmeticPaintLayerStop): SevenTV.CosmeticPaintLayerStop {
	return {
		at: stop.at,
		color: cloneCosmeticColor(stop.color),
	};
}

function cloneCosmeticColor(color: SevenTV.CosmeticColor): SevenTV.CosmeticColor {
	return {
		r: color.r,
		g: color.g,
		b: color.b,
		a: color.a,
		hex: color.hex,
	};
}

function cloneCosmeticAssetImage(image: SevenTV.CosmeticAssetImage): SevenTV.CosmeticAssetImage {
	return {
		url: image.url,
		mime: image.mime,
		size: image.size,
		scale: image.scale,
		width: image.width,
		height: image.height,
		frameCount: image.frameCount,
	};
}

function replaceProviderSelection<T extends "BADGE" | "PAINT">(
	map: CosmeticMap<T>,
	provider: SevenTV.Provider,
	nextCosmetic: SevenTV.Cosmetic<T> | null,
): void {
	for (const [id, cosmetic] of Array.from(map.entries())) {
		if (cosmetic.provider !== provider) continue;
		if (nextCosmetic && id === nextCosmetic.id) continue;

		map.delete(id);
	}

	if (nextCosmetic && !map.has(nextCosmetic.id)) {
		map.set(nextCosmetic.id, nextCosmetic);
	}
}

export function syncSelected7TVCosmeticsForUser(
	userID: string,
	selection: {
		paint: SevenTV.Cosmetic<"PAINT"> | null;
		badge: SevenTV.Cosmetic<"BADGE"> | null;
	},
): void {
	if (!userID) return;

	replaceProviderSelection(
		getOrCreateUserCosmeticMap("PAINT", userID),
		"7TV",
		selection.paint ? registerLocalCosmetic(selection.paint) : null,
	);
	replaceProviderSelection(
		getOrCreateUserCosmeticMap("BADGE", userID),
		"7TV",
		selection.badge ? registerLocalCosmetic(selection.badge) : null,
	);
}

export function getSelected7TVCosmeticsForUser(userID: string): {
	paintID: string;
	badgeID: string;
} {
	const paint = Array.from(data.userPaints[userID]?.values() ?? []).find((cosmetic) => cosmetic.provider === "7TV");
	const badge = Array.from(data.userBadges[userID]?.values() ?? []).find((cosmetic) => cosmetic.provider === "7TV");

	return {
		paintID: paint?.id ?? "",
		badgeID: badge?.id ?? "",
	};
}

/**
 * Set up cosmetics
 */
db.ready().then(async () => {
	const { target } = useWorker();

	useLiveQuery(
		() => db.cosmetics.toArray(),
		(result) => {
			const temp = {} as typeof data.cosmetics;

			for (const cos of result) {
				if (temp[cos.id]) continue;
				temp[cos.id] = reactive(cos);

				if (cos.kind === "PAINT") {
					updatePaintStyle(cos as SevenTV.Cosmetic<"PAINT">);
				}
			}

			data.cosmetics = temp;
		},
	);

	// Assign legacy V2 static cosmetics
	target.addEventListener(
		"static_cosmetics_fetched",
		(e) => {
			const { badges, paints } = e.detail;

			// Assign legacy static badges
			for (let badge of badges ?? []) {
				if (!data.cosmetics[badge.id]) data.cosmetics[badge.id] = reactive(badge);
				else badge = data.cosmetics[badge.id] as SevenTV.Cosmetic<"BADGE">;

				for (const u of badge.user_ids ?? []) {
					if (!u || (data.userBadges[u] && data.userBadges[u].has(badge.id))) continue;

					setEntitlement(
						{
							id: "",
							kind: "BADGE",
							ref_id: badge.id,
							user_id: u,
							platform_id: u,
						},
						"+",
					);
					data.staticallyAssigned[u] = {};
				}

				if (badge.user_ids) {
					badge.user_ids.length = 0;
				}
			}

			// Assign legacy static paints
			for (let paint of paints ?? []) {
				if (!data.cosmetics[paint.id]) data.cosmetics[paint.id] = reactive(paint);
				else paint = data.cosmetics[paint.id] as SevenTV.Cosmetic<"PAINT">;

				for (const u of paint.user_ids ?? []) {
					if (!u || data.userPaints[u]) continue;

					setEntitlement(
						{
							id: "",
							kind: "PAINT",
							ref_id: paint.id,
							user_id: u,
							platform_id: u,
						},
						"+",
					);
					data.staticallyAssigned[u] = {};
				}

				if (paint.user_ids) {
					paint.user_ids.length = 0;
				}

				updatePaintStyle(paint);
			}
		},
		{ once: true },
	);

	/**
	 * Bind or unbind an entitlement to a user
	 *
	 * @param ent The entitlement to bind or unbind
	 * @param mode "+" to bind, "-" to unbind
	 */
	function setEntitlement(ent: SevenTV.Entitlement, mode: "+" | "-") {
		if (data.staticallyAssigned[ent.platform_id]) {
			// If user had statically assigned cosmetics,
			// clear them so they be properly set with live data
			for (const cos of data.userBadges[ent.platform_id]?.values() ?? []) {
				if (cos.provider !== "7TV") continue;

				data.userBadges[ent.platform_id].delete(cos.id);
			}
			for (const cos of data.userPaints[ent.platform_id]?.values() ?? []) {
				data.userPaints[ent.platform_id].delete(cos.id);
			}

			delete data.staticallyAssigned[ent.platform_id];
		}

		data.entitlementBuffers[mode].push(ent);

		flush();
	}

	// Flush schedules the entitlement buffer
	//
	// This operation processes a time gap between grants and revokations
	// in order to allow the UI to update smoothly
	function flush() {
		firstFlush.value = true;
		if (flushTimeout) return;

		flushTimeout = window.setTimeout(() => {
			const add = new Map(
				data.entitlementBuffers["+"].splice(0, data.entitlementBuffers["+"].length).map((e) => [e.id, e]),
			);
			const del = new Map(
				data.entitlementBuffers["-"].splice(0, data.entitlementBuffers["-"].length).map((e) => [e.id, e]),
			);

			for (const [id, ent] of del.entries()) {
				// if we are removing entitlement and adding it back we can skip it entirely
				if (add.has(id)) {
					add.delete(id);
					continue;
				}
				const l = userListFor(ent.kind);
				if (!l[ent.platform_id] || !l[ent.platform_id].has(ent.ref_id)) continue;

				l[ent.platform_id].delete(ent.ref_id);
			}

			flushTimeout = window.setTimeout(async () => {
				for (const ent of add.values()) {
					const l = userListFor(ent.kind);

					if (ent.kind === "EMOTE_SET") {
						if (!l[ent.platform_id]) l[ent.platform_id] = new Map();

						bindUserEmotes(ent.platform_id, ent.ref_id);
					} else {
						if (!l[ent.platform_id])
							(l[ent.platform_id] as CosmeticMap<"BADGE" | "PAINT">) = new CosmeticMap();

						const m = l[ent.platform_id] as CosmeticMap<"BADGE" | "PAINT">;
						awaitCosmetic(ent.ref_id).then((cos) => {
							if (m.has(ent.ref_id) || m.hasProvider(cos.provider)) return;
							m.set(ent.ref_id, cos as never);
						});
					}
				}
			}, 10);

			flushTimeout = null;
		}, 10);
	}

	// Wait for a given cosmetic's data to become available
	function awaitCosmetic(id: SevenTV.ObjectID) {
		const cos = data.cosmetics[id];
		if (cos) return Promise.resolve(cos);

		return until(() => data.cosmetics[id]).not.toBeUndefined();
	}

	// Get the list of cosmetics for a given entitlement kind
	function userListFor(kind: SevenTV.EntitlementKind) {
		return {
			BADGE: data.userBadges,
			PAINT: data.userPaints,
			EMOTE_SET: data.userEmoteSets,
		}[kind];
	}

	// Watch a user's personal emote set for creation or changes
	function watchSet(userID: string, setID: SevenTV.ObjectID) {
		return new Promise<SevenTV.EmoteSet | null>((resolve) => {
			useLiveQuery(
				() => db.emoteSets.where("id").equals(setID).first(),
				(res) => {
					data.sets[setID] = res;

					// Update the set's data
					data.userEmoteSets[userID]?.set(setID, res);
					resolve(res);
				},
				{
					until: until(useTimeout(10000))
						.toBeTruthy()
						.then(() => resolve(null))
						.then(() => true),
					count: 1,
				},
			);
		});
	}

	// Bind a user's personal emote set
	async function bindUserEmotes(userID: string, setID: string) {
		const set = await watchSet(userID, setID);

		if (!set) {
			log.warn("<Cosmetics>", "Emote Set could not be found", `id=${setID}`);
			return;
		}

		if (!data.userEmoteSets[userID]) {
			data.userEmoteSets[userID] = new Map();
		}
		if (!data.userEmoteSets[userID].has(setID)) {
			data.userEmoteSets[userID].set(setID, set);
		}

		log.debug("<Cosmetics>", "Assigned Emote Set to user", `id=${setID}`, `userID=${userID}`);
	}

	// Handle user entitlements
	target.addEventListener("entitlement_created", (ev) => {
		setEntitlement(ev.detail, "+");
	});
	target.addEventListener("entitlement_deleted", (ev) => {
		setEntitlement(ev.detail, "-");
	});

	// Assign stored entitlements
	db.entitlements
		.toArray()
		.then((ents) => {
			for (const ent of ents) {
				let assigned = false;

				const id = ent.platform_id ?? ent.user_id;

				const isLegacy = !!data.staticallyAssigned[id];
				switch (ent.kind) {
					case "BADGE":
						if (!isLegacy && data.userBadges[id]?.size) continue;

						setEntitlement(ent, "+");
						assigned = true;
						break;
					case "PAINT":
						if (!isLegacy && data.userPaints[id]?.size) continue;

						setEntitlement(ent, "+");
						assigned = true;
						break;
					case "EMOTE_SET":
						bindUserEmotes(id, ent.ref_id);
						break;
				}

				log.debug("<Cosmetics>", "Assigned", ents.length.toString(), "stored entitlements");

				if (assigned) {
					data.staticallyAssigned[ent.user_id] = {};
				}
			}
		})
		.then(flush);
});

export function useCosmetics(userID: string) {
	if (!data.userBadges[userID]) data.userBadges[userID] = new CosmeticMap();
	if (!data.userPaints[userID]) data.userPaints[userID] = new CosmeticMap();
	if (!data.userEmoteSets[userID]) data.userEmoteSets[userID] = new Map();
	if (!data.userBadgeList[userID])
		data.userBadgeList[userID] = computed(() => {
			const badges = data.userBadges[userID];
			return badges?.size ? Array.from(badges.values()) : [];
		});
	if (!data.userPrimaryPaint[userID])
		data.userPrimaryPaint[userID] = computed(() => {
			const paints = data.userPaints[userID];
			return paints?.size ? paints.values().next().value ?? null : null;
		});
	if (!data.userEmoteMap[userID])
		data.userEmoteMap[userID] = computed(() => {
			const un = {} as Record<string, SevenTV.ActiveEmote>;
			for (const set of data.userEmoteSets[userID].values()) {
				for (const emote of set.emotes) {
					if (!emote.data?.state?.includes("PERSONAL")) continue;
					un[emote.name] = emote;
				}
			}
			return un;
		});

	return reactive({
		paints: toRef(data.userPaints, userID),
		badges: toRef(data.userBadges, userID),
		emotes: toRef(data.userEmoteMap, userID),
		emoteSets: toRef(data.userEmoteSets, userID),
		badgeList: toRef(data.userBadgeList, userID),
		paint: toRef(data.userPrimaryPaint, userID),
	});
}

export function getCosmetics() {
	return data;
}

let paintSheet: CSSStyleSheet | null = null;
const paintRuleIndexes = new Map<string, number>();

function getPaintStylesheet(): CSSStyleSheet | null {
	if (paintSheet) return paintSheet;

	const link = document.createElement("link");
	link.type = "text/css";
	link.rel = "stylesheet";

	const s = document.createElement("style");
	s.id = "seventv-paint-styles";

	document.head.appendChild(s);

	return (paintSheet = s.sheet ?? null);
}

function findPaintRuleIndex(sheet: CSSStyleSheet, selector: string): number {
	const cachedIndex = paintRuleIndexes.get(selector);
	if (cachedIndex !== undefined) {
		const cachedRule = sheet.cssRules[cachedIndex];
		if (cachedRule instanceof CSSStyleRule && cachedRule.selectorText === selector) {
			return cachedIndex;
		}

		paintRuleIndexes.delete(selector);
	}

	for (let i = 0; i < sheet.cssRules.length; i++) {
		const rule = sheet.cssRules[i];
		if (!(rule instanceof CSSStyleRule)) continue;
		if (rule.selectorText !== selector) continue;

		paintRuleIndexes.set(selector, i);
		return i;
	}

	return -1;
}

function shiftPaintRuleIndexes(removedIndex: number): void {
	for (const [selector, index] of paintRuleIndexes) {
		if (index > removedIndex) {
			paintRuleIndexes.set(selector, index - 1);
		}
	}
}

// This defines CSS variables in our global paint stylesheet for the given paint
export function updatePaintStyle(paint: SevenTV.Cosmetic<"PAINT">, remove = false): void {
	const sheet = getPaintStylesheet();
	if (!sheet) {
		log.error("<Cosmetics>", "Could not find paint stylesheet");
		return;
	}

	if (!paint.data.gradients?.length && paint.data.function) {
		// add base gradient if using v2 format
		if (!paint.data.gradients) paint.data.gradients = new Array(1);
		paint.data.gradients[0] = {
			function: paint.data.function,
			canvas_repeat: "",
			size: [1, 1],
			shape: paint.data.shape,
			image_url: paint.data.image_url,
			stops: paint.data.stops ?? [],
			repeat: paint.data.repeat ?? false,
			angle: paint.data.angle,
		};
	}

	const gradients = paint.data.gradients.map((g) => createGradientFromPaint(g));
	const filter = (() => {
		if (!paint.data.shadows || dropShadowRender.value == 0) {
			return "";
		}

		return paint.data.shadows
			.slice(0, dropShadowRender.value == 2 ? 1 : undefined)
			.map((v) => createFilterDropshadow(v))
			.join(" ");
	})();

	const selector = `.seventv-paint[data-seventv-paint-id="${paint.id}"]`;
	const text = `${selector} {
color: ${paint.data.color ? DecimalToStringRGBA(paint.data.color) : "inherit"};
background-image: ${gradients.map((v) => v[0]).join(", ")};
background-position: ${gradients.map((v) => v[1]).join(", ")};
background-size: ${gradients.map((v) => v[2]).join(", ")};
background-repeat: ${gradients.map((v) => v[3]).join(", ")};
filter: ${filter || "inherit"};
${
	paint.data.text
		? `
font-weight: ${paint.data.text.weight ? paint.data.text.weight * 100 : "inherit"};
-webkit-text-stroke-width: ${paint.data.text.stroke ? `${paint.data.text.stroke.width}px` : "inherit"};
-webkit-text-stroke-color: ${paint.data.text.stroke ? DecimalToStringRGBA(paint.data.text.stroke.color) : "inherit"};
text-shadow: ${
				paint.data.text.shadows
					?.map((v) => `${v.x_offset}px ${v.y_offset}px ${v.radius}px ${DecimalToStringRGBA(v.color)}`)
					.join(", ") ?? "unset"
		  };
text-transform: ${paint.data.text.transform ?? "unset"};
`
		: ""
}
}
`;

	const currentIndex = findPaintRuleIndex(sheet, selector);
	if (remove) {
		if (currentIndex >= 0) {
			sheet.deleteRule(currentIndex);
			paintRuleIndexes.delete(selector);
			shiftPaintRuleIndexes(currentIndex);
		}

		return;
	}

	if (currentIndex >= 0) {
		sheet.deleteRule(currentIndex);
		sheet.insertRule(text, currentIndex);
		paintRuleIndexes.set(selector, currentIndex);
	} else {
		const nextIndex = sheet.cssRules.length;
		sheet.insertRule(text, nextIndex);
		paintRuleIndexes.set(selector, nextIndex);
	}
}

export function createGradientFromPaint(
	gradient: SevenTV.CosmeticPaintGradient,
): [style: string, pos: string, size: string, repeat: string] {
	const result = ["", "", "", ""] as [string, string, string, string];
	const normalizedPosition =
		gradient.at && gradient.at.length === 2 ? `${gradient.at[0] * 100}% ${gradient.at[1] * 100}%` : "";
	const args = [] as string[];
	switch (gradient.function) {
		case "LINEAR_GRADIENT": // paint is linear gradient
			args.push(`${gradient.angle ?? 0}deg`);
			break;
		case "RADIAL_GRADIENT": // paint is radial gradient
			args.push(`${gradient.shape ?? "circle"}${normalizedPosition ? ` at ${normalizedPosition}` : ""}`);
			break;
		case "CONIC_GRADIENT": {
			// paint is conic gradient
			const conicArgs = [] as string[];
			if (typeof gradient.angle === "number") {
				conicArgs.push(`from ${gradient.angle}deg`);
			}
			if (normalizedPosition) {
				conicArgs.push(`at ${normalizedPosition}`);
			}
			if (conicArgs.length) {
				args.push(conicArgs.join(" "));
			}
			break;
		}
		case "URL": // paint is an image
			args.push(JSON.stringify(gradient.image_url ?? ""));
			break;
	}
	let funcPrefix = "";
	if (gradient.function !== "URL") {
		funcPrefix = gradient.repeat ? "repeating-" : "";

		for (const stop of gradient.stops) {
			const color = DecimalToStringRGBA(stop.color);
			args.push(`${color} ${stop.at * 100}%`);
		}
	}

	result[0] = `${funcPrefix}${gradient.function.toLowerCase().replace("_", "-")}(${args.join(", ")})`;
	result[1] =
		gradient.function === "RADIAL_GRADIENT" || gradient.function === "CONIC_GRADIENT"
			? "0% 0%"
			: normalizedPosition || "0% 0%";
	result[2] =
		gradient.size && gradient.size.length === 2
			? `${gradient.size[0] * 100}% ${gradient.size[1] * 100}%`
			: "auto auto";
	result[3] = gradient.canvas_repeat || "no-repeat";

	return result;
}

export function createFilterDropshadow(shadow: SevenTV.CosmeticPaintShadow): string {
	return `drop-shadow(${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px ${DecimalToStringRGBA(
		shadow.color,
	)})`;
}
