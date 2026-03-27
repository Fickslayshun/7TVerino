import { useUserAgent } from "@/composable/useUserAgent";

const layout = {
	PLATFORM: [1, 2, 4],
	"7TV": [1, 2, 3, 4],
	FFZ: [1, 2, 4],
	BTTV: [1, 2, 4],
	EMOJI: [],
};

const SRCSET_CACHE_LIMIT = 256;
const known = new Map<string, string>();
const FILE_SCALE_REGEX = /(?:^|\/)(\d+)x(?:_static)?(?=\.[a-z0-9]+$)/i;
const preconnectedOrigins = new Set<string>();

export function normalizeImageHostURL(url: string): string {
	return url.startsWith("//") ? `https:${url}` : url;
}

export function ensureImageHostConnection(host: SevenTV.ImageHost | null | undefined): void {
	if (!host?.url || typeof document === "undefined" || !document.head) return;

	const normalizedURL = normalizeImageHostURL(host.url);
	let origin = "";

	try {
		origin = new URL(normalizedURL).origin;
	} catch {
		return;
	}

	if (!origin || preconnectedOrigins.has(origin)) return;
	preconnectedOrigins.add(origin);

	for (const rel of ["dns-prefetch", "preconnect"] as const) {
		const link = document.createElement("link");
		link.rel = rel;
		link.href = origin;
		if (rel === "preconnect") {
			link.crossOrigin = "anonymous";
		}
		document.head.appendChild(link);
	}
}

export function getImageFileScale(file: SevenTV.ImageFile, fallback = 0): number {
	if (typeof file.scale === "number" && Number.isFinite(file.scale) && file.scale > 0) {
		return file.scale;
	}

	for (const candidateName of [file.name, file.static_name]) {
		if (!candidateName) continue;

		const matched = candidateName.match(FILE_SCALE_REGEX);
		if (matched?.[1]) {
			return parseInt(matched[1], 10);
		}
	}

	return fallback;
}

function isStatic7TVImageFile(file: SevenTV.ImageFile): boolean {
	return file.name.includes("_static.");
}

function normalize7TVImageFiles(files: SevenTV.ImageFile[]): SevenTV.ImageFile[] {
	const groupedFiles = new Map<string, SevenTV.ImageFile>();

	for (const file of files) {
		const scale = getImageFileScale(file);
		const key = `${file.format}:${scale}:${file.width ?? 0}:${file.height ?? 0}`;
		const existingFile = groupedFiles.get(key);

		if (!existingFile) {
			groupedFiles.set(key, { ...file });
			continue;
		}

		const incomingStatic = isStatic7TVImageFile(file);
		const existingStatic = isStatic7TVImageFile(existingFile);

		if (!incomingStatic && existingStatic) {
			const nextScale = file.scale ?? existingFile.scale ?? scale;
			groupedFiles.set(key, {
				...file,
				scale: nextScale || undefined,
				static_name: file.static_name ?? existingFile.static_name ?? existingFile.name,
			});
			continue;
		}

		if (incomingStatic && !existingStatic) {
			if (existingFile.static_name) continue;

			groupedFiles.set(key, {
				...existingFile,
				static_name: file.name,
			});
			continue;
		}

		if ((file.frame_count ?? 0) <= (existingFile.frame_count ?? 0)) continue;

		const nextScale = file.scale ?? existingFile.scale ?? scale;
		groupedFiles.set(key, {
			...file,
			scale: nextScale || undefined,
			static_name:
				file.static_name ?? existingFile.static_name ?? (existingStatic ? existingFile.name : undefined),
		});
	}

	return Array.from(groupedFiles.values());
}

function getSortedImageFiles(
	host: SevenTV.ImageHost,
	provider: SevenTV.Provider,
	format?: SevenTV.ImageFormat,
): SevenTV.ImageFile[] {
	let files = host.files;

	if (provider !== "7TV") {
		return files.slice();
	}

	files = normalize7TVImageFiles(files);

	if (provider === "7TV" && format) {
		files = files.filter((f) => f.format === format);
	}

	return files.slice().sort((left, right) => {
		const leftScale = getImageFileScale(left);
		const rightScale = getImageFileScale(right);
		return (
			leftScale - rightScale ||
			(right.frame_count ?? 0) - (left.frame_count ?? 0) ||
			left.name.localeCompare(right.name)
		);
	});
}

