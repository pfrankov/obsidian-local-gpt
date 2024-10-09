import { Embeddings } from "langchain/embeddings/base";
import { AIProvider } from "interfaces";
import { logger } from "../logger";

export class CustomEmbeddings extends Embeddings {
	caller: any;

	constructor(
		private config: {
			aiProvider: AIProvider;
			updateCompletedSteps: (steps: number) => void;
		},
	) {
		super({});
		this.caller = undefined;
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		logger.debug("Embedding documents", texts);
		return await this.config.aiProvider.getEmbeddings(
			texts,
			this.config.updateCompletedSteps,
		);
	}

	async embedQuery(text: string): Promise<number[]> {
		logger.debug("Embedding query", text);
		const [embedding] = await this.embedDocuments([text]);
		return embedding;
	}
}
