export interface LocalGPTSettings {
	selectedProvider: string;
	providers: OllamaProviderInSettings;
	actions: LocalGPTAction[];
	_version: number;
}

export interface OllamaProviderInSettings {
	ollama: {
		ollamaUrl: string;
		defaultModel: string;
	};
}

export const enum Providers {
	OLLAMA = "ollama",
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
	process(text: string, action: LocalGPTAction): Promise<string>;
}
