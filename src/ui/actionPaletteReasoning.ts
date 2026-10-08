import {
	getHighlightedItemId,
	highlightPreferredItem,
	restorePromptFocus,
} from "./actionPaletteDom";
import { I18n } from "../i18n";
import type { CreativityReference } from "../interfaces";
import type { ActionPaletteController } from "./actionPaletteController";
import {
	formatReasoningBadgeLabel,
	reasoningEffortLabel,
	sortReasoningModes,
} from "../reasoningEffort";

export function resetReasoning(context: ActionPaletteController) {
	context.state.reasoningRequest++;
	context.state.reasoningSelection = undefined;
	context.state.reasoningSnapshot = undefined;
	context.state.reasoningLabel = "";
	context.commit();
}

export async function refreshReasoning(context: ActionPaletteController) {
	const getSnapshot = context.options.getReasoningSnapshot?.();
	if (!getSnapshot) return;
	const request = ++context.state.reasoningRequest;
	try {
		const snapshot = await getSnapshot();
		if (request !== context.state.reasoningRequest) return;
		const selected = context.state.reasoningSelection;
		if (
			selected &&
			(selected.providerId !== snapshot.providerId ||
				selected.model !== snapshot.model ||
				(selected.mode !== "default" &&
					!snapshot.modes.includes(selected.mode)))
		) {
			context.state.reasoningSelection = undefined;
		}
		context.state.reasoningSnapshot = snapshot;
		updateReasoningLabel(context);
	} catch {
		if (request === context.state.reasoningRequest) resetReasoning(context);
	}
}

export function updateReasoningLabel(context: ActionPaletteController) {
	const snapshot = context.state.reasoningSnapshot;
	if (!snapshot) return;
	const selected = context.state.reasoningSelection;
	const mode = selected ? selected.mode : snapshot.effectiveMode;
	context.state.reasoningLabel = formatReasoningBadgeLabel({
		selected: Boolean(selected),
		mode,
	});
	context.commit();
}

export async function showReasoningDropdown(context: ActionPaletteController) {
	context.state.activeDropdown = "reasoning";
	context.updateFilteredDropdownItems([]);
	const request = context.state.reasoningRequest + 1;
	await refreshReasoning(context);
	if (
		request !== context.state.reasoningRequest ||
		context.state.activeDropdown !== "reasoning" ||
		!context.state.reasoningSnapshot
	)
		return;
	applyReasoningFilter(context);
	restorePromptFocus(
		() => context.options.getContentElement(),
		context.state.cursorPosition >= 0
			? context.state.cursorPosition
			: context.state.textContent.length,
	);
}

export function applyReasoningFilter(context: ActionPaletteController) {
	const query = context.getCommandQuery("reasoning").toLowerCase();
	const modes = sortReasoningModes(
		context.state.reasoningSnapshot?.modes || [],
	);
	const options = [
		{ id: "", name: I18n.t("settings.reasoningEffortInherit") },
		{ id: "default", name: I18n.t("settings.reasoningEffortDefault") },
		...modes.map((mode) => ({
			id: mode,
			name: reasoningEffortLabel(mode),
		})),
	].filter((option) => option.name.trim().length > 0);
	const highlighted = getHighlightedItemId(context.state, "reasoning");
	context.updateFilteredDropdownItems(
		options.filter((option) => option.name.toLowerCase().includes(query)),
	);
	// "" = Use global setting (inherit), "default" = explicit API default.
	highlightPreferredItem(context, "reasoning", [
		highlighted,
		context.state.reasoningSelection?.mode ?? "",
	]);
}

export function selectReasoning(
	context: ActionPaletteController,
	option: CreativityReference,
) {
	const snapshot = context.state.reasoningSnapshot;
	if (
		!snapshot ||
		(option.id &&
			option.id !== "default" &&
			!snapshot.modes.includes(option.id))
	)
		return;
	context.state.reasoningSelection = option.id
		? {
				mode: option.id,
				providerId: snapshot.providerId,
				model: snapshot.model,
			}
		: undefined;
	updateReasoningLabel(context);
	context.removeCommandAndQuery("reasoning");
	context.hideDropdown();
	context.highlightBadgeTemporarily();
	restorePromptFocus(
		() => context.options.getContentElement(),
		context.state.textContent.length,
	);
}
