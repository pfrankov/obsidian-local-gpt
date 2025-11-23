export interface LocalGPTSettings {
	aiProviders: {
		main: string | null;
		embedding: string | null;
		vision: string | null;
	};
	defaults: {
		creativity: string;
		/**
		 * Preset that controls the overall limit for context chunks in Enhanced Actions (RAG).
		 * Values: 'local' | 'cloud' | 'advanced' | 'max'
		 */
		contextLimit?: string;
	};
	actions: LocalGPTAction[];
	_version: number;
}

export interface LocalGPTAction {
	name: string;
	prompt: string;
	temperature?: number;
	system?: string;
	replace?: boolean;
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
