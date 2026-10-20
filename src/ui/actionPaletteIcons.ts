import { getIcon, Platform, setIcon } from "obsidian";

/**
 * Lucide "list-restart" (bundled with Obsidian ~1.5+). Older apps
 * (minAppVersion 0.15 bundles an earlier Lucide) fall back to "refresh-cw",
 * which exists in every Lucide build Obsidian shipped.
 */
export const REPLACE_SELECTION_ICON = "list-restart";
export const REPLACE_SELECTION_FALLBACK_ICON = "refresh-cw";

export function getReplaceSelectionIconId(): string {
	return typeof getIcon === "function" && getIcon(REPLACE_SELECTION_ICON)
		? REPLACE_SELECTION_ICON
		: REPLACE_SELECTION_FALLBACK_ICON;
}

export function getReplaceSelectionHotkeyLabel(): string {
	return Platform.isMacOS ? "⌥R" : "Alt+R";
}

/**
 * Svelte action: render a built-in Obsidian (Lucide) icon via the official
 * `setIcon` API — no innerHTML / raw SVG strings.
 */
export function obsidianIcon(node: HTMLElement, iconId: string) {
	setIcon(node, iconId);
	return {
		update(nextIconId: string) {
			setIcon(node, nextIconId);
		},
	};
}
