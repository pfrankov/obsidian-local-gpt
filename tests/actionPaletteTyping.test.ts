import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("palette typing vault access", () => {
	it("does not enumerate the vault while opening or typing plain text and commands", async () => {
		const getFiles = vi.fn(() => []);
		const { target, component } = createComponent({ getFiles });
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		for (const text of ["H", "Hello", "Hello world", "/", "/unknown"]) {
			await typeIntoPalette(input, text);
		}
		expect(getFiles).not.toHaveBeenCalled();
		component.$destroy();
	});

	it("still resolves live mentions and preserves their selected files during ordinary edits", async () => {
		const file = {
			path: "notes/Coffee.md",
			basename: "Coffee",
			extension: "md",
		};
		const getFiles = vi.fn(() => [file]);
		const onSubmit = vi.fn();
		const { target, component } = createComponent({ getFiles, onSubmit });
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "@Coffee.md explain");
		expect(getFiles).toHaveBeenCalled();
		expect(
			input.querySelector(".file-mention")?.getAttribute("data-path"),
		).toBe(file.path);
		await typeIntoPalette(input, "@Coffee.md explain more");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				selectedFiles: [file.path],
				text: "@Coffee.md explain more",
			}),
		);
		component.$destroy();
	});
});
