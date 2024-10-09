import { requestUrl } from "obsidian";
import { RequestHandler } from "../request-handler";
import {
	AIProvider,
	OllamaProvider,
	AIProviderProcessingOptions,
} from "../interfaces";
import { preparePrompt } from "../utils";
import { logger } from "../logger";

const SYMBOLS_PER_TOKEN = 2.5;
const EMBEDDING_CONTEXT_LENGTH_LIMIT = 2048;
const MODEL_INFO_CACHE = new Map<string, any>();

export interface OllamaRequestBody {
	prompt: string;
	model: string;
	options?: {
		temperature: number;
		num_ctx?: number;
	};
	system?: string;
	stream?: boolean;
	images?: string[];
}

export class OllamaAIProvider implements AIProvider {
	constructor(config: {
		defaultModel: string;
		ollamaUrl: string;
		embeddingModel: string;
		onUpdate: (text: string) => void;
		abortController: AbortController;
	}) {
		this.defaultModel = config.defaultModel;
		this.ollamaUrl = config.ollamaUrl;
		this.embeddingModel = config.embeddingModel;
		this.onUpdate = config.onUpdate;
		this.abortController = config.abortController;
	}
	defaultModel: string;
	ollamaUrl: string;
	embeddingModel: string;
	onUpdate: (text: string) => void;
	abortController: AbortController;

