import { reactive } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { ensureImageHostConnection, resolveImageHostSrc } from "@/common/Image";
import { log } from "@/common/Logger";
import { db } from "@/db/idb";
import {
	getSelected7TVCosmeticsForUser,
	syncSelected7TVCosmeticsForUser,
	updatePaintStyle,
} from "@/composable/useCosmetics";
import { useConfig } from "@/composable/useSettings";
import { useWorker } from "@/composable/useWorker";
import {
	actorCosmeticInventoryQuery,
	actorCosmeticInventoryV4QueryText,
	cosmeticsByIDQuery,
	updateSelectedCosmeticMutation,
} from "@/assets/gql/seventv.user.gql";
import type { actorCosmeticInventoryV4Query } from "@/assets/gql/seventv.user.gql";
import { apolloClient } from "@/apollo/apollo";

export interface TVerinoChannelCosmeticApplyResult {
	ok: boolean;
	changed: boolean;
	error: string;
	selection: SevenTV.TVerinoChannelCosmeticSelection;
}

type ChannelCosmeticTarget = Pick<CurrentChannel, "id" | "username" | "displayName">;
type CosmeticKind = Extract<SevenTV.CosmeticKind, "PAINT" | "BADGE">;
type InventoryCosmetic = SevenTV.Cosmetic<"PAINT"> | SevenTV.Cosmetic<"BADGE">;

const defaultPaintID = useConfig<string>("chat.tverino.channel_cosmetics_default_paint_id", "");
const defaultBadgeID = useConfig<string>("chat.tverino.channel_cosmetics_default_badge_id", "");
const channelOverrides = useConfig<Map<string, SevenTV.TVerinoChannelCosmeticOverride>>(
	"chat.tverino.channel_cosmetics_overrides",
	new Map(),
);
const token = useConfig<string>("app.7tv.token", "");
const { identity } = storeToRefs(useStore());
const { sendMessage: sendWorkerMessage } = useWorker();
type InventoryPaint = NonNullable<cosmeticsByIDQuery.Result["inventory"]>["paints"][number];
type InventoryBadge = NonNullable<cosmeticsByIDQuery.Result["inventory"]>["badges"][number];
type V4InventoryPaint = actorCosmeticInventoryV4Query.Paint;
type V4InventoryBadge = actorCosmeticInventoryV4Query.Badge;
type V4GraphQLResponse = {
	data?: actorCosmeticInventoryV4Query.Result;
	errors?: Array<{
		message?: string;
	}>;
};
const sevenTVV4GraphQLEndpoint = import.meta.env.VITE_APP_API_GQL.replace(/\/v3\/gql$/, "/v4/gql");
export const CHANNEL_COSMETICS_DEFAULT_VALUE = "__TVERINO_DEFAULT__";

const state = reactive({
	actorID: "",
	inventoryLoading: false,
	inventoryError: "",
	paints: [] as SevenTV.Cosmetic<"PAINT">[],
	badges: [] as SevenTV.Cosmetic<"BADGE">[],
	activePaintID: "",
	activeBadgeID: "",
});

let loadedInventoryToken = "";
let inventoryPromise: Promise<boolean> | null = null;
let inventoryPromiseToken = "";
let applyChain = Promise.resolve();
let inFlightApplyPromise: Promise<TVerinoChannelCosmeticApplyResult> | null = null;
let inFlightApplyKey = "";
const preloadedPaintAssetURLs = new Set<string>();
const preloadedBadgeAssetURLs = new Set<string>();

export function useTVerinoChannelCosmetics() {
	return {
		state,
		refreshInventory,
		primeChannelCosmetics,
		shouldEnsureChannelCosmetics,
		ensureChannelCosmeticsApplied,
		resolveChannelCosmeticSelection,
	};
}

