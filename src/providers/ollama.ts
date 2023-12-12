import { requestUrl } from "obsidian";
import { LocalGPTAction, AIProvider } from "../interfaces";

export interface OllamaRequestBody {
	prompt: string;
	model: string;
	options?: {
		temperature: number;
	};
	system?: string;
	stream?: boolean;
}

export class OllamaAIProvider implements AIProvider {
	constructor({ defaultModel, ollamaUrl }: any) {
		this.defaultModel = defaultModel;
		this.ollamaUrl = ollamaUrl;
	}
	defaultModel: string;
	ollamaUrl: string;

	process(text: string, action: LocalGPTAction) {
		const requestBody: OllamaRequestBody = {
			prompt: action.prompt + "\n\n" + text,
			model: action.model || this.defaultModel,
			options: {
				temperature: action.temperature || 0.2,
			},
			stream: false,
		};

		if (action.system) {
			requestBody.system = action.system;
		}

		return requestUrl({
			method: "POST",
			url: `${this.ollamaUrl}/api/generate`,
			body: JSON.stringify(requestBody),
		}).then(({ json }) => {
			return json.response;
		});
	}
}
