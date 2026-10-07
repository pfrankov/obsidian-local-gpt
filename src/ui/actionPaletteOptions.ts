import type {
	CommandReference,
	CreativityReference,
	FileReference,
	ModelReference,
	ProviderReference,
	SystemPromptReference,
	TextToken,
} from "../interfaces";
import { I18n } from "../i18n";
import {
	CLEAR_SYSTEM_PROMPT_ID,
	MAX_DROPDOWN_RESULTS,
	SYSTEM_PREVIEW_LENGTH,
} from "./actionPaletteTypes";
import { getFullFileName } from "./actionPaletteText";

export function getCreativityOptions(): CreativityReference[] {
	return [
		{ id: "default", name: I18n.t("settings.creativityDefault") },
		{ id: "", name: I18n.t("settings.creativityNone") },
		{ id: "low", name: I18n.t("settings.creativityLow") },
		{ id: "medium", name: I18n.t("settings.creativityMedium") },
		{ id: "high", name: I18n.t("settings.creativityHigh") },
	];
}

/** Footer chip text; empty for API default so the chip does not render. */
export function formatCreativityBadgeLabel(creativityKey: string): string {
	if (creativityKey === "default") {
		return "";
	}
	const option = getCreativityOptions().find(
		(entry) => entry.id === creativityKey,
	);
	return option?.name || "";
}

export function getAvailableCommands(
	includeReasoning = true,
): CommandReference[] {
	const commands: CommandReference[] = [
		{
			name: "provider",
			description: I18n.t("commands.actionPalette.changeProvider"),
		},
		{
			name: "model",
			description: I18n.t("commands.actionPalette.changeModel"),
		},
		{
			name: "creativity",
			description: I18n.t("commands.actionPalette.changeCreativity"),
		},
		{
			name: "system",
			description: I18n.t("commands.actionPalette.changeSystemPrompt"),
		},
	];
	if (includeReasoning) {
		commands.push({
			name: "reasoning",
			description: I18n.t("commands.actionPalette.changeReasoning"),
		});
	}
	return commands;
}

export function filterAvailableCommands(
	query: string,
	includeReasoning = true,
): CommandReference[] {
	const normalizedQuery = query.toLowerCase();

	return getAvailableCommands(includeReasoning)
		.filter((command) => {
			return (
				command.name.toLowerCase().includes(normalizedQuery) ||
				command.description.toLowerCase().includes(normalizedQuery)
			);
		})
		.slice(0, MAX_DROPDOWN_RESULTS);
}

export function filterAvailableFiles(
	query: string,
	availableFiles: FileReference[],
	selectedFiles: string[],
): FileReference[] {
	const normalizedQuery = query.toLowerCase();

	return availableFiles
		.filter((file) => {
			const fullFileName = getFullFileName(file);
			const isQueryMatch =
				file.basename.toLowerCase().includes(normalizedQuery) ||
				fullFileName.toLowerCase().includes(normalizedQuery);
			const isNotAlreadySelected = !selectedFiles.includes(file.path);

			return isQueryMatch && isNotAlreadySelected;
		})
		.slice(0, MAX_DROPDOWN_RESULTS);
}

export function filterProviderItems(
	providers: ProviderReference[],
	query: string,
) {
	return providers
		.filter(
			(provider) =>
				fuzzyMatch(provider.name, query) ||
				fuzzyMatch(provider.providerName, query),
		)
		.slice(0, MAX_DROPDOWN_RESULTS);
}

export function filterModelItems(models: ModelReference[], query: string) {
	return models
		.filter((model) => fuzzyMatch(model.name, query))
		.slice(0, MAX_DROPDOWN_RESULTS);
}

export function filterCreativityItems(
	options: CreativityReference[],
	query: string,
) {
	return options
		.filter((option) => fuzzyMatch(option.name, query))
		.slice(0, MAX_DROPDOWN_RESULTS);
}

export function buildSystemPromptOptions(
	prompts: SystemPromptReference[],
	selectedSystemPromptName: string,
) {
	if (!selectedSystemPromptName) {
		return prompts;
	}

	return [
		{
			id: CLEAR_SYSTEM_PROMPT_ID,
			name: I18n.t("commands.actionPalette.clearSystemPrompt"),
			system: "",
		},
		...prompts,
	];
}

export function filterSystemPromptItems(
	systemPrompts: SystemPromptReference[],
	query: string,
) {
	const normalizedQuery = query.toLowerCase();
	const resetOption = systemPrompts.find(
		(prompt) => prompt.id === CLEAR_SYSTEM_PROMPT_ID,
	);
	const promptOptions = systemPrompts.filter(
		(prompt) => prompt.id !== CLEAR_SYSTEM_PROMPT_ID,
	);
	const matches = promptOptions
		.filter((prompt) =>
			normalizedQuery
				? prompt.name.toLowerCase().includes(normalizedQuery)
				: true,
		)
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(
			0,
			resetOption &&
				(!normalizedQuery ||
					resetOption.name.toLowerCase().includes(normalizedQuery))
				? MAX_DROPDOWN_RESULTS - 1
				: MAX_DROPDOWN_RESULTS,
		);

	return resetOption &&
		(!normalizedQuery ||
			resetOption.name.toLowerCase().includes(normalizedQuery))
		? [resetOption, ...matches]
		: matches;
}

export function formatSystemPreview(text: string) {
	const singleLine = text.replace(/\r?\n/g, " ");
	if (singleLine.length <= SYSTEM_PREVIEW_LENGTH) return singleLine;
	return `${singleLine.slice(0, SYSTEM_PREVIEW_LENGTH - 1)}…`;
}

export function fuzzyMatch(target: string, query: string): boolean {
	if (!query) return true;
	let targetIndex = 0;
	const normalizedTarget = target.toLowerCase();
	for (const queryCharacter of query) {
		targetIndex = normalizedTarget.indexOf(queryCharacter, targetIndex);
		if (targetIndex === -1) return false;
		targetIndex++;
	}
	return true;
}

export interface ProviderLabelParts {
	providerName: string;
	modelName: string;
	creativityBadge: string;
}

export function getProviderLabelParts(
	providerLabel: string,
): ProviderLabelParts {
	const parts = providerLabel.split(" · ");
	const last = parts[parts.length - 1]?.trim() || "";
	const creativityBadge =
		parts.length > 2 &&
		getCreativityOptions().some((option) => option.name === last)
			? parts.pop()!.trim()
			: "";
	return {
		providerName: parts.shift() || "",
		modelName: parts.join(" · ").trim(),
		creativityBadge,
	};
}

export function buildProviderLabel(
	providerName: string,
	modelName: string,
	creativityBadge: string,
) {
	const base = [providerName, modelName].filter(Boolean).join(" · ");
	const extras = [creativityBadge].filter(Boolean).join(" · ");
	return extras ? `${base} · ${extras}` : base;
}

export function getMentionedFilePaths(tokens: TextToken[]) {
	return tokens
		.filter((token) => token.type === "file" && token.filePath)
		.map((token) => token.filePath!);
}
