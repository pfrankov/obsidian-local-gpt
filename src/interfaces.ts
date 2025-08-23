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
