import type { App } from "obsidian";

export async function extractImagesFromSelection(
	app: App,
	selectedText: string,
): Promise<{ cleanedText: string; imagesInBase64: string[] }> {
	const regexp = /!\[\[(.+?\.(?:png|jpe?g))]]/gi;
	const fileNames = Array.from(
		selectedText.matchAll(regexp),
		(match) => match[1],
	);

	const cleanedText = selectedText.replace(regexp, "");
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
