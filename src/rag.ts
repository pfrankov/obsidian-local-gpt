import { TFile, Vault, MetadataCache } from "obsidian";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { preprocessContent, splitContent } from "./text-processing";
import { AIProvider } from "interfaces";
import LocalGPT from "main";
import { CustomEmbeddings } from "./embeddings/CustomEmbeddings";
import { logger } from "./logger";
import { extractTextFromPDF } from "./processors/pdf";
import { fileCache } from "./indexedDB";

const MAX_DEPTH = 10;

export interface ProcessingContext {
	vault: Vault;
	metadataCache: MetadataCache;
	currentDocumentPath: string;
	activeFile: TFile;
}

export async function startProcessing(
	linkedFiles: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	activeFile: TFile,
): Promise<Map<string, Document>> {
	logger.info("Starting RAG processing");
	const processedDocs = new Map<string, Document>();

	await Promise.all(
		linkedFiles.map(async (file) => {
			const context: ProcessingContext = {
				vault,
				metadataCache,
				currentDocumentPath: file.path,
				activeFile,
			};
			await processDocumentForRAG(file, context, processedDocs, 0, false);
		}),
	);

	return processedDocs;
}

export async function getFileContent(
	file: TFile,
	vault: Vault,
): Promise<string> {
	switch (file.extension) {
		case "pdf": {
			const cachedContent = await fileCache.getContent(file.path);
			if (cachedContent && cachedContent.mtime === file.stat.mtime) {
				return cachedContent.content;
			}
			const arrayBuffer = await vault.readBinary(file);
			const pdfContent = await extractTextFromPDF(arrayBuffer);
			await fileCache.setContent(file.path, {
				mtime: file.stat.mtime,
				content: pdfContent,
			});
			return pdfContent;
		}
		case "md":
		default:
			return await vault.cachedRead(file);
	}
}

export async function processDocumentForRAG(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, Document>,
	depth: number,
	isBacklink: boolean,
): Promise<Map<string, Document>> {
	logger.table("Processing document for RAG", {
		filePath: file.path,
		depth,
		isBacklink,
	});
	if (
		depth > MAX_DEPTH ||
		processedDocs.has(file.path) ||
		file.path === context.activeFile.path
	) {
		return processedDocs;
	}

	try {
		const content = await getFileContent(file, context.vault);

		const newDoc = new Document({
			pageContent: content,
			metadata: {
				source: file.path,
				basename: file.basename,
				stat: file.stat,
				depth,
				isBacklink,
			},
		});
		processedDocs.set(file.path, newDoc);

		const isMdFile = file.extension === "md";

		if (isMdFile && !isBacklink) {
			const linkedFiles = getLinkedFiles(
				content,
				context.vault,
				context.metadataCache,
				file.path,
			);
			for (const linkedFile of linkedFiles) {
				processedDocs = await processDocumentForRAG(
					linkedFile,
					context,
					processedDocs,
					depth + 1,
					false,
				);
			}

			const backlinkFiles = getBacklinkFiles(
				file,
				context,
				processedDocs,
			);
			for (const backlinkFile of backlinkFiles) {
				processedDocs = await processDocumentForRAG(
					backlinkFile,
					context,
					processedDocs,
					depth,
					true,
				);
			}
		}
	} catch (error) {
		console.error(`Error processing document ${file.path}:`, error);
	}

	return processedDocs;
}

export function getLinkedFiles(
	content: string,
	vault: Vault,
	metadataCache: MetadataCache,
	currentFilePath: string,
): TFile[] {
	const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	const matches = content.matchAll(linkRegex);

	return Array.from(matches, (match) => match[1])
		.map((linkText) => {
			const linkPath = metadataCache.getFirstLinkpathDest(
				linkText,
				currentFilePath,
			);
			return linkPath ? vault.getAbstractFileByPath(linkPath.path) : null;
		})
		.filter(
			(file): file is TFile =>
				file instanceof TFile &&
				(file.extension === "md" || file.extension === "pdf"),
		);
}

export function getBacklinkFiles(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, Document>,
): TFile[] {
	const resolvedLinks = context.metadataCache.resolvedLinks;
	const backlinkPaths = Object.entries(resolvedLinks)
		.filter(
			([sourcePath, links]) =>
				links[file.path] && !processedDocs.has(sourcePath),
		)
		.map(([sourcePath]) => sourcePath);

	return backlinkPaths
		.map((path) => context.vault.getAbstractFileByPath(path))
		.filter(
			(backlinkFile): backlinkFile is TFile =>
				backlinkFile instanceof TFile &&
				backlinkFile.extension === "md",
		);
}

