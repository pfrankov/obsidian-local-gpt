import {
	AIProvider,
	OpenAICompatibleProvider,
	AIProviderProcessingOptions,
} from "../interfaces";
import { streamer } from "../streamer";
import { requestUrl } from "obsidian";

export interface OpenAICompatibleMessageContent {
	type: "text" | "image_url";
	text?: string;
	image_url?: {
		url: string;
	};
}

export interface OpenAICompatibleMessage {
	role: "system" | "user";
	content: string | OpenAICompatibleMessageContent[];
}
export interface OpenAICompatibleRequestBody {
	messages: OpenAICompatibleMessage[];
	stream: boolean;
	model: string;
	temperature: number;
}

export class OpenAICompatibleAIProvider implements AIProvider {
	constructor({ url, apiKey, defaultModel, abortController, onUpdate }: any) {
		this.url = url;
		this.apiKey = apiKey;
		this.defaultModel = defaultModel;
		this.abortController = abortController;
		this.onUpdate = onUpdate;
	}
	url: string;
	apiKey: string;
	defaultModel: string;
	onUpdate: (text: string) => void;
	abortController: AbortController;

	process({
		text = "",
		action,
		options,
		images = [],
	}: AIProviderProcessingOptions): Promise<string> {
		const messages = [
			(action.system && {
				role: "system",
				content: action.system,
			}) as OpenAICompatibleMessage,
			!images.length && {
				role: "user",
				content: [action.prompt, text].filter(Boolean).join("\n\n"),
			},
			images.length && {
				role: "user",
				content: [
					{
						type: "text",
						text: [action.prompt, text]
							.filter(Boolean)
							.join("\n\n"),
					},
					...images.map((image) => ({
						type: "image_url",
						image_url: {
							url: `data:image/jpeg;base64,${image}`,
						},
					})),
				],
			},
		].filter(Boolean) as OpenAICompatibleMessage[];

		const requestBody: OpenAICompatibleRequestBody = {
			stream: true,
			model: action.model || this.defaultModel,
			temperature: options.temperature,
			messages,
		};

		const { abortController } = this;

		return fetch(`${this.url.replace(/\/+$/i, "")}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.apiKey && {
					Authorization: `Bearer ${this.apiKey}`,
				}),
			},
			body: JSON.stringify(requestBody),
			signal: abortController.signal,
		}).then((response) => {
			let combined = "";

			return new Promise((resolve, reject) => {
				streamer({
					response,
					abortController,
					onNext: (data: string) => {
						const lines = data
							.split("\n")
							.filter((line: string) => line.trim() !== "");
						for (const line of lines) {
							const message = line.replace(/^data: /, "");
							if (message === "[DONE]") {
								break;
							}
							try {
								const parsed = JSON.parse(message);
								combined +=
									parsed.choices[0]?.delta?.content || "";
							} catch (error) {
								try {
									reject(JSON.parse(data).error);
								} catch (e) {
									reject(
										"Could not JSON parse stream message",
									);
									console.error(
										"Could not JSON parse stream message",
										message,
										error,
									);
								}
							}
						}
						this.onUpdate(combined);
					},
					onDone: () => {
						resolve(combined);
						return combined;
					},
				});
			});
		});
	}

	static async getModels(providerConfig: OpenAICompatibleProvider) {
		const { json } = await requestUrl({
			url: `${providerConfig.url.replace(/\/+$/i, "")}/v1/models`,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${providerConfig.apiKey}`,
			},
		});

		if (!json.data || json.data.length === 0) {
			return Promise.reject();
		}
		return json.data.reduce((acc: any, el: any) => {
			const name = el.id;
			acc[name] = name;
			return acc;
		}, {});
	}
}
