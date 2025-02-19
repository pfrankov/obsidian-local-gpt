import { Embeddings } from "@langchain/core/embeddings";
import { AIProvider } from "interfaces";
import { logger } from "../logger";

export class CustomEmbeddings extends Embeddings {
	caller: any;

	constructor(
		private config: {
			aiProvider: AIProvider;
			aiProviders: any;
			abortController: AbortController;
			updateCompletedSteps: (steps: number) => void;
		},
	) {
		super({});
		this.caller = undefined;
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		logger.debug("Embedding documents", texts);
		const embeddings = await this.config.aiProviders.embed({
			input: texts,
			provider: this.config.aiProvider,
		});
		console.log("embeddings", embeddings);

		this.config.updateCompletedSteps(texts.length);

		return embeddings;
	}

	async embedQuery(text: string): Promise<number[]> {
		logger.debug("Embedding query", text);
		const [embedding] = await this.embedDocuments([text]);

		return embedding;
	}
}
