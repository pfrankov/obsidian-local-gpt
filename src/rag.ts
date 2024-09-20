import { TFile, Vault, MetadataCache } from "obsidian";
import { Document } from "langchain/document";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { preprocessContent, splitContent } from "./text-processing";
import { OllamaEmbeddings } from "langchain/embeddings/ollama";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { Providers } from "interfaces";
import LocalGPT from "main";

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
): Promise<MemoryVectorStore> {
	const selectedProvider =
		plugin.settings.providers[plugin.settings.defaults.provider];
	let embeddings;

	if (selectedProvider.type === Providers.OLLAMA) {
		embeddings = new OllamaEmbeddings({
			model: selectedProvider.embeddingModel,
			baseUrl: selectedProvider.ollamaUrl,
		});
	} else if (selectedProvider.type === Providers.OPENAI_COMPATIBLE) {
		embeddings = new OpenAIEmbeddings({
			openAIApiKey: selectedProvider.apiKey,
			modelName: selectedProvider.embeddingModel,
			configuration: {
				baseURL: `${selectedProvider.url.replace(/\/+$/i, "")}/v1`,
			},
		});
	} else {
		throw new Error("Unsupported provider type for embeddings");
	}

	const vectorStore = new MemoryVectorStore(embeddings);
	const uniqueChunks = new Set<string>();

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

					try {
						const cachedData = documentCache.get(
							doc.metadata.source,
						);
						if (cachedData?.embedding) {
							await vectorStore.addVectors(
								[cachedData.embedding],
								[chunkDoc],
							);
						} else {
							const [embedding] = await embeddings.embedDocuments(
								[chunk],
							);
							await vectorStore.addVectors(
								[embedding],
								[chunkDoc],
							);
							documentCache.set(doc.metadata.source, {
								mtime: doc.metadata.stat.mtime,
								embedding,
							});
						}
					} catch (error) {
						console.error(
							`Error creating embedding for ${doc.metadata.source}:`,
							error,
						);
					}
				}
			}
		}
	}

	return vectorStore;
}

export async function queryVectorStore(
	query: string,
	vectorStore: MemoryVectorStore,
): Promise<string> {
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