export function resolveChannelCosmeticSelection(channelID: string): SevenTV.TVerinoChannelCosmeticSelection {
	const override = channelOverrides.value.get(channelID);
	if (override) {
		return {
			paintID: resolveConfiguredCosmeticID(override.paintID, defaultPaintID.value),
			badgeID: resolveConfiguredCosmeticID(override.badgeID, defaultBadgeID.value),
		};
	}

	return {
		paintID: sanitizeCosmeticID(defaultPaintID.value),
		badgeID: sanitizeCosmeticID(defaultBadgeID.value),
	};
}

export function shouldEnsureChannelCosmetics(channelID: string): boolean {
	const normalizedToken = token.value.trim();
	if (!normalizedToken) return false;
	if (loadedInventoryToken !== normalizedToken || !state.actorID) return true;

	const desired = resolveChannelCosmeticSelection(channelID);
	if (state.activePaintID !== desired.paintID || state.activeBadgeID !== desired.badgeID) {
		return true;
	}

	return !isCurrentViewerCosmeticsSynced(desired);
}

export function primeChannelCosmetics(target: ChannelCosmeticTarget): Promise<TVerinoChannelCosmeticApplyResult> {
	if (!shouldEnsureChannelCosmetics(target.id)) {
		return Promise.resolve({
			ok: true,
			changed: false,
			error: "",
			selection: resolveChannelCosmeticSelection(target.id),
		});
	}

	return ensureChannelCosmeticsApplied(target).catch((error) => ({
		ok: false,
		changed: false,
		error: toErrorMessage(error, "Unable to apply 7TV cosmetics."),
		selection: resolveChannelCosmeticSelection(target.id),
	}));
}

export async function ensureChannelCosmeticsApplied(
	target: ChannelCosmeticTarget,
): Promise<TVerinoChannelCosmeticApplyResult> {
	const selection = resolveChannelCosmeticSelection(target.id);
	const normalizedToken = token.value.trim();
	if (!normalizedToken) {
		return {
			ok: false,
			changed: false,
			error: "Log in to 7TV to use channel-specific cosmetics.",
			selection,
		};
	}

	const applyKey = buildApplyKey(target.id, selection);
	if (inFlightApplyPromise && inFlightApplyKey === applyKey) {
		return inFlightApplyPromise;
	}

	const previousApply = applyChain.catch(() => void 0);
	const request = previousApply
		.then(async () => {
			const inventoryReady = await refreshInventory();
			if (!inventoryReady || !state.actorID) {
				return {
					ok: false,
					changed: false,
					error: state.inventoryError || "Unable to load 7TV cosmetics.",
					selection,
				};
			}

			if (state.activePaintID === selection.paintID && state.activeBadgeID === selection.badgeID) {
				syncCurrentViewerCosmetics(selection);
				return {
					ok: true,
					changed: false,
					error: "",
					selection,
				};
			}

			let changed = false;

			try {
				changed = (await syncCosmeticKind("PAINT", selection.paintID)) || changed;
				changed = (await syncCosmeticKind("BADGE", selection.badgeID)) || changed;
				syncCurrentViewerCosmetics(selection);
				if (changed) {
					sendChannelCosmeticPresence(target);
				}

				return {
					ok: true,
					changed,
					error: "",
					selection,
				};
			} catch (error) {
				const message = toErrorMessage(error, "Unable to apply 7TV cosmetics.");
				log.warn("<TVerinoChannelCosmetics>", "failed to apply cosmetics", message);

				return {
					ok: false,
					changed,
					error: message,
					selection,
				};
			}
		})
		.finally(() => {
			if (inFlightApplyPromise === request) {
				inFlightApplyPromise = null;
				inFlightApplyKey = "";
			}
		});

	inFlightApplyPromise = request;
	inFlightApplyKey = applyKey;
	applyChain = request.then(
		() => void 0,
		() => void 0,
	);
	return request;
}

