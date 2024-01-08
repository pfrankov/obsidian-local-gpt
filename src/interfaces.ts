export const enum Providers {
	OLLAMA = "ollama",
	OPENAI_COMPATIBLE = "openaiCompatible",
	OLLAMA_FALLBACK = "ollama_fallback",
	OPENAI_COMPATIBLE_FALLBACK = "openaiCompatible_fallback",
}

export type ProviderType = keyof typeof Providers;

export type OllamaProvider = {
	ollamaUrl: string;
	defaultModel: string;
	type: "ollama";
};

export type OpenAICompatibleProvider = {
	url: string;
	apiKey?: string;
	defaultModel?: string;
	type: "openaiCompatible";
};

export type Provider = OllamaProvider | OpenAICompatibleProvider;

export type ProvidersConfig = {
	[key: string]: Provider;
};

export interface LocalGPTSettings {
	defaultProvider: string;
	fallbackProvider: string;
	providers: ProvidersConfig;
	actions: LocalGPTAction[];
	_version: number;
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
