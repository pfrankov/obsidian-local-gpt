import { requestUrl } from "obsidian";
import {
	AIProvider,
	OllamaProvider,
	AIProviderProcessingOptions,
} from "../interfaces";
import { streamer } from "../streamer";

export interface OllamaRequestBody {
	prompt: string;
	model: string;
	options?: {
		temperature: number;
	};
	system?: string;
	stream?: boolean;
	images?: string[];
}

export class OllamaAIProvider implements AIProvider {
	constructor({ defaultModel, ollamaUrl, onUpdate, abortController }: any) {
		this.defaultModel = defaultModel;
		this.ollamaUrl = ollamaUrl;
		this.onUpdate = onUpdate;
		this.abortController = abortController;
	}
	defaultModel: string;
	ollamaUrl: string;
	onUpdate: (text: string) => void;
	abortController: AbortController;

	process({
		text = "",
		action,
		options,
		images = [],
	}: AIProviderProcessingOptions) {
		const requestBody: OllamaRequestBody = {
			prompt: [action.prompt, text].filter(Boolean).join("\n\n"),
			model: action.model || this.defaultModel,
			options: {
				temperature: options.temperature,
			},
			stream: true,
		};

		if (action.system) {
			requestBody.system = action.system;
		}
		if (images.length) {
			requestBody.images = images;
		}

		const { abortController } = this;
		const url = `${this.ollamaUrl.replace(/\/+$/i, "")}/api/generate`;

		return fetch(url, {
			method: "POST",
			body: JSON.stringify(requestBody),
			signal: abortController.signal,
		})
			.then((response) => {
				let combined = "";
				return streamer({
					response,
					abortController,
					onNext: (data: string) => {
						const lines = data
							.split("\n")
							.filter((line: string) => line.trim() !== "");
						for (const line of lines) {
							const message = line;
							try {
								const parsed = JSON.parse(message);
								combined += parsed.response || "";
							} catch (error) {
								console.error(
									"Could not JSON parse stream message",
									message,
									error,
								);
							}
						}
						this.onUpdate(combined);
					},
					onDone: () => {
						return combined;
					},
				});
			})
			.catch((error) => {
				if (abortController.signal.aborted) {
					return Promise.reject(error);
				}
				// Fallback to default requestUrl without any CORS restrictions
				return requestUrl({
					url,
					method: "POST",
					body: JSON.stringify({
						...requestBody,
						stream: false,
					}),
				}).then(({ json }) => {
					return json.response;
				});
			});
	}

	static async getModels(providerConfig: OllamaProvider) {
		const { json } = await requestUrl({
			url: `${providerConfig.ollamaUrl}/api/tags`,
		});

		if (!json.models || json.models.length === 0) {
			return Promise.reject();
		}
		return json.models.reduce((acc: any, el: any) => {
			const name = el.name.replace(":latest", "");
			acc[name] = name;
			return acc;
		}, {});
	}
}