export async function refreshInventory(force = false): Promise<boolean> {
	const normalizedToken = token.value.trim();
	if (!normalizedToken) {
		clearInventoryState();
		state.inventoryError = "Log in to 7TV to manage channel-specific cosmetics.";
		return false;
	}

	if (!force && loadedInventoryToken === normalizedToken) {
		return true;
	}

	if (!force && inventoryPromise && inventoryPromiseToken === normalizedToken) {
		return inventoryPromise;
	}

	inventoryPromiseToken = normalizedToken;
	state.inventoryLoading = true;
	state.inventoryError = "";

	const request = apolloClient
		.query<actorCosmeticInventoryQuery.Result>({
			query: actorCosmeticInventoryQuery,
			fetchPolicy: force ? "network-only" : "cache-first",
		})
		.then(async (actorResp) => {
			const actor = actorResp.data?.user;
			if (!actor?.id) {
				throw new Error("7TV actor unavailable.");
			}

			const ownedCosmeticIDs = actor.cosmetics
				.filter((cosmetic) => cosmetic.kind === "PAINT" || cosmetic.kind === "BADGE")
				.map((cosmetic) => cosmetic.id)
				.filter(Boolean);
			const [v4CosmeticsByID, databaseCosmeticsByID] = await Promise.all([
				loadOwnedCosmeticsFromV4(normalizedToken),
				loadOwnedCosmeticsFromDatabase(actor.username, ownedCosmeticIDs),
			]);
			const missingCosmeticIDs = ownedCosmeticIDs.filter(
				(cosmeticID) => !v4CosmeticsByID.has(cosmeticID) && !databaseCosmeticsByID.has(cosmeticID),
			);
			const fallbackCosmeticsByID = missingCosmeticIDs.length
				? await loadOwnedCosmeticsFromLegacyInventory(missingCosmeticIDs, force)
				: new Map<string, InventoryCosmetic>();

			const mergedInventory = ownedCosmeticIDs
				.map(
					(cosmeticID) =>
						v4CosmeticsByID.get(cosmeticID) ??
						databaseCosmeticsByID.get(cosmeticID) ??
						fallbackCosmeticsByID.get(cosmeticID) ??
						null,
				)
				.filter((cosmetic): cosmetic is InventoryCosmetic => !!cosmetic);
			const nextPaints = mergedInventory.filter(isPaintCosmetic).sort(compareCosmeticsByName);
			const nextBadges = mergedInventory.filter(isBadgeCosmetic).sort(compareCosmeticsByName);
			const selectedPaintID =
				actor.cosmetics.find((cosmetic) => cosmetic.kind === "PAINT" && cosmetic.selected)?.id ?? "";
			const selectedBadgeID =
				actor.cosmetics.find((cosmetic) => cosmetic.kind === "BADGE" && cosmetic.selected)?.id ?? "";

			for (const paint of nextPaints) {
				if (!shouldRegisterPaintStyles(paint)) continue;
				updatePaintStyle(paint);
			}
			preloadPaintAssets(nextPaints);
			preloadBadgeAssets(nextBadges);

			state.actorID = actor.id;
			state.paints = nextPaints;
			state.badges = nextBadges;
			state.activePaintID = sanitizeCosmeticID(actor.style?.paint_id) || sanitizeCosmeticID(selectedPaintID);
			state.activeBadgeID = sanitizeCosmeticID(actor.style?.badge_id) || sanitizeCosmeticID(selectedBadgeID);
			state.inventoryError = "";
			loadedInventoryToken = normalizedToken;
			return true;
		})
		.catch((error) => {
			clearInventoryState();
			state.inventoryError = toErrorMessage(error, "Unable to load 7TV cosmetics.");
			return false;
		})
		.finally(() => {
			state.inventoryLoading = false;
			if (inventoryPromise === request) {
				inventoryPromise = null;
			}
		});

	inventoryPromise = request;
	return request;
}

