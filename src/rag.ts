import { TFile, Vault, MetadataCache } from "obsidian";
import { Document } from "langchain/document";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { preprocessContent, splitContent } from "./text-processing";
import { AIProvider } from "interfaces";
import LocalGPT from "main";
import { CustomEmbeddings } from "./embeddings/CustomEmbeddings";
import { logger } from "./logger";
import { extractTextFromPDF } from "./processors/pdf";
import { embeddingsCache } from "./indexedDB";

const MAX_DEPTH = 10;

interface ProcessingContext {
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

async function getFileContent(file: TFile, vault: Vault): Promise<string> {
	switch (file.extension) {
		case "pdf":
			const arrayBuffer = await vault.readBinary(file);
			return await extractTextFromPDF(arrayBuffer);
		case "md":
		default:
			return await vault.cachedRead(file);
	}
}

async function processDocumentForRAG(
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
		let content = "";
		const isMdFile = file.extension === "md";

		if (isMdFile) {
			content = await getFileContent(file, context.vault);
		} else {
			const cachedData = await embeddingsCache.get(file.path);
			if (
				!cachedData?.chunks?.length ||
				cachedData.mtime !== file.stat.mtime
			) {
				content = await getFileContent(file, context.vault);
			}
		}

		// If a document is from the cache, it doesn't matter what content we use
		// It will not be embedded anyway during the `createVectorStore` function
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

function getBacklinkFiles(
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
): Promise<MemoryVectorStore> {
	const embedder: CustomEmbeddings = new CustomEmbeddings({
		aiProvider,
	});

	const vectorStore = new MemoryVectorStore(embedder);
	const chunksToEmbed: { chunk: string; doc: Document }[] = [];
	const embeddingsByDocument: {
		[key: string]: { embedding: number[]; doc: Document }[];
	} = {};

	for (const doc of documents) {
		if (doc.metadata.source !== currentDocumentPath) {
			const cachedData = await embeddingsCache.get(doc.metadata.source);
			embeddingsByDocument[doc.metadata.source] =
				embeddingsByDocument[doc.metadata.source] || [];

			if (cachedData?.chunks?.length) {
				if (cachedData.mtime === doc.metadata.stat.mtime) {
					logger.debug("Using cached embedding", doc.metadata.source);
					cachedData?.chunks.forEach((chunk) => {
						const chunkDoc = new Document({
							pageContent: chunk.content,
							metadata: { ...doc.metadata },
						});
						embeddingsByDocument[doc.metadata.source].push({
							doc: chunkDoc,
							embedding: chunk.embedding,
						});
					});
					continue;
				} else {
					logger.warn(
						"Cached embedding is outdated",
						doc.metadata.source,
					);
				}
			}

			const content = preprocessContent(doc.pageContent);
			const chunks = splitContent(content);
			for (const chunk of chunks) {
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
			const embeddings = await embedder.embedDocuments(
				chunksToEmbed.map((item) => item.chunk),
			);

			for (const embedding of embeddings) {
				const i = embeddings.indexOf(embedding);
				const { doc } = chunksToEmbed[i];
				embeddingsByDocument[doc.metadata.source] =
					embeddingsByDocument[doc.metadata.source] || [];
				embeddingsByDocument[doc.metadata.source].push({
					doc,
					embedding,
				});
			}
		} catch (error) {
			if (!aiProvider.abortController?.signal.aborted) {
				console.error(`Error creating embeddings:`, error);
			}
		}
	}

	// Cache embeddings for each document
	for (const [source, documentWithEmbeddings] of Object.entries(
		embeddingsByDocument,
	)) {
		for (const { doc, embedding } of documentWithEmbeddings) {
			await vectorStore.addVectors([embedding], [doc]);
		}

		await embeddingsCache.set(source, {
			mtime: documentWithEmbeddings[0].doc.metadata.stat.mtime,
			chunks: documentWithEmbeddings.map(({ doc, embedding }) => ({
				content: doc.pageContent,
				embedding,
			})),
		});
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

	const results = await vectorStore.similaritySearchWithScore(
		query,
		MAX_SEARCH_RESULTS,
	);

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
			if (score >= HIGH_SCORE_THRESHOLD) {
				acc[basename].highScore.push(doc.pageContent);
			} else {
				acc[basename].lowScore.push(doc.pageContent);
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

export async function clearEmbeddingsCache() {
	await embeddingsCache.clear();
}

function getCreatedTime(doc: Document): number {
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
