import { tick } from "svelte";
import type { DropdownKind } from "./actionPaletteTypes";

export function getCurrentCursorPosition(
	contentElement: HTMLDivElement | null,
	fallback = 0,
): number {
	if (!contentElement) return fallback;

	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return fallback;

	const range = selection.getRangeAt(0);
	if (!contentElement.contains(range.startContainer)) return fallback;

	if (range.startContainer === contentElement) {
		return cursorOffsetAmongChildren(contentElement, range.startOffset);
	}

	const textOffset = cursorOffsetAmongTextNodes(
		contentElement,
		range.startContainer,
		range.startOffset,
	);
	return textOffset ?? (contentElement.textContent?.length || fallback);
}

function cursorOffsetAmongChildren(element: HTMLElement, childOffset: number) {
	let position = 0;
	const children = element.childNodes;
	for (let i = 0; i < childOffset && i < children.length; i++) {
		position += children[i].textContent?.length || 0;
	}
	return position;
}

function cursorOffsetAmongTextNodes(
	root: HTMLElement,
	target: Node,
	offset: number,
) {
	let position = 0;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
	let textNode;
	while ((textNode = walker.nextNode())) {
		if (textNode === target) return position + offset;
		position += textNode.textContent?.length || 0;
	}
	return null;
}

export function setCursorPosition(
	contentElement: HTMLDivElement | null,
	position: number,
) {
	if (!contentElement) return;

	const selection = window.getSelection();
	const range = document.createRange();

	let currentPosition = 0;
	const walker = document.createTreeWalker(
		contentElement,
		NodeFilter.SHOW_TEXT,
		null,
	);

	let textNode;
	while ((textNode = walker.nextNode())) {
		const nodeLength = textNode.textContent?.length || 0;
		if (currentPosition + nodeLength >= position) {
			const offset = position - currentPosition;
			range.setStart(textNode, offset);
			range.setEnd(textNode, offset);
			selection?.removeAllRanges();
			selection?.addRange(range);
			return;
		}
		currentPosition += nodeLength;
	}

	// Empty or short content: place caret at end.
	range.selectNodeContents(contentElement);
	range.collapse(false);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

export function scrollSelectedIntoView(
	container: HTMLElement | null,
	index: number,
) {
	if (!container || index < 0) return;
	const selectedItem = container.children[index];
	if (!selectedItem) return;
	const dropdownRect = container.getBoundingClientRect();
	const itemRect = selectedItem.getBoundingClientRect();
	const isItemVisible =
		itemRect.top >= dropdownRect.top &&
		itemRect.bottom <= dropdownRect.bottom;
	if (!isItemVisible) {
		selectedItem.scrollIntoView({
			block: "nearest",
			behavior: "smooth",
		});
	}
}

export function getDropdownElementForKind(
	kind: DropdownKind,
	elements: Record<Exclude<DropdownKind, "none">, HTMLDivElement | null>,
) {
	if (kind === "none") {
		return null;
	}
	return elements[kind];
}

/** Focus the palette contenteditable and place the caret (CM must not keep keys). */
export function focusPromptInput(
	contentElement: HTMLDivElement | null,
	cursorPosition?: number,
) {
	if (!contentElement) return;
	contentElement.focus({ preventScroll: true });
	if (typeof cursorPosition === "number") {
		setCursorPosition(contentElement, cursorPosition);
	}
}

const reclaimFocusUntilByElement = new WeakMap<HTMLElement, number>();

/** True while a recent selection asked to reclaim focus from the editor. */
export function shouldReclaimPromptFocus(contentElement: HTMLElement | null) {
	if (!contentElement) return false;
	const until = reclaimFocusUntilByElement.get(contentElement) ?? 0;
	return performance.now() < until;
}

/**
 * Restore focus after dropdown selection. Enter keydown can unmount the
 * dropdown and let CodeMirror reclaim focus before Svelte ticks run, so we
 * focus sync, after tick, and on sequential animation frames.
 */
export function restorePromptFocus(
	getContentElement: () => HTMLDivElement | null,
	cursorPosition?: number,
) {
	const contentElement = getContentElement();
	if (contentElement) {
		reclaimFocusUntilByElement.set(contentElement, performance.now() + 750);
	}
	const run = () => {
		const el = getContentElement();
		if (!el) return;
		const position =
			typeof cursorPosition === "number"
				? cursorPosition
				: (el.textContent?.length ?? 0);
		focusPromptInput(el, position);
	};
	run();
	void tick().then(() => {
		run();
		requestAnimationFrame(() => {
			run();
			requestAnimationFrame(run);
		});
	});
}
