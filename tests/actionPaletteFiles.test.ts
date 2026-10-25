import { tick } from "svelte";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";
import { describe, expect, it, vi } from "vitest";
import type { Vault, TFile, EventRef } from "obsidian";
import { createPaletteFileSource } from "../src/ui/actionPaletteFiles";
import { filterAvailableFiles } from "../src/ui/actionPaletteOptions";
import { findMatchingFile } from "../src/ui/actionPaletteText";

function fakeVault() {
	const callbacks = new Map<string, () => void>();
	let files = [
		{ path: "first/Coffee.md", basename: "Coffee", extension: "md" },
		{ path: "second/Coffee.md", basename: "Coffee", extension: "md" },
		{ path: "Paper.pdf", basename: "Paper", extension: "pdf" },
		{ path: "Image.png", basename: "Image", extension: "png" },
	];
	const getFiles = vi.fn(() => files as TFile[]);
	const getMarkdownFiles = vi.fn(
		() => files.filter((f) => f.extension === "md") as TFile[],
	);
	const offref = vi.fn((ref: EventRef) =>
		callbacks.delete((ref as unknown as { event: string }).event),
	);
	const vault = {
		getFiles,
		getMarkdownFiles,
		offref,
		on: (event: string, callback: () => void) => {
			callbacks.set(event, callback);
			return { event };
		},
	} as unknown as Vault;
	return {
		vault,
		getFiles,
		getMarkdownFiles,
		offref,
		callbacks,
		replace: (next: typeof files) => {
			files = next;
		},
	};
}

describe("palette file snapshot", () => {
	it("is lazy, reuses one list, preserves order and selected duplicate preference", () => {
		const f = fakeVault();
		const source = createPaletteFileSource(f.vault);
		expect(f.getFiles).not.toHaveBeenCalled();
		const files = source.getFiles();
		expect(source.getFiles()).toBe(files);
		expect(f.getFiles).toHaveBeenCalledTimes(1);
		expect(files.map((f) => f.path)).toEqual([
			"first/Coffee.md",
			"second/Coffee.md",
			"Paper.pdf",
		]);
		expect(findMatchingFile("coffee.md", files, [])?.path).toBe(
			"first/Coffee.md",
		);
		expect(
			findMatchingFile("coffee.md", files, ["second/Coffee.md"])?.path,
		).toBe("second/Coffee.md");
		expect(
			findMatchingFile("Coffee.md", files, [
				"second/Coffee.md",
				"first/Coffee.md",
			])?.path,
		).toBe("first/Coffee.md");
		source.dispose();
		expect(f.callbacks.size).toBe(0);
	});
	it.each(["create", "delete", "rename"])(
		"refreshes lazily after %s, including folder changes",
		(event) => {
			const f = fakeVault();
			const source = createPaletteFileSource(f.vault);
			source.getFiles();
			f.replace([
				{ path: "renamed/New.pdf", basename: "New", extension: "pdf" },
			]);
			f.callbacks.get(event)!();
			expect(f.getFiles).toHaveBeenCalledTimes(1);
			expect(source.getFiles().map((f) => f.path)).toEqual([
				"renamed/New.pdf",
			]);
			expect(f.getFiles).toHaveBeenCalledTimes(2);
			source.dispose();
			expect(f.offref).toHaveBeenCalledTimes(3);
		},
	);
	it("refreshes extension eligibility after a rename", () => {
		const f = fakeVault();
		const source = createPaletteFileSource(f.vault);
		source.getFiles();
		f.replace([
			{ path: "Coffee.png", basename: "Coffee", extension: "png" },
		]);
		f.callbacks.get("rename")!();
		expect(source.getFiles()).toEqual([]);
		f.replace([
			{ path: "Coffee.pdf", basename: "Coffee", extension: "pdf" },
		]);
		f.callbacks.get("rename")!();
		expect(source.getFiles().map((file) => file.path)).toEqual([
			"Coffee.pdf",
		]);
		source.dispose();
	});

	it("does not retain stale mentions after rename or deletion during typing", async () => {
		const f = fakeVault();
		const source = createPaletteFileSource(f.vault);
		const { target, component } = createComponent({
			getFiles: source.getFiles,
		});
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "@Coffee.md explain");
		await typeIntoPalette(input, "@Coffee.md explain more");
		expect(f.getFiles).toHaveBeenCalledTimes(1);
		expect(input.querySelector(".file-mention")).not.toBeNull();
		f.replace([{ path: "New.md", basename: "New", extension: "md" }]);
		f.callbacks.get("rename")!();
		await typeIntoPalette(input, "@Coffee.md explain");
		expect(input.querySelector(".file-mention")).toBeNull();
		await typeIntoPalette(input, "@New.md explain");
		expect(
			input.querySelector(".file-mention")?.getAttribute("data-path"),
		).toBe("New.md");
		f.replace([]);
		f.callbacks.get("delete")!();
		await typeIntoPalette(input, "@New.md explain more");
		expect(input.querySelector(".file-mention")).toBeNull();
		component.$destroy();
		target.remove();
		source.dispose();
	});

	it("stops filtering once the first 15 unselected matches are found", () => {
		const files = Array.from({ length: 20 }, (_, i) => ({
			path: `${i}.md`,
			basename: `Note ${i}`,
			extension: "md",
		}));
		const readTail = vi.fn(() => "unread");
		Object.defineProperty(files[19], "basename", { get: readTail });
		expect(
			filterAvailableFiles("note", files, ["0.md"]).map((f) => f.path),
		).toEqual(files.slice(1, 16).map((f) => f.path));
		expect(readTail).not.toHaveBeenCalled();
	});
});
