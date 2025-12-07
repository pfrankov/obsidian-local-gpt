/// <reference types="vitest" />

import { describe, test, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import ActionPalette from "../src/ui/ActionPalette.svelte";
import {
	addToPromptHistory,
	resetPromptHistory,
} from "../src/ui/actionPaletteHistory";
import { I18n } from "../src/i18n";

const setCaretToEnd = (element: HTMLElement) => {
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
};

const setCaretAtIndex = (element: HTMLElement, index: number) => {
	const range = document.createRange();
	const textNode = element.firstChild;
	if (textNode && textNode.nodeType === Node.TEXT_NODE) {
		const clampedIndex = Math.max(
			0,
			Math.min(index, textNode.textContent?.length ?? 0),
		);
		range.setStart(textNode, clampedIndex);
		range.setEnd(textNode, clampedIndex);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}
};

const requireElement = <T extends Element>(
	container: ParentNode,
	selector: string,
) => {
	const el = container.querySelector(selector);
	if (!el) {
		throw new Error(`Element not found: ${selector}`);
	}
	return el as T;
};

const createComponent = (props: Record<string, unknown> = {}) => {
	const target = document.createElement("div");
	document.body.appendChild(target);
	// Cast to any to align with the testing runtime signature
	const component = new (ActionPalette as any)({ target, props });
	return { target, component };
};

const typeIntoPalette = async (textbox: HTMLDivElement, text: string) => {
	textbox.textContent = text;
	setCaretToEnd(textbox);
	textbox.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			data: text.slice(-1),
			inputType: "insertText",
		}),
	);
	await tick();
};

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
	resetPromptHistory();
});

describe("ActionPalette component", () => {
	test("renders placeholder from i18n", () => {
		const { target, component } = createComponent();
		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);

		expect(textbox.dataset.placeholder).toBe(
			I18n.t("commands.actionPalette.placeholder"),
		);
		component.$destroy();
	});

	test("selects a system prompt via command dropdown and submits it", async () => {
		const { target, component } = createComponent({
			getSystemPrompts: () => [{ name: "Preset", system: "You are kind" }],
		});
		const submitSpy = vi.fn();
		component.$on("submit", (event) => submitSpy(event.detail));

		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		textbox.focus();
		setCaretToEnd(textbox);
		textbox.textContent = "/";
		textbox.dispatchEvent(
			new InputEvent("input", { bubbles: true, data: "/", inputType: "insertText" }),
		);
		await tick();

		const commandItems = Array.from(
			target.querySelectorAll(".local-gpt-command-name"),
		);
		const systemCommand = commandItems.find((el) =>
			el.textContent?.trim().includes("/system"),
		) as HTMLElement;
		systemCommand?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick();

		const systemItems = Array.from(
			target.querySelectorAll(".local-gpt-system-name"),
		);
		const presetItem = systemItems.find(
			(el) => el.textContent?.trim() === "Preset",
		) as HTMLElement;
		presetItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await tick();

		setCaretToEnd(textbox);
		textbox.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(submitSpy).toHaveBeenCalledWith(
			expect.objectContaining({ systemPrompt: "You are kind" }),
		);
		component.$destroy();
	});

	test("filters system prompts by name only", async () => {
		const { target, component } = createComponent({
			getSystemPrompts: () => [
				{ name: "Continue writing", system: "Continue the text" },
				{ name: "Find action items", system: "Find actions in text" },
			],
		});

		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		textbox.focus();
		await typeIntoPalette(textbox, "/system cont");

		const systemItems = Array.from(
			target.querySelectorAll(".local-gpt-system-name"),
		)
			.map((el) => el.textContent?.trim())
			.filter(Boolean) as string[];

		expect(systemItems).toEqual(["Continue writing"]);
		component.$destroy();
	});

	test("Shift+Enter inserts newline instead of submitting", async () => {
		const { target, component } = createComponent();
		const submitSpy = vi.fn();
		component.$on("submit", submitSpy);

		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		textbox.focus();
		textbox.textContent = "Hello";
		setCaretToEnd(textbox);

		textbox.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				shiftKey: true,
				bubbles: true,
			}),
		);

		// Simulate browser inserting a newline when default is not prevented
		textbox.textContent = "Hello\n";
		textbox.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "\n",
				inputType: "insertLineBreak",
			}),
		);
		await tick();

		expect(submitSpy).not.toHaveBeenCalled();
		expect(textbox.textContent?.includes("\n")).toBe(true);
		component.$destroy();
	});

	test("ArrowUp uses history only from the first line", async () => {
		addToPromptHistory("history-entry");
		const { target, component } = createComponent();
		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);

		await typeIntoPalette(textbox, "line1\nline2");
		setCaretAtIndex(textbox, 7); // position on second line

		textbox.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
		);
		await tick();

		expect(textbox.textContent).toBe("line1\nline2");
		component.$destroy();
	});

	test("ArrowDown uses history only from the last line", async () => {
		addToPromptHistory("draft");
		addToPromptHistory("history\nentry");
		const { target, component } = createComponent();
		const textbox = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);

		textbox.focus();
		setCaretToEnd(textbox);
		// Move to last history entry
		textbox.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
		);
		await tick();

		// Place cursor on the first line (not last line)
		setCaretAtIndex(textbox, 2);
		textbox.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		await tick();
		expect(textbox.textContent).toBe("history\nentry");

		// Now place cursor at the end (last line) and allow forward history
		setCaretToEnd(textbox);
		textbox.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		await tick();
		expect(textbox.textContent).toBe("");
		component.$destroy();
	});
});