async function syncCosmeticKind(kind: CosmeticKind, desiredID: string): Promise<boolean> {
	const currentID = kind === "PAINT" ? state.activePaintID : state.activeBadgeID;
	if (currentID === desiredID) return false;

	if (desiredID) {
		await mutateSelectedCosmetic({
			id: desiredID,
			kind,
			selected: true,
		});
	} else if (currentID) {
		await mutateSelectedCosmetic({
			id: currentID,
			kind,
			selected: false,
		});
	}

	if (kind === "PAINT") {
		state.activePaintID = desiredID;
	} else {
		state.activeBadgeID = desiredID;
	}

	return true;
}

async function mutateSelectedCosmetic(update: updateSelectedCosmeticMutation.Variables["update"]): Promise<void> {
	if (!state.actorID) {
		throw new Error("7TV actor unavailable.");
	}

	const response = await apolloClient.mutate<
		updateSelectedCosmeticMutation.Result,
		updateSelectedCosmeticMutation.Variables
	>({
		mutation: updateSelectedCosmeticMutation,
		variables: {
			id: state.actorID,
			update,
		},
	});

	if (!response.data?.user?.cosmetics) {
		throw new Error("7TV did not confirm the cosmetic update.");
	}
}

function clearInventoryState(): void {
	state.actorID = "";
	state.paints = [];
	state.badges = [];
	state.activePaintID = "";
	state.activeBadgeID = "";
	loadedInventoryToken = "";
}

function buildApplyKey(channelID: string, selection: SevenTV.TVerinoChannelCosmeticSelection): string {
	return `${channelID}:${selection.paintID || "-"}:${selection.badgeID || "-"}`;
}

function syncCurrentViewerCosmetics(selection: SevenTV.TVerinoChannelCosmeticSelection): void {
	const viewerID = identity.value?.id?.trim();
	if (!viewerID) return;

	syncSelected7TVCosmeticsForUser(viewerID, {
		paint: findSelectedCosmetic(state.paints, selection.paintID),
		badge: findSelectedCosmetic(state.badges, selection.badgeID),
	});
}

function isCurrentViewerCosmeticsSynced(selection: SevenTV.TVerinoChannelCosmeticSelection): boolean {
	const viewerID = identity.value?.id?.trim();
	if (!viewerID) return true;

	const localSelection = getSelected7TVCosmeticsForUser(viewerID);
	return localSelection.paintID === selection.paintID && localSelection.badgeID === selection.badgeID;
}

function sendChannelCosmeticPresence(target: ChannelCosmeticTarget): void {
	if (!target.id) return;

	sendWorkerMessage("CHANNEL_ACTIVE_CHATTER", {
		channel: {
			id: target.id,
			username: target.username,
			displayName: target.displayName,
			active: true,
		},
		includeSelf: true,
		force: true,
	});
}

