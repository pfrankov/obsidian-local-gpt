import type { DropdownKind } from "./actionPaletteTypes";

export function getCurrentCursorPosition(
	contentElement: HTMLDivElement | null,
): number {
	if (!contentElement) return 0;

	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return 0;

	const range = selection.getRangeAt(0);
	let position = 0;
	const walker = document.createTreeWalker(
		contentElement,
		NodeFilter.SHOW_TEXT,
		null,
	);

	let textNode;
	while ((textNode = walker.nextNode())) {
		if (textNode === range.startContainer) {
			return position + range.startOffset;
		}
		position += textNode.textContent?.length || 0;
	}

	return position;
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