	async process({
		text = "",
		action,
		options,
		images = [],
		context = "",
	}: AIProviderProcessingOptions): Promise<string> {
		const prompt = preparePrompt(action.prompt, text, context);
		logger.debug("Querying prompt", prompt);
		const requestBody: OllamaRequestBody = {
			prompt,
			model: action.model || this.defaultModel,
			options: { temperature: options.temperature },
			stream: true,
		};

		if (action.system) requestBody.system = action.system;
		if (images.length) requestBody.images = images;

		// Reducing model reloads by using the last context length plus a 20% buffer
		const { contextLength, lastContextLength } =
			await this.getCachedModelInfo(requestBody.model);

		// Tiktoken is 100 000x slower, so we use a simple approximation
		const bodyLengthInTokens = Math.ceil(
			JSON.stringify(requestBody).length / SYMBOLS_PER_TOKEN,
		);
		logger.table("Context length", {
			model: requestBody.model,
			contextLength,
			lastContextLength,
			bodyLengthInTokens,
		});

		if (
			contextLength > 0 &&
			requestBody.options &&
			bodyLengthInTokens > lastContextLength
		) {
			requestBody.options.num_ctx = Math.min(
				contextLength,
				bodyLengthInTokens * 1.2,
			); // 20% buffer
			this.setModelInfoLastContextLength(
				requestBody.model,
				requestBody.options.num_ctx,
			);
		}
		const url = `${this.ollamaUrl.replace(/\/+$/i, "")}/api/generate`;

		return new Promise<string>((resolve, reject) => {
			if (this.abortController.signal.aborted) {
				return reject();
			}

			let combined = "";
			const requestHandler = RequestHandler.getInstance();

			requestHandler.makeRequest(
				{
					method: "POST",
					url: url,
					headers: { "Content-Type": "application/json" },
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
							.filter((line) => line.trim() !== "");
						for (const line of lines) {
							try {
								const parsed = JSON.parse(line);
								combined += parsed.response || "";
								this.onUpdate(combined);
							} catch (error) {
								console.error(
									"Could not JSON parse stream message",
									line,
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
							.then(({ json }) => resolve(json.response))
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
	setModelInfoLastContextLength(model: string, num_ctx: number) {
		const modelInfo = MODEL_INFO_CACHE.get(model);
		if (modelInfo) {
			modelInfo.lastContextLength = num_ctx;
			MODEL_INFO_CACHE.set(model, modelInfo);
		}
		return modelInfo;
	}

	async getEmbeddings(
		texts: string[],
		updateProgress: (progress: number) => void,
	): Promise<number[][]> {
		logger.info("Getting embeddings for texts");
		const groupedTexts: string[][] = [];
		let currentGroup: string[] = [];
		let currentLength = 0;
		// Reducing model reloads by using the last context length plus a 20% buffer
		const { contextLength, lastContextLength } =
			await this.getCachedModelInfo(this.embeddingModel);

		let embeddingContextLength = Math.min(
			contextLength,
			EMBEDDING_CONTEXT_LENGTH_LIMIT,
		);

		// If the longest text is shorter than the last context length, use the last context length
		const maxTextLength = Math.max(...texts.map((text) => text.length));
		const maxTextLengthInTokens = Math.ceil(
			maxTextLength / SYMBOLS_PER_TOKEN,
		);
		if (maxTextLengthInTokens < lastContextLength) {
			embeddingContextLength = lastContextLength;
		} else if (maxTextLengthInTokens > embeddingContextLength) {
			embeddingContextLength = Math.min(
				contextLength,
				maxTextLengthInTokens * 1.2,
			); // 20% buffer
			this.setModelInfoLastContextLength(
				this.embeddingModel,
				embeddingContextLength,
			);
		}

		// Debugging sequential embedding
		// embeddingContextLength = 1;

		logger.time("Tokenizing texts");
		for (const text of texts) {
			// Tiktoken is 100 000x slower, so we use a simple approximation
			const textLengthInTokens = Math.ceil(
				text.length / SYMBOLS_PER_TOKEN,
			);
			logger.table("Text length in tokens", {
				text,
				textLength: text.length,
				textLengthInTokens,
			});

			if (currentLength + textLengthInTokens > embeddingContextLength) {
				groupedTexts.push(currentGroup);
				currentGroup = [];
				currentLength = 0;
			}
			currentGroup.push(text);
			currentLength += textLengthInTokens;
		}
		if (currentGroup.length > 0) {
			groupedTexts.push(currentGroup);
		}

		logger.timeEnd("Tokenizing texts");
		const allEmbeddings: number[][] = [];

		for (const group of groupedTexts) {
			if (this.abortController.signal.aborted) {
				return allEmbeddings;
			}
			const body = {
				input: group,
				model: this.embeddingModel,
				options: {},
			};

			// Default value for any model in Ollama is 2048
			if (embeddingContextLength > EMBEDDING_CONTEXT_LENGTH_LIMIT) {
				(body.options as any).num_ctx = embeddingContextLength;
			}
			logger.table("Ollama embeddings request", group);
			const { json } = await requestUrl({
				url: `${this.ollamaUrl.replace(/\/+$/i, "")}/api/embed`,
				method: "POST",
				body: JSON.stringify(body),
			});
			logger.debug("Ollama embeddings for group", {
				embeddings: json.embeddings,
			});
			allEmbeddings.push(...json.embeddings);
			updateProgress(json.embeddings.length);
		}

		return allEmbeddings;
	}

	async getCachedModelInfo(modelName: string) {
		if (MODEL_INFO_CACHE.has(modelName)) {
			return MODEL_INFO_CACHE.get(modelName);
		}
		const { json } = await requestUrl({
			url: `${this.ollamaUrl.replace(/\/+$/i, "")}/api/show`,
			method: "POST",
			body: JSON.stringify({ model: modelName }),
		});

		const modelInfo = {
			contextLength: 0,
			lastContextLength: 2048,
		};

		const contextLengthKey = Object.keys(json.model_info).find((key) =>
			key.endsWith(".context_length"),
		);
		if (!contextLengthKey) {
			return modelInfo;
		}
		modelInfo.contextLength = json.model_info[contextLengthKey];
		MODEL_INFO_CACHE.set(modelName, modelInfo);

		return modelInfo;
	}

	static async getModels(
		providerConfig: OllamaProvider,
	): Promise<Record<string, string>> {
		logger.debug("Fetching Ollama models");
		const { json } = await requestUrl({
			url: `${providerConfig.ollamaUrl.replace(/\/+$/i, "")}/api/tags`,
		});

		if (!json.models || json.models.length === 0) {
			logger.warn("No Ollama models found");
			return Promise.reject("No models found");
		}
		return json.models.reduce(
			(acc: Record<string, string>, el: { name: string }) => {
				const name = el.name.replace(":latest", "");
				acc[name] = name;
				return acc;
			},
			{},
		);
	}
}