function sanitizeCosmeticID(value: string | null | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

function findSelectedCosmetic<T extends InventoryCosmetic>(inventory: T[], cosmeticID: string): T | null {
	if (!cosmeticID) return null;
	return inventory.find((cosmetic) => cosmetic.id === cosmeticID) ?? null;
}

function resolveConfiguredCosmeticID(value: string | null | undefined, fallback: string | null | undefined): string {
	const normalized = sanitizeCosmeticID(value);
	if (normalized === CHANNEL_COSMETICS_DEFAULT_VALUE) {
		return sanitizeCosmeticID(fallback);
	}

	return normalized;
}

function compareCosmeticsByName<T extends SevenTV.Cosmetic<"BADGE"> | SevenTV.Cosmetic<"PAINT">>(
	left: T,
	right: T,
): number {
	return left.data.name.localeCompare(right.data.name) || left.id.localeCompare(right.id);
}

function shouldRegisterPaintStyles(paint: SevenTV.Cosmetic<"PAINT">): boolean {
	if (paint.data.layers?.length) return false;

	return (
		paint.data.color !== null ||
		!!paint.data.gradients?.length ||
		!!paint.data.function ||
		!!paint.data.text ||
		!!paint.data.shadows?.length
	);
}

function toPaintCosmetic(paint: InventoryPaint) {
	return {
		id: paint.id,
		kind: "PAINT",
		provider: "7TV",
		data: {
			name: paint.name,
			color: paint.color,
			gradients: paint.gradients ?? [],
			shadows: paint.shadows ?? undefined,
			text: paint.text ?? undefined,
		},
	} satisfies SevenTV.Cosmetic<"PAINT">;
}

function toPaintCosmeticFromV4(paint: V4InventoryPaint) {
	return {
		id: paint.id,
		kind: "PAINT",
		provider: "7TV",
		data: {
			name: paint.name,
			color: null,
			gradients: [],
			layers: paint.data.layers ?? [],
			shadows: (paint.data.shadows ?? []).map((shadow) => ({
				x_offset: shadow.offsetX,
				y_offset: shadow.offsetY,
				radius: shadow.blur,
				color: parseColorHexToDecimal(shadow.color.hex),
			})),
		},
	} satisfies SevenTV.Cosmetic<"PAINT">;
}

async function loadOwnedCosmeticsFromDatabase(
	actorUsername: string,
	ownedCosmeticIDs: string[],
): Promise<Map<string, InventoryCosmetic>> {
	if (!actorUsername || !ownedCosmeticIDs.length) {
		return new Map();
	}

	sendWorkerMessage("REQUEST_USER_COSMETICS", {
		identifiers: [["username", actorUsername]],
		kinds: ["PAINT", "BADGE"],
	});

	await db.ready();

	const start = Date.now();
	const deadline = Date.now() + 1600;
	let lastSeen = new Map<string, InventoryCosmetic>();
	let lastSeenSize = -1;
	let stablePolls = 0;

	while (Date.now() <= deadline) {
		lastSeen = await readOwnedCosmeticsFromDatabase(ownedCosmeticIDs);
		if (lastSeen.size >= ownedCosmeticIDs.length) {
			return lastSeen;
		}
		if (lastSeen.size === lastSeenSize) {
			stablePolls += 1;
		} else {
			lastSeenSize = lastSeen.size;
			stablePolls = 0;
		}
		if (lastSeen.size === 0 && Date.now() >= start + 400) {
			return lastSeen;
		}
		if (lastSeen.size > 0 && stablePolls >= 3) {
			return lastSeen;
		}

		await wait(80);
	}

	return lastSeen;
}

async function readOwnedCosmeticsFromDatabase(ownedCosmeticIDs: string[]): Promise<Map<string, InventoryCosmetic>> {
	const cosmetics = await db.cosmetics
		.where("id")
		.anyOf(ownedCosmeticIDs)
		.toArray()
		.catch(() => [] as SevenTV.Cosmetic[]);
	const resolved = new Map<string, InventoryCosmetic>();

	for (const cosmetic of cosmetics) {
		if (!isInventoryCosmetic(cosmetic)) continue;
		resolved.set(cosmetic.id, cosmetic);
	}

	return resolved;
}

async function loadOwnedCosmeticsFromV4(tokenValue: string): Promise<Map<string, InventoryCosmetic>> {
	if (!tokenValue) return new Map();

	try {
		const response = await fetch(sevenTVV4GraphQLEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${tokenValue}`,
			},
			body: JSON.stringify({
				query: actorCosmeticInventoryV4QueryText,
			}),
		});
		if (!response.ok) {
			throw new Error(`7TV v4 inventory request failed (${response.status})`);
		}

		const payload = (await response.json()) as V4GraphQLResponse;
		if (payload.errors?.length) {
			throw new Error(payload.errors[0]?.message || "7TV v4 inventory query failed.");
		}

		const inventory = payload.data?.users?.me?.inventory;
		if (!inventory) return new Map();

		const resolved = new Map<string, InventoryCosmetic>();
		for (const entry of inventory.paints ?? []) {
			const paint = entry.to?.paint;
			if (!paint?.id) continue;
			resolved.set(paint.id, toPaintCosmeticFromV4(paint));
		}
		for (const entry of inventory.badges ?? []) {
			const badge = entry.to?.badge;
			if (!badge?.id) continue;
			resolved.set(badge.id, toBadgeCosmeticFromV4(badge));
		}

		return resolved;
	} catch (error) {
		log.warn("<TVerinoChannelCosmetics>", "failed to load v4 inventory", toErrorMessage(error, "unknown"));
		return new Map();
	}
}

async function loadOwnedCosmeticsFromLegacyInventory(
	ownedCosmeticIDs: string[],
	force: boolean,
): Promise<Map<string, InventoryCosmetic>> {
	if (!ownedCosmeticIDs.length) {
		return new Map();
	}

	const response = await apolloClient.query<cosmeticsByIDQuery.Result, cosmeticsByIDQuery.Variables>({
		query: cosmeticsByIDQuery,
		variables: {
			list: ownedCosmeticIDs,
		},
		fetchPolicy: force ? "network-only" : "cache-first",
	});
	const resolved = new Map<string, InventoryCosmetic>();

	for (const paint of response.data?.inventory?.paints ?? []) {
		resolved.set(paint.id, toPaintCosmetic(paint));
	}
	for (const badge of response.data?.inventory?.badges ?? []) {
		resolved.set(badge.id, toBadgeCosmetic(badge));
	}

	return resolved;
}

function preloadPaintAssets(paints: SevenTV.Cosmetic<"PAINT">[]): void {
	for (const paint of paints) {
		for (const layer of paint.data.layers ?? []) {
			if (layer.ty.__typename !== "PaintLayerTypeImage") continue;

			for (const imageAsset of layer.ty.images) {
				const imageURL = normalizePaintAssetURL(imageAsset.url);
				if (!imageURL || preloadedPaintAssetURLs.has(imageURL)) continue;

				preloadedPaintAssetURLs.add(imageURL);

				const image = new Image();
				image.decoding = "async";
				image.referrerPolicy = "no-referrer";
				image.src = imageURL;
			}
		}

		for (const gradient of paint.data.gradients ?? []) {
			const imageURL = normalizePaintAssetURL(gradient.image_url);
			if (!imageURL || preloadedPaintAssetURLs.has(imageURL)) continue;

			preloadedPaintAssetURLs.add(imageURL);

			const image = new Image();
			image.decoding = "async";
			image.referrerPolicy = "no-referrer";
			image.src = imageURL;
		}
	}
}

function preloadBadgeAssets(badges: SevenTV.Cosmetic<"BADGE">[]): void {
	for (const badge of badges) {
		ensureImageHostConnection(badge.data.host);

		const imageURL = resolveImageHostSrc(badge.data.host, "7TV");
		if (!imageURL || preloadedBadgeAssetURLs.has(imageURL)) continue;

		preloadedBadgeAssetURLs.add(imageURL);

		const image = new Image();
		image.decoding = "async";
		image.referrerPolicy = "no-referrer";
		image.src = imageURL;
	}
}

function normalizePaintAssetURL(value: string | null | undefined): string {
	if (!value) return "";
	if (value.startsWith("//")) return `https:${value}`;
	return value;
}

function toBadgeCosmetic(badge: InventoryBadge) {
	return {
		id: badge.id,
		kind: "BADGE",
		provider: "7TV",
		data: {
			name: badge.name,
			tooltip: badge.tooltip ?? badge.name,
			host: badge.host,
		},
	} satisfies SevenTV.Cosmetic<"BADGE">;
}

function toBadgeCosmeticFromV4(badge: V4InventoryBadge) {
	return {
		id: badge.id,
		kind: "BADGE",
		provider: "7TV",
		data: {
			name: badge.name,
			tooltip: badge.name,
			host: imageAssetsToHost(badge.images ?? []),
		},
	} satisfies SevenTV.Cosmetic<"BADGE">;
}

function imageAssetsToHost(images: SevenTV.CosmeticAssetImage[]): SevenTV.ImageHost {
	if (!images.length) {
		return {
			url: "",
			files: [],
		};
	}

	const firstURL = images[0].url;
	const lastSlashIndex = firstURL.lastIndexOf("/");
	const baseURL = lastSlashIndex > 0 ? firstURL.slice(0, lastSlashIndex) : firstURL;
	const filesByFormatAndScale = new Map<
		string,
		{
			format: SevenTV.ImageFormat;
			scale: number;
			animated?: SevenTV.CosmeticAssetImage;
			static?: SevenTV.CosmeticAssetImage;
		}
	>();

	for (const imageAsset of images) {
		const format = mimeToImageFormat(imageAsset.mime);
		const scale = imageAsset.scale > 0 ? imageAsset.scale : 1;
		const key = `${format}:${scale}`;
		const entry = filesByFormatAndScale.get(key) ?? {
			format,
			scale,
		};

		if ((imageAsset.frameCount ?? 1) > 1) {
			entry.animated = imageAsset;
		} else {
			entry.static = imageAsset;
		}

		filesByFormatAndScale.set(key, entry);
	}

	return {
		url: baseURL,
		files: buildImageHostFiles(filesByFormatAndScale),
	};
}

function extractImageAssetName(url: string): string {
	return url.slice(url.lastIndexOf("/") + 1);
}

function buildImageHostFiles(
	filesByFormatAndScale: Map<
		string,
		{
			format: SevenTV.ImageFormat;
			scale: number;
			animated?: SevenTV.CosmeticAssetImage;
			static?: SevenTV.CosmeticAssetImage;
		}
	>,
): SevenTV.ImageFile[] {
	const files: SevenTV.ImageFile[] = [];

	for (const entry of Array.from(filesByFormatAndScale.values()).sort(
		(left, right) => left.scale - right.scale || left.format.localeCompare(right.format),
	)) {
		const primaryAsset = entry.animated ?? entry.static;
		if (!primaryAsset) continue;

		const staticAsset =
			entry.animated && entry.static && entry.static.url !== primaryAsset.url ? entry.static : undefined;

		files.push({
			name: extractImageAssetName(primaryAsset.url),
			static_name: staticAsset ? extractImageAssetName(staticAsset.url) : undefined,
			scale: entry.scale,
			format: entry.format,
			width: primaryAsset.width,
			height: primaryAsset.height,
			size: primaryAsset.size,
			frame_count: primaryAsset.frameCount,
		});
	}

	return files;
}

function mimeToImageFormat(mime: string): SevenTV.ImageFormat {
	switch (mime) {
		case "image/avif":
			return "AVIF";
		case "image/gif":
			return "GIF";
		case "image/png":
			return "PNG";
		case "image/webp":
		default:
			return "WEBP";
	}
}

function parseColorHexToDecimal(value: string): number {
	const normalized = value.trim();
	const matched = normalized.match(/^#(?<rgb>[0-9a-f]{6})(?<alpha>[0-9a-f]{2})?$/i);
	if (!matched?.groups?.rgb) return 0;

	const rgbValue = parseInt(matched.groups.rgb, 16);
	const red = (rgbValue >> 16) & 0xff;
	const green = (rgbValue >> 8) & 0xff;
	const blue = rgbValue & 0xff;
	const alpha = matched.groups.alpha ? parseInt(matched.groups.alpha, 16) : 0xff;

	return ((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0;
}

function isInventoryCosmetic(cosmetic: SevenTV.Cosmetic): cosmetic is InventoryCosmetic {
	return cosmetic.kind === "PAINT" || cosmetic.kind === "BADGE";
}

function isPaintCosmetic(cosmetic: InventoryCosmetic): cosmetic is SevenTV.Cosmetic<"PAINT"> {
	return cosmetic.kind === "PAINT";
}

function isBadgeCosmetic(cosmetic: InventoryCosmetic): cosmetic is SevenTV.Cosmetic<"BADGE"> {
	return cosmetic.kind === "BADGE";
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}
