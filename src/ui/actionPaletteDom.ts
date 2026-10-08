import { tick } from "svelte";
import type { DropdownItem, DropdownKind } from "./actionPaletteTypes";

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

function isInsideAtomicChip(node: Node, root: HTMLElement) {
	let element =
		node.nodeType === Node.ELEMENT_NODE
			? (node as HTMLElement)
			: node.parentElement;
	while (element && element !== root) {
		if (element.getAttribute("contenteditable") === "false") {
			return element;
		}
		element = element.parentElement;
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
			const chip = isInsideAtomicChip(textNode, contentElement);
			if (chip) {
				// Place caret after atomic chips so typing cannot edit them.
				range.setStartAfter(chip);
				range.collapse(true);
			} else {
				const offset = position - currentPosition;
				range.setStart(textNode, offset);
				range.setEnd(textNode, offset);
			}
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

interface HighlightContext {
	state: {
		activeDropdown: DropdownKind;
		filteredItems: DropdownItem[];
		selectedIndex: number;
	};
	options: { getDropdownElement: (kind: DropdownKind) => HTMLElement | null };
	commit(): void;
}

function itemId(item: DropdownItem | undefined) {
	const id = (item as { id?: unknown } | undefined)?.id;
	return typeof id === "string" ? id : undefined;
}

/** Id of the highlighted item while `kind` is the open picker. */
export function getHighlightedItemId(
	state: HighlightContext["state"],
	kind: DropdownKind,
) {
	if (state.activeDropdown !== kind) return undefined;
	return itemId(state.filteredItems[state.selectedIndex]);
}

/**
 * Highlight the first id in `preferredIds` present in the filtered items
 * (falls back to the first item) and scroll it into view once rendered.
 */
export function highlightPreferredItem(
	context: HighlightContext,
	kind: Exclude<DropdownKind, "none">,
	preferredIds: (string | undefined)[],
) {
	const items = context.state.filteredItems;
	const index = preferredIds
		.filter((id): id is string => id !== undefined)
		.map((id) => items.findIndex((item) => itemId(item) === id))
		.find((match) => match >= 0);
	context.state.selectedIndex = index ?? (items.length > 0 ? 0 : -1);
	context.commit();
	void tick().then(() => {
		if (context.state.activeDropdown !== kind) return;
		scrollSelectedIntoView(
			context.options.getDropdownElement(kind),
			context.state.selectedIndex,
		);
	});
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

/** Select all text inside the palette input (Mod+A must not reach the note). */
export function selectAllInPromptInput(contentElement: HTMLDivElement | null) {
	if (!contentElement) return;
	contentElement.focus({ preventScroll: true });
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(contentElement);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Elements that should reclaim programmatic focus steals (not user clicks). */
const holdingPromptFocus = new WeakSet<HTMLElement>();

/** Reclaim CM/Obsidian focus theft while the user has not clicked away. */
export function beginHoldingPromptFocus(contentElement: HTMLElement | null) {
	if (contentElement) holdingPromptFocus.add(contentElement);
}

export function endHoldingPromptFocus(contentElement: HTMLElement | null) {
	if (contentElement) holdingPromptFocus.delete(contentElement);
}

export function shouldReclaimPromptFocus(contentElement: HTMLElement | null) {
	if (!contentElement) return false;
	return holdingPromptFocus.has(contentElement);
}

/**
 * Restore focus after dropdown selection / remount. Sync + post-tick cover the
 * CM race when Enter unmounts a dropdown; Mod+A is handled separately.
 */
export function restorePromptFocus(
	getContentElement: () => HTMLDivElement | null,
	cursorPosition?: number,
) {
	const run = () => {
		const el = getContentElement();
		if (!el) return;
		beginHoldingPromptFocus(el);
		const position =
			typeof cursorPosition === "number"
				? cursorPosition
				: (el.textContent?.length ?? 0);
		focusPromptInput(el, position);
	};
	run();
	void tick().then(run);
}

/**
 * Capture-phase Mod+A guard. Obsidian/CM register select-all in capture and
 * the palette sits inside cm-content, so bubble stopPropagation alone is not
 * enough — we must preventDefault before the editor keymap runs.
 */
export function installPaletteModAGuard(
	getContentElement: () => HTMLDivElement | null,
): () => void {
	const onKeydown = (event: KeyboardEvent) => {
		if (!(event.ctrlKey || event.metaKey)) return;
		const key =
			event.key.length === 1 ? event.key.toLowerCase() : event.key;
		if (key !== "a") return;
		const el = getContentElement();
		if (!el?.isConnected) return;
		const shell = el.closest(".local-gpt-action-palette-shell");
		const active = document.activeElement;
		if (
			active !== el &&
			!(shell && active instanceof Node && shell.contains(active))
		) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		selectAllInPromptInput(el);
	};
	window.addEventListener("keydown", onKeydown, true);
	return () => window.removeEventListener("keydown", onKeydown, true);
}

/**
 * Deliberate pointer interaction outside the palette releases focus hold so
 * the editor caret moves normally. Programmatic focus theft (no pointerdown)
 * still hits shouldReclaimPromptFocus and is restored.
 */
export function installPaletteOutsidePointerRelease(
	getContentElement: () => HTMLDivElement | null,
): () => void {
	const onPointerDown = (event: Event) => {
		const el = getContentElement();
		if (!el?.isConnected) return;
		const shell = el.closest(".local-gpt-action-palette-shell");
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (shell?.contains(target) || el.contains(target)) return;
		endHoldingPromptFocus(el);
	};
	window.addEventListener("pointerdown", onPointerDown, true);
	return () => window.removeEventListener("pointerdown", onPointerDown, true);
}
