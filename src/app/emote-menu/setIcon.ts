export interface EmoteSetIconDescriptor {
	kind: "image" | "logo";
	src?: string;
	provider?: SevenTV.Provider;
	tone?: "default" | "accent";
}

export function getImageHostSource(host: SevenTV.ImageHost | undefined): string {
	if (!host?.url) return "";

	const file = host.files.find((entry) => (entry.width ?? 0) >= 64) ?? host.files[1] ?? host.files[0];
	if (!file?.name) return "";

	const baseUrl = host.url.startsWith("//") ? `https:${host.url}` : host.url;
	return `${baseUrl}/${file.name}`;
}
