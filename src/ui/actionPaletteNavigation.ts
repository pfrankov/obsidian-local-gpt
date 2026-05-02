import {
	getPromptHistoryEntry,
	getPromptHistoryLength,
} from "./actionPaletteHistory";
import type { FileReference, TextToken } from "../interfaces";
import type { DropdownItem } from "./actionPaletteTypes";
import {
	getCurrentCursorPosition,
	scrollSelectedIntoView,
} from "./actionPaletteDom";
import { applyHistoryEntry } from "./actionPaletteEditing";
import type { ActionPaletteControllerOptions } from "./actionPaletteController";
import type { ActionPaletteState } from "./actionPaletteState";

interface NavigationContext {
	state: ActionPaletteState;
	options: ActionPaletteControllerOptions;
	handleSelection(item: DropdownItem): void;
	getFiles(): FileReference[];
	parseTextToTokens(text: string): TextToken[];
	hideDropdown(): void;
	updateContentDisplay(): void;
	submitAction(): void;
	commit(): void;
}

export function handleDropdownNavigation(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	if (!hasActiveDropdownItems(context)) {
		return false;
	}

	return (
		handleDropdownMove(context, event) ||
		handleDropdownSelection(context, event) ||
		handleDropdownEscape(context, event)
	);
}

export function handleGeneralNavigation(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	if (event.key === "Enter") {
		if (event.shiftKey) return;
		event.preventDefault();
		context.submitAction();
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		context.options.onCancel()?.();
		context.options.dispatchCancel();
	}
}

export function handleHistoryNavigation(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	if (!isHistoryNavigationKey(context, event)) {
		return false;
	}

	const currentPosition = getCurrentCursorPosition(
		context.options.getContentElement(),
	);
	context.state.cursorPosition = currentPosition;

	if (!canUseHistoryAtCursor(context, event.key, currentPosition)) {
		return false;
	}

	const historyLength = getPromptHistoryLength();
	if (historyLength === 0) return false;

	moveHistoryIndex(context, event.key, historyLength);

	const entry =
		context.state.historyIndex >= 0 &&
		context.state.historyIndex < historyLength
			? getPromptHistoryEntry(context.state.historyIndex)
			: context.state.draftBeforeHistory;
	event.preventDefault();
	applyHistoryEntry(context, entry || "");
	return true;
}

function hasActiveDropdownItems(context: NavigationContext) {
	return (
		context.state.activeDropdown !== "none" &&
		context.state.filteredItems.length > 0
	);
}

function handleDropdownMove(context: NavigationContext, event: KeyboardEvent) {
	if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
		return false;
	}
	event.preventDefault();
	moveSelection(context, event.key === "ArrowDown" ? 1 : -1);
	return true;
}

function handleDropdownSelection(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	if (event.key === "Enter" && event.shiftKey) return false;
	if (event.key !== "Enter" && event.key !== "Tab") return false;

	event.preventDefault();
	const selectedItem =
		context.state.filteredItems[context.state.selectedIndex];
	if (context.state.selectedIndex >= 0 && selectedItem) {
		context.handleSelection(selectedItem);
	}
	return true;
}

function handleDropdownEscape(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	if (event.key !== "Escape") return false;
	event.preventDefault();
	context.hideDropdown();
	return true;
}

function moveSelection(context: NavigationContext, delta: number) {
	context.state.selectedIndex = Math.min(
		Math.max(context.state.selectedIndex + delta, -1),
		context.state.filteredItems.length - 1,
	);
	scrollSelectedIntoView(
		context.options.getDropdownElement(context.state.activeDropdown),
		context.state.selectedIndex,
	);
	context.commit();
}

function isHistoryNavigationKey(
	context: NavigationContext,
	event: KeyboardEvent,
) {
	const isHistoryKey = event.key === "ArrowUp" || event.key === "ArrowDown";
	return isHistoryKey && context.state.activeDropdown === "none";
}

function canUseHistoryAtCursor(
	context: NavigationContext,
	key: string,
	currentPosition: number,
) {
	if (key === "ArrowUp") {
		return isCursorOnFirstLine(context, currentPosition);
	}
	return isCursorOnLastLine(context, currentPosition);
}

function moveHistoryIndex(
	context: NavigationContext,
	key: string,
	historyLength: number,
) {
	if (context.state.historyIndex === historyLength) {
		context.state.draftBeforeHistory = context.state.textContent;
	}
	if (key === "ArrowUp" && context.state.historyIndex > 0) {
		context.state.historyIndex -= 1;
		return;
	}
	if (key === "ArrowDown" && context.state.historyIndex < historyLength) {
		context.state.historyIndex += 1;
	}
}

function isCursorOnFirstLine(context: NavigationContext, position: number) {
	const index = Math.max(position - 1, 0);
	return context.state.textContent.lastIndexOf("\n", index) === -1;
}

function isCursorOnLastLine(context: NavigationContext, position: number) {
	return context.state.textContent.indexOf("\n", position) === -1;
}
