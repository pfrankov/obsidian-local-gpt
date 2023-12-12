export interface LocalGPTSettings {
	selectedProvider: string;
	providers: OllamaProvider;
	actions: LocalGPTAction[];
	_version: number;
}

export interface OllamaProvider {
	ollama: {
		ollamaUrl: string;
		defaultModel: string;
	}
}

export interface LocalGPTAction {
	name: string;
	prompt: string;
	model?: string;
	temperature?: number;
	system?: string;
	replace?: boolean;
}

export interface OllamaRequestBody {
	prompt: string;
	model: string;
	options?: {
		temperature: number;
	}
	system?: string;
	stream?: boolean;
}
