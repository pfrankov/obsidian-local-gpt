// --- START OF FILE embeddings/CustomEmbeddings.ts ---

import { Embeddings, EmbeddingsParams } from "@langchain/core/embeddings";
import type { IAIProvider, IAIProvidersService, IAIProvidersEmbedParams } from "@obsidian-ai-providers/sdk";
import { logger } from "../logger";

export interface CustomEmbeddingsConfig extends EmbeddingsParams {
	aiProvider: IAIProvider;
	aiProvidersService: IAIProvidersService;
	abortController?: AbortController; // AbortController is still useful to prevent starting the embed
	updateCompletedSteps?: (steps: number) => void;
}

export class CustomEmbeddings extends Embeddings {
	private config: CustomEmbeddingsConfig;

	constructor(config: CustomEmbeddingsConfig) {
		super(config);
		this.config = config;
		// logger.debug("CustomEmbeddings initialized with provider:", config.aiProvider?.id);
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		// logger.debug(`Embedding ${texts.length} documents using provider ${this.config.aiProvider.id}...`);
		if (texts.length === 0) return [];

		// --- Check for abort BEFORE making the SDK call ---
		if (this.config.abortController?.signal.aborted) {
			logger.warn("EmbedDocuments aborted before calling SDK.");
			throw new Error("Operation aborted"); // Use a standard AbortError name if possible
		}

		try {
			// --- Prepare parameters WITHOUT signal/options ---
			const embedParams: IAIProvidersEmbedParams = {
				input: texts,
				provider: this.config.aiProvider,
				// 'options' and 'signal' removed as they are not part of the type
			};

			const embeddings = await this.config.aiProvidersService.embed(embedParams);

			// --- Check for abort AFTER the SDK call returns (in case it was aborted during RAG setup) ---
			if (this.config.abortController?.signal.aborted) {
				logger.warn("EmbedDocuments aborted after SDK call returned (likely aborted during RAG setup).");
				throw new Error("Operation aborted");
			}

			if (!Array.isArray(embeddings) || !embeddings.every(e => Array.isArray(e) && e.every(n => typeof n === 'number'))) {
				logger.error("Embeddings received from SDK are not number[][].", embeddings);
				throw new Error("Invalid embeddings format received.");
			}

			this.config.updateCompletedSteps?.(texts.length);
			// logger.debug(`Successfully embedded ${texts.length} documents.`);
			return embeddings;

		} catch (error) {
			// Handle potential errors from the SDK call itself
			// Re-check abort signal in case error is related to external abort signal affecting SDK internals indirectly
			if (error instanceof Error && (error.name === 'AbortError' || this.config.abortController?.signal.aborted)) {
				logger.warn("EmbedDocuments request aborted (caught error).");
				// Ensure consistent error message/type if possible
				throw new Error("Operation aborted");
			}
			logger.error(`Error embedding documents with provider ${this.config.aiProvider.id}:`, error);
			throw error; // Re-throw other errors
		}
	}

	async embedQuery(text: string): Promise<number[]> {
		// logger.debug(`Embedding query using provider ${this.config.aiProvider.id}...`);
		// Check abort before calling embedDocuments
		if (this.config.abortController?.signal.aborted) {
			logger.warn("EmbedQuery aborted before calling embedDocuments.");
			throw new Error("Operation aborted");
		}
		const embeddings = await this.embedDocuments([text]);
		if (!embeddings?.[0]) {
			logger.error("EmbedQuery failed: No embedding vector received.", { query: text.substring(0, 50) + "..." });
			throw new Error("Failed to generate embedding for the query.");
		}
		return embeddings[0];
	}
}

// --- END OF FILE embeddings/CustomEmbeddings.ts ---