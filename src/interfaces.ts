export const enum Providers {
	OLLAMA = "ollama",
	OPENAI_COMPATIBLE = "openaiCompatible",
	OLLAMA_FALLBACK = "ollama_fallback",
	OPENAI_COMPATIBLE_FALLBACK = "openaiCompatible_fallback",
}

export type OllamaProvider = {
	url: string;
	defaultModel: string;
	embeddingModel: string;
	type: "ollama";
};

export type OpenAICompatibleProvider = {
	url: string;
	apiKey?: string;
	defaultModel?: string;
	embeddingModel?: string;
	type: "openaiCompatible";
};

export type Provider = OllamaProvider | OpenAICompatibleProvider;

export type ProvidersConfig = {
	[key: string]: Provider;
};

export interface LocalGPTSettings {
	defaults: {
		provider: string;
		fallbackProvider: string;
		creativity: string;
	};
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

export type AIProviderProcessingOptions = {
	text: string;
	context: string;
	action: LocalGPTAction;
	images: string[];
	options: {
		temperature: number;
	};
};

export interface AIProvider {
	abortController?: AbortController;
	getEmbeddings(
		texts: string[],
		updateProgress: (progress: number) => void,
	): Promise<number[][]>;
	process(arg: AIProviderProcessingOptions): Promise<string>;
}
