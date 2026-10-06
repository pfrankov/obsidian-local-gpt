export type ReasoningEffort = string;

export interface ReasoningSelection {
	mode: string;
	providerId: string;
	model?: string;
}

export interface ReasoningPaletteSnapshot {
	providerId: string;
	model?: string;
	modes: string[];
	effectiveMode?: string;
}

export interface LocalGPTSettings {
	aiProviders: {
		main: string | null;
		embedding: string | null;
		vision: string | null;
	};
	/** LocalGPT-only defaults, keyed by AI Providers provider ID. */
	providerReasoningEffort?: Record<string, ReasoningEffort>;
	actionPalette?: {
		systemPromptActionId?: string | null;
	};
	defaults: {
		/**
		 * Legacy creativity preset: "", "low", "medium", "high".
		 * Never store "default" here — use omitTemperature for API default so old Local GPT can read this field.
		 */
		creativity?: string;
		/**
		 * When true, omit temperature (API default). Old Local GPT ignores this field and uses `creativity`.
		 */
		omitTemperature?: boolean;
		/**
		 * Preset that controls the overall limit for context chunks in Enhanced Actions (RAG).
		 * Values: 'local' | 'cloud' | 'advanced' | 'max'
		 */
		contextLimit?: string;
	};
	actions: LocalGPTAction[];
	_version: number;
}

export interface CommunityActionRef {
	id: string;
	language: string;
	name: string;
	hash: string;
	updatedAt?: string;
	description?: string;
}

export interface LocalGPTAction {
	id?: string;
	name: string;
	prompt: string;
	/** Missing inherits configured Creativity; null explicitly uses API default. */
	temperature?: number | null;
	/** Missing inherits the provider setting; default omits the API parameter. */
	reasoningEffort?: ReasoningEffort | "default";
	system?: string;
	replace?: boolean;
	separator?: boolean;
	community?: CommunityActionRef;
}

export type {
	IAIDocument,
	IAIProvidersRetrievalResult,
} from "@obsidian-ai-providers/sdk";

export interface FileReference {
	path: string;
	basename: string;
	extension: string;
}

export interface CommandReference {
	name: string;
	description: string;
}

export interface ProviderReference {
	id: string;
	name: string;
	providerName: string;
	providerUrl?: string;
}

export interface ModelReference {
	id: string;
	name: string;
}

export interface CreativityReference {
	id: string; // "", "low", "medium", "high"
	name: string; // localized label from settings.creativity*
}

export interface SystemPromptReference {
	id: string;
	name: string;
	system: string;
}

export interface TextToken {
	type: "text" | "file" | "command";
	content: string;
	start: number;
	end: number;
	filePath?: string;
	commandName?: string;
}

export interface ActionPaletteSubmitEvent {
	reasoningSelection?: ReasoningSelection;
	text: string;
	selectedFiles: string[];
	systemPrompt?: string;
}

export type GetFilesCallback = () => FileReference[];
export type GetProvidersCallback = () => Promise<ProviderReference[]>;
export type OnProviderChangeCallback = (providerId: string) => Promise<void>;
export type GetModelsCallback = (
	providerId: string,
) => Promise<ModelReference[]>;
export type OnModelChangeCallback = (model: string) => Promise<void>;
export type OnCreativityChangeCallback = (
	creativityKey: string,
) => Promise<void> | void;
export type GetSystemPromptsCallback = () => SystemPromptReference[];
