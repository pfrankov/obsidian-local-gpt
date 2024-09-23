import { TFile, Vault, MetadataCache } from "obsidian";
import { Document } from "langchain/document";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { preprocessContent, splitContent } from "./text-processing";
import { AIProvider } from "interfaces";
import LocalGPT from "main";
import { CustomEmbeddings } from "./embeddings/CustomEmbeddings";
import { logger } from "./logger";

const MAX_DEPTH = 10;
const documentCache = new Map<
	string,
	{ mtime: number; embedding?: number[] }
>();

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
	logger.debug("Starting RAG processing", {
		linkedFilesCount: linkedFiles.length,
	});
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

async function processDocumentForRAG(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, Document>,
	depth: number,
	isBacklink: boolean,
): Promise<Map<string, Document>> {
	logger.debug("Processing document for RAG", {
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
		const content = await context.vault.cachedRead(file);
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

		if (!isBacklink) {
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
				file instanceof TFile && file.extension === "md",
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
	let embedder: CustomEmbeddings;

	embedder = new CustomEmbeddings({
		aiProvider,
	});

	const vectorStore = new MemoryVectorStore(embedder);
	const uniqueChunks = new Set<string>();
	const chunksToEmbed: { chunk: string; doc: Document }[] = [];

	for (const doc of documents) {
		if (doc.metadata.source !== currentDocumentPath) {
			const content = preprocessContent(doc.pageContent);
			const chunks = splitContent(content);
			for (const chunk of chunks) {
				if (!uniqueChunks.has(chunk)) {
					uniqueChunks.add(chunk);
					const chunkDoc = new Document({
						pageContent: chunk,
						metadata: { ...doc.metadata },
					});

					const cachedData = documentCache.get(doc.metadata.source);
					if (cachedData?.embedding) {
						logger.debug("Using cached embedding", {
							embedding: cachedData.embedding,
						});
						await vectorStore.addVectors(
							[cachedData.embedding],
							[chunkDoc],
						);
					} else {
						chunksToEmbed.push({ chunk, doc: chunkDoc });
					}
				}
			}
		}
	}

	if (chunksToEmbed.length > 0) {
		try {
			const embeddings = await embedder.embedDocuments(
				chunksToEmbed.map((item) => item.chunk),
			);

			for (let i = 0; i < embeddings.length; i++) {
				const { chunk, doc } = chunksToEmbed[i];
				const embedding = embeddings[i];

				await vectorStore.addVectors([embedding], [doc]);
				documentCache.set(doc.metadata.source, {
					mtime: doc.metadata.stat.mtime,
					embedding,
				});
			}
		} catch (error) {
			if (!aiProvider.abortController?.signal.aborted) {
				console.error(`Error creating embeddings:`, error);
			}
		}
	}

	return vectorStore;
}

export async function queryVectorStore(
	query: string,
	vectorStore: MemoryVectorStore,
): Promise<string> {
	logger.debug("Querying vector store", { query });
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
			return `${basename}\n${content}`;
		});

	return finalResults.join("\n\n").trim();
}

export async function clearEmbeddingsCache() {
	documentCache.clear();
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
