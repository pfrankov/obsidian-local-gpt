export interface LocalGPTSettings {
	selectedProvider: string;
	providers: OllamaProviderInSettings & OpenAICompatibleProviderInSettings;
	actions: LocalGPTAction[];
	_version: number;
}

export interface OllamaProviderInSettings {
	ollama: {
		ollamaUrl: string;
		defaultModel: string;
	};
}
export interface OpenAICompatibleProviderInSettings {
	openaiCompatible: {
		url: string;
	};
}

export const enum Providers {
	OLLAMA = "ollama",
	OPENAI_COMPATIBLE = "openaiCompatible",
}

export interface LocalGPTAction {
	name: string;
	prompt: string;
	model?: string;
	temperature?: number;
	system?: string;
	replace?: boolean;
}

export interface AIProvider {
	abortController?: AbortController;
	process(text: string, action: LocalGPTAction): Promise<string>;
}
