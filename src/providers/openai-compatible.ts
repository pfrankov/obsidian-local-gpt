import {
	AIProvider,
	OpenAICompatibleProvider,
	AIProviderProcessingOptions,
} from "../interfaces";
import { requestUrl } from "obsidian";
import { preparePrompt } from "../utils";
import { RequestHandler } from "../request-handler";
import { logger } from "../logger";

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
	constructor(config: {
		url: string;
		apiKey: string | undefined;
		defaultModel: string | undefined;
		abortController: AbortController;
		embeddingModel: string | undefined;
		onUpdate: (text: string) => void;
	}) {
		this.url = config.url;
		this.apiKey = config.apiKey || "";
		this.defaultModel = config.defaultModel || "";
		this.abortController = config.abortController;
		this.onUpdate = config.onUpdate;
		this.embeddingModel = config.embeddingModel || "";
	}
	url: string;
	apiKey: string;
	defaultModel: string;
	onUpdate: (text: string) => void;
	abortController: AbortController;
	embeddingModel: string;

	async process({
		text = "",
		action,
		options,
		images = [],
		context = "",
	}: AIProviderProcessingOptions): Promise<string> {
		logger.debug("Processing request with OpenAI Compatible provider", {
			model: action.model || this.defaultModel,
		});
		const prompt = preparePrompt(action.prompt, text, context);
		logger.debug("Prepared prompt", prompt);

		const messages = [
			(action.system && {
				role: "system",
				content: action.system,
			}) as OpenAICompatibleMessage,
			!images.length && {
				role: "user",
				content: prompt,
			},
			images.length && {
				role: "user",
				content: [
					{
						type: "text",
						text: prompt,
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

		const url = `${this.url.replace(/\/+$/i, "")}/v1/chat/completions`;

		return new Promise<string>((resolve, reject) => {
			if (this.abortController.signal.aborted) {
				return reject();
			}

			let combined = "";
			const requestHandler = RequestHandler.getInstance();

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (this.apiKey) {
				headers["Authorization"] = `Bearer ${this.apiKey}`;
			}

			requestHandler.makeRequest(
				{
					method: "POST",
					url: url,
					headers: headers,
					body: JSON.stringify(requestBody),
					abortController: this.abortController,
				},
				{
					onData: (chunk: string) => {
						if (this.abortController.signal.aborted) {
							return reject();
						}

						const lines = chunk
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
								this.onUpdate(combined);
							} catch (error) {
								console.error(
									"Could not JSON parse stream message",
									message,
									error,
								);
							}
						}
					},
					onError: (error: Error) => {
						if (this.abortController.signal.aborted) {
							return reject();
						}
						// Fallback to default requestUrl without any CORS restrictions
						requestUrl({
							url,
							method: "POST",
							body: JSON.stringify({
								...requestBody,
								stream: false,
							}),
						})
							.then(({ json }) =>
								resolve(json.choices[0].message.content),
							)
							.catch(reject);
					},
					onEnd: () => {
						this.abortController.signal.aborted
							? reject()
							: resolve(combined);
					},
				},
			);

			this.abortController.signal.addEventListener("abort", () => {
				reject();
			});
		});
	}

	async getEmbeddings(texts: string[]): Promise<number[][]> {
		logger.debug("Getting embeddings for texts", { count: texts.length });
		const results: number[][] = [];

		for (const text of texts) {
			if (this.abortController.signal.aborted) {
				return results;
			}

			try {
				const { json } = await requestUrl({
					url: `${this.url.replace(/\/+$/i, "")}/v1/embeddings`,
					method: "POST",
					body: JSON.stringify({
						input: [text],
						model: this.embeddingModel,
					}),
				});
				logger.debug("OpenAI compatible embeddings", {
					embedding: json.data[0].embedding,
				});
				results.push(json.data[0].embedding);
			} catch (error) {
				console.error("Error getting embedding:", { error });
				throw error;
			}
		}

		logger.debug("OpenAI compatible embeddings results", results);
		return results;
	}

	static async getModels(
		providerConfig: OpenAICompatibleProvider,
	): Promise<Record<string, string>> {
		logger.debug("Fetching OpenAI Compatible models");
		const { json } = await requestUrl({
			url: `${providerConfig.url.replace(/\/+$/i, "")}/v1/models`,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${providerConfig.apiKey}`,
			},
		});

		if (!json.data || json.data.length === 0) {
			logger.warn("No OpenAI Compatible models found");
			return Promise.reject("No models found");
		}
		return json.data.reduce(
			(acc: Record<string, string>, el: { id: string }) => {
				const name = el.id;
				acc[name] = name;
				return acc;
			},
			{},
		);
	}
}