export function resolveImageHostSrc(
	host: SevenTV.ImageHost,
	provider: SevenTV.Provider = "7TV",
	format?: SevenTV.ImageFormat,
): string {
	const { preferredFormat } = useUserAgent();
	const baseURL = normalizeImageHostURL(host.url);
	if (!baseURL) return "";

	const candidates =
		provider === "7TV"
			? Array.from(new Set<SevenTV.ImageFormat>([format ?? preferredFormat, "WEBP", "PNG", "GIF", "AVIF"]))
			: [format ?? preferredFormat];

	for (const candidate of candidates) {
		const file = getSortedImageFiles(host, provider, candidate)[0];
		if (file) {
			return `${baseURL}/${file.name}`;
		}
	}

	const file = getSortedImageFiles(host, provider)[0];
	return file ? `${baseURL}/${file.name}` : "";
}

export function resolve7TVBadgeFormat(
	host: SevenTV.ImageHost,
	preferredFormat?: SevenTV.ImageFormat,
): SevenTV.ImageFormat | undefined {
	const { preferredFormat: uaPreferredFormat } = useUserAgent();
	const resolvedPreferredFormat = preferredFormat ?? uaPreferredFormat;
	const normalizedFiles = getSortedImageFiles(host, "7TV");
	const candidates = Array.from(
		new Set<SevenTV.ImageFormat>(["WEBP", "PNG", "GIF", resolvedPreferredFormat, "AVIF"]),
	);

	return candidates.find((candidate) => normalizedFiles.some((file) => file.format === candidate));
}

export function resolve7TVEmoteFormat(
	host: SevenTV.ImageHost,
	preferredFormat?: SevenTV.ImageFormat,
): SevenTV.ImageFormat | undefined {
	const { preferredFormat: uaPreferredFormat } = useUserAgent();
	const resolvedPreferredFormat = preferredFormat ?? uaPreferredFormat;
	const normalizedFiles = getSortedImageFiles(host, "7TV");
	const candidates = Array.from(
		new Set<SevenTV.ImageFormat>(["WEBP", "GIF", "PNG", resolvedPreferredFormat, "AVIF"]),
	);

	return candidates.find((candidate) => normalizedFiles.some((file) => file.format === candidate));
}

export function imageHostToSrcset(
	host: SevenTV.ImageHost,
	provider: SevenTV.Provider = "7TV",
	format?: SevenTV.ImageFormat,
	maxSize?: number,
	targetSize = 1,
): string {
	const { preferredFormat } = useUserAgent();
	const resolvedFormat = format ?? preferredFormat;
	const cacheKey = [host.url, provider, resolvedFormat, maxSize ?? 0, targetSize].join("|");
	const cached = known.get(cacheKey);
	if (cached) {
		known.delete(cacheKey);
		known.set(cacheKey, cached);
		return cached;
	}
	const baseURL = normalizeImageHostURL(host.url);
	if (!baseURL) return "";
	const sizes = getSortedImageFiles(host, provider, provider === "7TV" ? resolvedFormat : undefined);

	let srcset = "";
	for (let i = 0; i < sizes.length; i++) {
		const size = sizes[i];

		let multiplier = getImageFileScale(size, layout[provider][i]);
		if (!multiplier) continue;

		if (maxSize && multiplier > targetSize && multiplier > maxSize) break;

		multiplier /= targetSize;

		if (srcset) srcset += ", ";
		srcset += `${baseURL}/${size.name} ${multiplier}x`;
	}

	known.set(cacheKey, srcset);
	if (known.size > SRCSET_CACHE_LIMIT) {
		const oldestKey = known.keys().next().value;
		if (oldestKey) {
			known.delete(oldestKey);
		}
	}

	return srcset;
}

export function imageHostToSrcsetWithsize(
	height: number,
	width: number,
	host: SevenTV.ImageHost,
	provider: SevenTV.Provider = "7TV",
): string {
	const { preferredFormat } = useUserAgent();
	const baseURL = normalizeImageHostURL(host.url);
	if (!baseURL) return "";
	const resolvedFormat = provider === "7TV" ? resolve7TVEmoteFormat(host, preferredFormat) : preferredFormat;

	return (
		provider == "7TV" ? getSortedImageFiles(host, provider, resolvedFormat) : getSortedImageFiles(host, provider)
	)
		.slice(0, layout[provider][layout[provider].length - 1])
		.reduce(
			(pre, cur, i) =>
				pre + `${baseURL}/${cur.name} ${width * layout[provider][i]}w ${height * layout[provider][i]}h, `,
			"",
		);
}

export function determineRatio(emote: SevenTV.ActiveEmote) {
	const { width, height } = emote.data?.host.files.at(-1) ?? {};

	if (!width || !height) return 1;

	const ratio = width / height;

	if (ratio <= 1) return 1;
	else if (ratio <= 1.5625) return 2;
	else if (ratio <= 2.125) return 3;
	return 4;
}
