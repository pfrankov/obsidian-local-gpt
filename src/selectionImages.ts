import type { App } from "obsidian";

/** Obsidian wikilink embeds the vision path can load (not SVG/AVIF). */
const EMBEDDED_IMAGE_WIKILINK =
	/!\[\[(.+?\.(?:png|jpe?g|gif|webp))]]/gi;

/**
 * Collect wikilink image embeds from selected text and strip them from the
 * prompt text. Supports png, jpeg/jpg, gif, and webp (issue #109).
 */
export function collectEmbeddedImageWikilinks(selectedText: string): {
	fileNames: string[];
	cleanedText: string;
} {
	const fileNames = Array.from(
		selectedText.matchAll(EMBEDDED_IMAGE_WIKILINK),
		(match) => match[1],
	);
	const cleanedText = selectedText.replace(EMBEDDED_IMAGE_WIKILINK, "");
	return { fileNames, cleanedText };
}

export async function extractImagesFromSelection(
	app: App,
	selectedText: string,
): Promise<{ cleanedText: string; imagesInBase64: string[] }> {
	const { fileNames, cleanedText } =
		collectEmbeddedImageWikilinks(selectedText);

	const imagesInBase64 =
		(
			await Promise.all<string>(
				fileNames.map((fileName) => readImageAsDataUrl(app, fileName)),
			)
		).filter(Boolean) || [];

	return { cleanedText, imagesInBase64 };
}

async function readImageAsDataUrl(app: App, fileName: string): Promise<string> {
	const activePath = app.workspace.getActiveFile()?.path ?? "";
	const filePath = app.metadataCache.getFirstLinkpathDest(
		fileName,
		activePath,
	);

	if (!filePath) {
		return "";
	}

	return app.vault.adapter.readBinary(filePath.path).then((buffer) => {
		const extension = filePath.extension.toLowerCase();
		const mimeType = extension === "jpg" ? "jpeg" : extension;
		const blob = new Blob([buffer], {
			type: `image/${mimeType}`,
		});
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.readAsDataURL(blob);
		});
	});
}
