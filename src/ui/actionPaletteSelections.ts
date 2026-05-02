import type {
	CreativityReference,
	ModelReference,
	ProviderReference,
	SystemPromptReference,
} from "../interfaces";
import { CLEAR_SYSTEM_PROMPT_ID } from "./actionPaletteTypes";
import type { DropdownItem, DropdownKind } from "./actionPaletteTypes";
import {
	buildSystemPromptOptions,
	filterCreativityItems,
	filterModelItems,
	filterProviderItems,
	filterSystemPromptItems,
	getCreativityOptions,
} from "./actionPaletteOptions";
import type { ActionPaletteControllerOptions } from "./actionPaletteController";
import type { ActionPaletteState } from "./actionPaletteState";

interface SelectionContext {
	state: ActionPaletteState;
	options: ActionPaletteControllerOptions;
	getCommandQuery(commandName: string): string;
	updateFilteredDropdownItems(matches: DropdownItem[]): void;
	setProviderBadgeLabel(providerName: string, modelName: string): void;
	highlightBadgeTemporarily(): void;
	removeCommandAndQuery(commandName: string): void;
	hideDropdown(): void;
	commit(): void;
}

export async function selectProvider(
	context: SelectionContext,
	provider: ProviderReference,
) {
	try {
		await context.options.onProviderChange()?.(provider.id);
		context.setProviderBadgeLabel(provider.providerName, provider.name);
		context.options.setProviderId(provider.id);
		context.state.providerName = provider.providerName;
		completeCommandSelection(context, "provider");
	} catch (error) {
		console.error("Error selecting provider:", error);
		context.hideDropdown();
	}
	context.commit();
}

export async function selectModel(
	context: SelectionContext,
	model: ModelReference,
) {
	try {
		await context.options.onModelChange()?.(model.name);
		context.setProviderBadgeLabel(context.state.providerName, model.name);
		completeCommandSelection(context, "model");
	} catch (error) {
		console.error("Error selecting model:", error);
		context.hideDropdown();
	}
	context.commit();
}

export async function selectCreativity(
	context: SelectionContext,
	option: CreativityReference,
) {
	try {
		await context.options.onCreativityChange()?.(option.id);
		context.state.creativityBadge = option.name;
		context.setProviderBadgeLabel(
			context.state.providerName,
			context.state.modelName,
		);
		completeCommandSelection(context, "creativity");
	} catch (error) {
		console.error("Error selecting creativity:", error);
		context.hideDropdown();
	}
	context.commit();
}

export async function selectSystemPrompt(
	context: SelectionContext,
	option: SystemPromptReference,
) {
	try {
		if (option.id === CLEAR_SYSTEM_PROMPT_ID) {
			context.state.selectedSystemPromptValue = undefined;
			context.state.selectedSystemPromptName = "";
			await context.options.onSystemPromptChange()?.(null);
			context.highlightBadgeTemporarily();
			context.removeCommandAndQuery("system");
			context.hideDropdown();
			context.commit();
			return;
		}
		context.state.selectedSystemPromptValue = option.system;
		context.state.selectedSystemPromptName = option.name;
		await context.options.onSystemPromptChange()?.(option.id);
		completeCommandSelection(context, "system");
	} catch (error) {
		console.error("Error selecting system prompt:", error);
		context.hideDropdown();
	}
	context.commit();
}

export async function showProviderDropdown(context: SelectionContext) {
	const getProviders = context.options.getProviders();
	if (!getProviders) return;

	try {
		context.state.allProviders = await getProviders();
		applyProviderFilter(context);
		showLoadedDropdown(context, "provider", "No providers available");
	} catch (error) {
		console.error("Error showing provider dropdown:", error);
	}
	context.commit();
}

export async function showModelDropdown(context: SelectionContext) {
	const getModels = context.options.getModels();
	const providerId = context.options.getProviderId();
	if (!getModels || !providerId) return;

	try {
		context.state.allModels = await getModels(providerId);
		applyModelFilter(context);
		showLoadedDropdown(context, "model", "No models available");
	} catch (error) {
		console.error("Error showing model dropdown:", error);
	}
	context.commit();
}

export async function showCreativityDropdown(context: SelectionContext) {
	try {
		context.state.allCreativities = getCreativityOptions();
		applyCreativityFilter(context);
		if (context.state.filteredItems.length > 0) {
			context.state.activeDropdown = "creativity";
			context.state.selectedIndex = 0;
		}
	} catch (error) {
		console.error("Error showing creativity dropdown:", error);
	}
	context.commit();
}

export async function showSystemDropdown(context: SelectionContext) {
	const getSystemPrompts = context.options.getSystemPrompts();
	if (!getSystemPrompts) return;
	try {
		context.state.allSystemPrompts = buildSystemPromptOptions(
			getSystemPrompts(),
			context.state.selectedSystemPromptName,
		);
		applySystemFilter(context);
		if (context.state.filteredItems.length > 0) {
			context.state.activeDropdown = "system";
			context.state.selectedIndex = 0;
		}
	} catch (error) {
		console.error("Error showing system dropdown:", error);
	}
	context.commit();
}

export function applyProviderFilter(context: SelectionContext) {
	if (!context.state.allProviders.length) return;
	const query = context.getCommandQuery("provider");
	const matches = filterProviderItems(context.state.allProviders, query);
	context.updateFilteredDropdownItems(matches);
	if (
		query &&
		matches.length === 1 &&
		matches[0].name.toLowerCase() === query
	) {
		void selectProvider(context, matches[0]);
	}
}

export function applyModelFilter(context: SelectionContext) {
	if (!context.state.allModels.length) return;
	const query = context.getCommandQuery("model");
	const matches = filterModelItems(context.state.allModels, query);
	context.updateFilteredDropdownItems(matches);
	if (
		query &&
		matches.length === 1 &&
		matches[0].name.toLowerCase() === query
	) {
		void selectModel(context, matches[0]);
	}
}

export function applyCreativityFilter(context: SelectionContext) {
	if (!context.state.allCreativities.length) return;
	const query = context.getCommandQuery("creativity");
	const matches = filterCreativityItems(context.state.allCreativities, query);
	context.updateFilteredDropdownItems(matches);
	if (!query) return;

	const exact = matches.find(
		(option) => option.name.toLowerCase() === query.toLowerCase(),
	);
	if (exact) void selectCreativity(context, exact);
}

export function applySystemFilter(context: SelectionContext) {
	if (!context.state.allSystemPrompts.length) return;
	const query = context.getCommandQuery("system");
	const matches = filterSystemPromptItems(
		context.state.allSystemPrompts,
		query,
	);
	context.updateFilteredDropdownItems(matches);
	if (!query) return;

	const exact = context.state.allSystemPrompts
		.filter((prompt) => prompt.id !== CLEAR_SYSTEM_PROMPT_ID)
		.find((prompt) => prompt.name.toLowerCase() === query.toLowerCase());
	if (exact) void selectSystemPrompt(context, exact);
}

function completeCommandSelection(
	context: SelectionContext,
	commandName: string,
) {
	context.highlightBadgeTemporarily();
	context.removeCommandAndQuery(commandName);
	context.hideDropdown();
}

function showLoadedDropdown(
	context: SelectionContext,
	kind: Exclude<DropdownKind, "none">,
	emptyMessage: string,
) {
	if (context.state.filteredItems.length > 0) {
		context.state.activeDropdown = kind;
		context.state.selectedIndex = 0;
		return;
	}
	console.warn(emptyMessage);
}
