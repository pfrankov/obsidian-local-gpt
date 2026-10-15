import { describe, expect, it } from "vitest";
import { collectEmbeddedImageWikilinks } from "../src/selectionImages";

describe("collectEmbeddedImageWikilinks", () => {
	it("extracts png and jpeg embeds and strips them from text", () => {
		const selected =
			"Describe ![[shot.png]] and ![[photo.JPEG]] please";
		const { fileNames, cleanedText } =
			collectEmbeddedImageWikilinks(selected);
		expect(fileNames).toEqual(["shot.png", "photo.JPEG"]);
		expect(cleanedText).toBe("Describe  and  please");
	});

	it("extracts webp embeds used in Action Palette selections (issue #109)", () => {
		const selected =
			"whats on the image ? ![[1. Grundbegriffe-1792072662635.webp]]";
		const { fileNames, cleanedText } =
			collectEmbeddedImageWikilinks(selected);
		expect(fileNames).toEqual(["1. Grundbegriffe-1792072662635.webp"]);
		expect(cleanedText).toBe("whats on the image ? ");
	});

	it("extracts gif embeds", () => {
		const { fileNames, cleanedText } = collectEmbeddedImageWikilinks(
			"see ![[demo.GIF]]",
		);
		expect(fileNames).toEqual(["demo.GIF"]);
		expect(cleanedText).toBe("see ");
	});

	it("ignores non-image wikilinks and unsupported image types", () => {
		const selected =
			"note ![[other.md]] svg ![[icon.svg]] avif ![[pic.avif]]";
		const { fileNames, cleanedText } =
			collectEmbeddedImageWikilinks(selected);
		expect(fileNames).toEqual([]);
		expect(cleanedText).toBe(selected);
	});

	it("does not treat markdown image syntax as embeds", () => {
		const selected = "![alt](folder/pic.png) and ![[ok.webp]]";
		const { fileNames, cleanedText } =
			collectEmbeddedImageWikilinks(selected);
		expect(fileNames).toEqual(["ok.webp"]);
		expect(cleanedText).toBe("![alt](folder/pic.png) and ");
	});
});
