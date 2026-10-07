import type {
	CreativityReference,
	ReasoningPaletteSnapshot,
	ReasoningSelection,
	ModelReference,
	ProviderReference,
	SystemPromptReference,
	TextToken,
} from "../interfaces";
import type { DropdownItem, DropdownKind } from "./actionPaletteTypes";
import { getPromptHistoryLength } from "./actionPaletteHistory";
import type { ProviderLabelParts } from "./actionPaletteOptions";
import { getProviderLabelParts } from "./actionPaletteOptions";

export interface ActionPaletteState {
	reasoningSnapshot?: ReasoningPaletteSnapshot;
	reasoningSelection?: ReasoningSelection;
	reasoningLabel: string;
	reasoningRequest: number;
	activeDropdown: DropdownKind;
	filteredItems: DropdownItem[];
	allProviders: ProviderReference[];
	allModels: ModelReference[];
	allCreativities: CreativityReference[];
	allSystemPrompts: SystemPromptReference[];
	selectedIndex: number;
	badgeHighlight: boolean;
	selectedSystemPromptValue?: string;
	historyIndex: number;
	draftBeforeHistory: string;
	initializedContent: boolean;
	selectedFiles: string[];
	textContent: string;
	cursorPosition: number;
	mentionStartIndex: number;
	commandStartIndex: number;
	textTokens: TextToken[];
	providerName: string;
	modelName: string;
	creativityBadge: string;
	selectedSystemPromptName: string;
}

export function createActionPaletteState(
	value: string,
	providerLabel: string,
	providerDetails?: ProviderLabelParts,
): ActionPaletteState {
	const { providerName, modelName, creativityBadge } =
		providerDetails ?? getProviderLabelParts(providerLabel);

	return {
		reasoningLabel: "",
		reasoningRequest: 0,
		activeDropdown: "none",
		filteredItems: [],
		allProviders: [],
		allModels: [],
		allCreativities: [],
		allSystemPrompts: [],
		selectedIndex: -1,
		badgeHighlight: false,
		selectedSystemPromptValue: undefined,
		historyIndex: getPromptHistoryLength(),
		draftBeforeHistory: value,
		initializedContent: false,
		selectedFiles: [],
		textContent: "",
		cursorPosition: 0,
		mentionStartIndex: -1,
		commandStartIndex: -1,
		textTokens: [],
		providerName,
		modelName,
		creativityBadge,
		selectedSystemPromptName: "",
	};
}