export async function createVectorStore(
	documents: Document[],
	plugin: LocalGPT,
	currentDocumentPath: string,
	aiProvider: AIProvider,
	aiProviders: any,
	abortController: AbortController,
	addTotalProgressSteps: (steps: number) => void,
	updateCompletedSteps: (steps: number) => void,
): Promise<MemoryVectorStore> {
	const embedder: CustomEmbeddings = new CustomEmbeddings({
		abortController,
		aiProvider,
		aiProviders,
		updateCompletedSteps,
	});

	const vectorStore = new MemoryVectorStore(embedder);
	const chunksToEmbed: { chunk: string; doc: Document }[] = [];

	
	// Process all documents except the current one
	for (const doc of documents) {
		if (doc.metadata.source !== currentDocumentPath) {
			const content = preprocessContent(doc.pageContent);
			const chunks = splitContent(content);
			for (const chunk of chunks) {
				logger.table("Chunk", chunk, chunk.length);
				const chunkDoc = new Document({
					pageContent: chunk,
					metadata: { ...doc.metadata },
				});

				chunksToEmbed.push({ chunk, doc: chunkDoc });
			}
		}
	}

	if (chunksToEmbed.length > 0) {
		try {
			addTotalProgressSteps(chunksToEmbed.length + 1); // +1 for query embedding
			const embeddings = await embedder.embedDocuments(
				chunksToEmbed.map((item) => item.chunk),
			);

			logger.debug(
				`Chunks to embed: ${chunksToEmbed.length}, Embeddings received: ${embeddings.length}`,
			);

			if (embeddings.length !== chunksToEmbed.length) {
				logger.error("Mismatch between chunks and embeddings length");
				throw new Error(
					"Embedding process returned incorrect number of results",
				);
			}

			// Add embeddings to vector store
			for (let i = 0; i < embeddings.length; i++) {
				if (!chunksToEmbed[i]) {
					logger.error(`Missing chunk at index ${i}`);
					continue;
				}

				const embedding = embeddings[i];
				const { doc } = chunksToEmbed[i];
				await vectorStore.addVectors([embedding], [doc]);
			}
		} catch (error) {
			if (!abortController?.signal.aborted) {
				console.error(`Error creating embeddings:`, error);
			}
			throw error;
		}
	}

	return vectorStore;
}

export async function queryVectorStore(
	query: string,
	vectorStore: MemoryVectorStore,
): Promise<string> {
	logger.debug("Querying vector store", query);
	const MAX_SEARCH_RESULTS = 10;
	const HIGH_SCORE_THRESHOLD = 0.51;
	const MAX_LOW_SCORE_RESULTS = 5;
	const MAX_CONTEXT_LENGTH = 10000;

	logger.time("Querying vector store timer");
	const results = await vectorStore.similaritySearchWithScore(
		query,
		MAX_SEARCH_RESULTS,
	);
	logger.timeEnd("Querying vector store timer");

	let totalLength = 0;
	const groupedResults = results.reduce(
		(acc, [doc, score]) => {
			const basename = doc.metadata.basename || "Unknown";
			if (!acc[basename]) {
				acc[basename] = {
					highScore: [],
					lowScore: [],
					createdTime: getCreatedTime(doc),
				};
			}

			const content = doc.pageContent;
			if (totalLength + content.length <= MAX_CONTEXT_LENGTH) {
				if (score >= HIGH_SCORE_THRESHOLD) {
					acc[basename].highScore.push(content);
				} else {
					acc[basename].lowScore.push(content);
				}
				totalLength += content.length;
			}

			return acc;
		},
		{} as Record<
			string,
			{ highScore: string[]; lowScore: string[]; createdTime: number }
		>,
	);

	let totalLowScoreCount = 0;
	const finalResults = Object.entries(groupedResults)
		.sort(([, a], [, b]) => b.createdTime - a.createdTime) // Sort by creation time, newest first
		.map(([basename, { highScore, lowScore }]) => {
			const highScoreContent = highScore.join("\n\n");
			let lowScoreContent = "";

			if (totalLowScoreCount < MAX_LOW_SCORE_RESULTS) {
				const remainingSlots =
					MAX_LOW_SCORE_RESULTS - totalLowScoreCount;
				const lowScoreToInclude = lowScore.slice(0, remainingSlots);
				lowScoreContent = lowScoreToInclude.join("\n\n");
				totalLowScoreCount += lowScoreToInclude.length;
			}

			const content = [highScoreContent, lowScoreContent]
				.filter(Boolean)
				.join("\n\n");
			return `[[${basename}]]\n${content}`;
		});

	return finalResults.join("\n\n").trim();
}

export async function clearContentCache() {
	await fileCache.clearContent();
}

export async function clearAllCache() {
	await fileCache.clearAll();
}

export function getCreatedTime(doc: Document): number {
	const frontmatterMatch = doc.pageContent.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1];
		const createdMatch = frontmatter.match(
			/created:\s*(\d{4}-\d{2}-\d{2})/,
		);
		if (createdMatch) {
			return new Date(createdMatch[1]).getTime();
		}
	}

	return doc.metadata.stat.ctime;
}
