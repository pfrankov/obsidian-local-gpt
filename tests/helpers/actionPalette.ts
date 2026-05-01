import { tick } from "svelte";
import ActionPalette from "../../src/ui/ActionPalette.svelte";

export const setCaretToEnd = (element: HTMLElement) => {
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
};

export const setCaretAtIndex = (element: HTMLElement, index: number) => {
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

export const requireElement = <T extends Element>(
	container: ParentNode,
	selector: string,
) => {
	const el = container.querySelector(selector);
	if (!el) {
		throw new Error(`Element not found: ${selector}`);
	}
	return el as T;
};

export const createComponent = (props: Record<string, unknown> = {}) => {
	const target = document.createElement("div");
	document.body.appendChild(target);
	// Cast to any to align with the testing runtime signature
	const component = new (ActionPalette as any)({ target, props });
	return { target, component };
};

export const typeIntoPalette = async (
	textbox: HTMLDivElement,
	text: string,
) => {
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
