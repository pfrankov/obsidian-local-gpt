import { afterEach, describe, expect, it } from "vitest";
import { tick } from "svelte";
import {
	createComponent,
	requireElement,
	setCaretToEnd,
	typeIntoPalette,
} from "./helpers/actionPalette";
import {
	beginHoldingPromptFocus,
	endHoldingPromptFocus,
	shouldReclaimPromptFocus,
	installPaletteOutsidePointerRelease,
} from "../src/ui/actionPaletteDom";

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

const coffeeFile = {
	path: "notes/Coffee Beans.md",
	basename: "Coffee Beans",
	extension: "md",
};

describe("action palette focus hold", () => {
	it("releases hold on pointerdown outside the palette so the editor can take focus", async () => {
		const { target, component } = createComponent();
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		beginHoldingPromptFocus(input);
		expect(shouldReclaimPromptFocus(input)).toBe(true);

		const stop = installPaletteOutsidePointerRelease(() => input);
		const note = document.createElement("div");
		note.className = "cm-content";
		note.contentEditable = "true";
		document.body.appendChild(note);
		note.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
		);
		expect(shouldReclaimPromptFocus(input)).toBe(false);
		stop();
		note.remove();
		component.$destroy();
	});

	it("does not release hold for pointerdown inside the palette shell", async () => {
		const { target, component } = createComponent();
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		beginHoldingPromptFocus(input);
		const stop = installPaletteOutsidePointerRelease(() => input);
		input.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
		);
		expect(shouldReclaimPromptFocus(input)).toBe(true);
		stop();
		endHoldingPromptFocus(input);
		component.$destroy();
	});
});

describe("initial document chip", () => {
	it("renders atomic contenteditable=false chips that survive typing", async () => {
		const { target, component } = createComponent({
			getFiles: () => [coffeeFile],
			initialSelectedFiles: [coffeeFile.path],
		});
		await tick();
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		const chip = requireElement<HTMLSpanElement>(input, ".file-mention");
		expect(chip.getAttribute("contenteditable")).toBe("false");
		expect(input.textContent).toContain("@Coffee Beans.md");

		input.focus();
		setCaretToEnd(input);
		await typeIntoPalette(input, `${input.textContent || ""}hello`);
		await tick();
		expect(input.querySelector(".file-mention")).toBeTruthy();
		expect(input.textContent).toContain("@Coffee Beans.md");
		expect(input.textContent).toContain("hello");
		component.$destroy();
	});

	it("keeps the chip when a browser tries to edit inside the mention span", async () => {
		const { target, component } = createComponent({
			getFiles: () => [coffeeFile],
			initialSelectedFiles: [coffeeFile.path],
		});
		await tick();
		await tick();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		const chip = requireElement<HTMLSpanElement>(input, ".file-mention");
		// contenteditable=false should keep mutation from sticking after re-render,
		// but even if DOM is mutated, re-parse from a broken mention must not wipe
		// selectedFiles until the chip text is gone from textContent.
		expect(chip.getAttribute("contenteditable")).toBe("false");
		await typeIntoPalette(input, `${input.textContent || ""}x`);
		await tick();
		expect(input.querySelector(".file-mention")).toBeTruthy();
		expect(input.textContent).toContain("@Coffee Beans.md");
		component.$destroy();
	});
});
