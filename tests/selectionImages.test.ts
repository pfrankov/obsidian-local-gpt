import { describe, expect, it } from "vitest";
import { collectEmbeddedImageWikilinks } from "../src/selectionImages";

describe("collectEmbeddedImageWikilinks", () => {
	it.each([
		["CR", "\r"],
		["LF", "\n"],
		["LS", "\u2028"],
		["PS", "\u2029"],
	])("does not match across a %s line terminator", (_name, separator) => {
		const selected = `![[first${separator}photo.webp]] then ![[valid.png]]`;
		expect(collectEmbeddedImageWikilinks(selected)).toEqual({
			fileNames: ["valid.png"],
			cleanedText: `![[first${separator}photo.webp]] then `,
		});
	});

	it.each(["png", "jpg", "JPEG", "GIF", "webp"])(
		"keeps preceding unsupported embeds and text before a %s image",
		(extension) => {
			const selected = `![[diagram.svg]] then ![[note.md]] and ![[photo.${extension}]]`;
			expect(collectEmbeddedImageWikilinks(selected)).toEqual({
				fileNames: [`photo.${extension}`],
				cleanedText: "![[diagram.svg]] then ![[note.md]] and ",
			});
		},
	);

	it("handles adjacent supported and unsupported embeds independently", () => {
		expect(
			collectEmbeddedImageWikilinks(
				"before ![[folder/first.png]]![[diagram.svg]]![[second.webp]] after",
			),
		).toEqual({
			fileNames: ["folder/first.png", "second.webp"],
			cleanedText: "before ![[diagram.svg]] after",
		});
	});

	it("does not consume an unclosed embed before a valid image", () => {
		expect(
			collectEmbeddedImageWikilinks("![[unfinished then ![[photo.webp]]"),
		).toEqual({
			fileNames: ["photo.webp"],
			cleanedText: "![[unfinished then ",
		});
	});

	it("extracts png and jpeg embeds and strips them from text", () => {
		const selected = "Describe ![[shot.png]] and ![[photo.JPEG]] please";
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
		const { fileNames, cleanedText } =
			collectEmbeddedImageWikilinks("see ![[demo.GIF]]");
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
