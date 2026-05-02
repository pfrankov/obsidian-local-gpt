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
		{ id: "", name: I18n.t("settings.creativityNone") },
		{ id: "low", name: I18n.t("settings.creativityLow") },
		{ id: "medium", name: I18n.t("settings.creativityMedium") },
		{ id: "high", name: I18n.t("settings.creativityHigh") },
	];
}

export function getAvailableCommands(): CommandReference[] {
	return [
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
}

export function filterAvailableCommands(query: string): CommandReference[] {
	const normalizedQuery = query.toLowerCase();

	return getAvailableCommands()
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

export function getProviderLabelParts(providerLabel: string) {
	const [providerName = "", modelName = "", creativityBadge = ""] =
		providerLabel.split(" · ");
	return {
		providerName,
		modelName: modelName.trim(),
		creativityBadge: creativityBadge.trim(),
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
