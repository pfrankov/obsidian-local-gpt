export interface LocalGPTSettings {
	ollamaUrl: string;
	defaultModel: string;
	actions: LocalGPTAction[];
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
