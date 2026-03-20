/**
 * Inserts the emoji vectors into the DOM.
 */
let emojiVectorLoad: Promise<void> | null = null;

export function insertEmojiVectors(): Promise<void> {
	if (document.getElementById("seventv-emoji-container")) return Promise.resolve();
	if (emojiVectorLoad) return emojiVectorLoad;

	emojiVectorLoad = (async () => {
		const container = document.createElement("div");
		container.id = "seventv-emoji-container";
		container.style.display = "none";
		container.style.position = "fixed";
		container.style.top = "-1px";
		container.style.left = "-1px";

		// Get path to emoji blocks in assets
		const base = chrome.runtime.getURL("assets/emoji");
		const blocks = 11;
		const svgBlocks = await Promise.all(
			Array.from({ length: blocks }, async (_, i) => ({
				id: "emojis" + i,
				markup: await (await fetch(base + "/emojis" + i + ".svg")).text(),
			})),
		);

		for (const svg of svgBlocks) {
			const element = document.createElement("div");
			element.id = svg.id;
			element.innerHTML = svg.markup;

			container.appendChild(element);
		}

		(document.head || document.documentElement).appendChild(container);
	})().finally(() => {
		if (!document.getElementById("seventv-emoji-container")) {
			emojiVectorLoad = null;
		}
	});

	return emojiVectorLoad;
}
