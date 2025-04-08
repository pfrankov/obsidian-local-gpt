// --- START OF FILE rag.ts ---

import { TFile, Vault, MetadataCache } from "obsidian"; // Obsidian types
import { Document } from "@langchain/core/documents"; // Correct: Import Document from langchain
// Removed unused IAIProvider import
import { IAIProvidersService } from "@obsidian-ai-providers/sdk"; // Ensure SDK installed
import { MemoryVectorStore } from "langchain/vectorstores/memory"; // Ensure langchain installed
import { preprocessContent, splitContent } from "./text-processing";
import LocalGPT from "./main"; // Type only import if possible
import { CustomEmbeddings } from "./embeddings/CustomEmbeddings";
import { logger } from "./logger";
import { extractTextFromPDF } from "./processors/pdf";
import { fileCache } from "./indexedDB";

const MAX_DEPTH = 5;

export interface ProcessingContext {
	vault: Vault;
	metadataCache: MetadataCache;
	currentDocumentPath: string;
	activeFile: TFile;
}

/** Starts the RAG processing */
export async function startProcessing(
	linkedFiles: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	activeFile: TFile,
): Promise<Map<string, Document>> {
	logger.info("Starting RAG processing...");
	const processedDocs = new Map<string, Document>();
	const context: ProcessingContext = { vault, metadataCache, currentDocumentPath: activeFile.path, activeFile };
	await Promise.all(
		linkedFiles.map(async (file) => {
			try {
				await processDocumentForRAG(file, context, processedDocs, 0, false);
			}
			catch (error) {
				logger.error(`Failed RAG start process for ${file.path}:`, error);
			}
		}),
	);
	logger.info(`Finished RAG processing. Processed ${processedDocs.size} docs.`);
	return processedDocs;
}

/** Retrieves file content, handles PDF/caching */
export async function getFileContent(file: TFile, vault: Vault): Promise<string> {
	const filePath = file.path;
	const fileMtime = file.stat.mtime;
	switch (file.extension.toLowerCase()) {
		case "pdf": {
			const cachedContent = await fileCache.getContent(filePath);
			if (cachedContent && cachedContent.mtime === fileMtime) {
				return cachedContent.content;
			}
			logger.debug(`Extracting PDF: ${filePath}`);
			try {
				const ab = await vault.readBinary(file);
				const content = await extractTextFromPDF(ab);
				// Only cache if content extraction was successful
				if (content) {
					await fileCache.setContent(filePath, { mtime: fileMtime, content });
				}
				return content || "";
			}
			catch (error) {
				logger.error(`PDF extraction failed ${filePath}:`, error);
				return ""; // Return empty string on error
			}
		}
		case "md":
		default:
			return vault.cachedRead(file); // Assuming sync API
	}
}

/** Processes a single document recursively for RAG */
export async function processDocumentForRAG(
	file: TFile, context: ProcessingContext, processedDocs: Map<string, Document>, depth: number, isBacklink: boolean,
): Promise<Map<string, Document>> {
	if (depth > MAX_DEPTH || processedDocs.has(file.path) || file.path === context.currentDocumentPath) {
		return processedDocs;
	}
	// logger.info(`Processing RAG doc: "${file.basename}" (Depth: ${depth}, Backlink: ${isBacklink})`);
	processedDocs.set(file.path, new Document({ pageContent: "", metadata: { source: file.path } })); // Placeholder initially

	try {
		let content = "";
		const isMdFile = file.extension.toLowerCase() === "md";
		let useCache = false;
		const cachedEmbeddings = await fileCache.getEmbeddings(file.path);
		// Ensure chunks exist and have content/embedding before trusting cache
		if (cachedEmbeddings && cachedEmbeddings.mtime === file.stat.mtime && cachedEmbeddings.chunks?.length > 0 && cachedEmbeddings.chunks.every(c => c.content && c.embedding?.length > 0)) {
			useCache = true;
		}

		// Only get content if needed (not cached embedding or is MD for link/backlink check)
		if (!useCache || isMdFile) {
			content = await getFileContent(file, context.vault);
		} else {
			content = ""; // Content not needed if using cached embeddings
		}

		const doc = new Document({
			pageContent: content, // Content might be empty if cache is valid
			metadata: {
				source: file.path,
				basename: file.basename,
				stat: file.stat,
				depth,
				isBacklink,
				cacheValid: useCache // Store cache status in metadata
			},
		});
		processedDocs.set(file.path, doc); // Replace placeholder with full doc

		// Process links/backlinks only for Markdown files with content
		if (isMdFile && content) {
			if (!isBacklink) {
				const linkedFiles = getLinkedFiles(content, context.vault, context.metadataCache, file.path);
				await Promise.all(linkedFiles.map(lf => processDocumentForRAG(lf, context, processedDocs, depth + 1, false).catch(e => logger.error(`Error processing link ${lf.path}:`, e))));
			}
			const backlinkFiles = getBacklinkFiles(file, context, processedDocs);
			await Promise.all(backlinkFiles.map(bf => processDocumentForRAG(bf, context, processedDocs, depth, true).catch(e => logger.error(`Error processing backlink ${bf.path}:`, e))));
		}
	} catch (error) {
		logger.error(`Error processing doc ${file.path}:`, error);
		processedDocs.delete(file.path); // Remove entry if processing failed
	}
	return processedDocs;
}

/** Extracts [[links]] from Markdown */
export function getLinkedFiles(content: string, vault: Vault, metadataCache: MetadataCache, currentFilePath: string): TFile[] {
	if (!content || typeof content.matchAll !== 'function') return [];
	const linkedFiles: TFile[] = [];
	const seenPaths = new Set<string>();
	// eslint-disable-next-line no-useless-escape
	const linkRegex = /(?<!\!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g; // Keep escape for lookbehind
	try {
		for (const match of content.matchAll(linkRegex)) {
			const linkText = match[1];
			if (!linkText) continue;
			const linkPath = metadataCache.getFirstLinkpathDest(linkText, currentFilePath);
			if (linkPath && !seenPaths.has(linkPath.path)) {
				const linkedFile = vault.getAbstractFileByPath(linkPath.path);
				if (linkedFile instanceof TFile && /\.(md|pdf)$/i.test(linkedFile.extension)) {
					linkedFiles.push(linkedFile);
					seenPaths.add(linkPath.path);
				}
			}
		}
	} catch (e) {
		logger.error("Error parsing links with matchAll:", e);
	}
	return linkedFiles;
}

/** Finds backlinking Markdown files */
export function getBacklinkFiles(file: TFile, context: ProcessingContext, processedDocs: Map<string, Document>): TFile[] {
	const backlinks: TFile[] = [];
	const resolvedLinks = context.metadataCache.resolvedLinks;
	if (!resolvedLinks || typeof Object.entries !== 'function') return backlinks;
	for (const [sourcePath, links] of Object.entries(resolvedLinks) as [string, Record<string, number>][]) {
		// Check link exists before accessing it
		if (links?.[file.path] && !processedDocs.has(sourcePath) && sourcePath !== context.currentDocumentPath) {
			const backlinkFile = context.vault.getAbstractFileByPath(sourcePath);
			if (backlinkFile instanceof TFile && backlinkFile.extension.toLowerCase() === 'md') {
				backlinks.push(backlinkFile);
			}
		}
	}
	return backlinks;
}


/** Creates vector store, handles caching/embedding */
export async function createVectorStore(
	documents: Document[],
	plugin: LocalGPT,
	aiProvidersService: IAIProvidersService,
	abortController: AbortController,
	addTotalProgressSteps: (steps: number) => void,
	updateCompletedSteps: (steps: number) => void,
): Promise<MemoryVectorStore> {
	logger.info("Creating vector store...");
	const embeddingProviderId = plugin.settings.aiProviders.embedding;
	if (!embeddingProviderId) {
		throw new Error("Embedding provider ID is missing in settings.");
	}
	const embeddingProvider = aiProvidersService.providers.find(p => p.id === embeddingProviderId);
	if (!embeddingProvider) {
		throw new Error(`Configured embedding provider (ID: "${embeddingProviderId}") not found or unavailable.`);
	}
	logger.info(`Using embedder: ${embeddingProvider.name} (ID: ${embeddingProvider.id})`);

	const embedder = new CustomEmbeddings({
		abortController,
		aiProvider: embeddingProvider,
		aiProvidersService,
		updateCompletedSteps
	});
	const vectorStore = new MemoryVectorStore(embedder);

	// Type explicitly for clarity in the loop
	const chunksToEmbed: { chunk: string; docMetadata: Document['metadata'] }[] = [];
	const cachedVectors: { vector: number[], doc: Document }[] = [];

	for (const doc of documents) {
		// Safety check doc and metadata
		if (!doc?.metadata?.source) {
			logger.warn("Skipping document with missing metadata or source path.", doc);
			continue;
		}
		const sourcePath = doc.metadata.source;

		if (doc.metadata.cacheValid) {
			const cachedData = await fileCache.getEmbeddings(sourcePath);
			if (cachedData?.chunks?.length) {
				// logger.debug(`Using ${cachedData.chunks.length} cached chunks for ${sourcePath}`);
				cachedData.chunks.forEach(chunkData => {
					// Validate cached chunk data before using
					if (chunkData.content && chunkData.embedding?.length > 0) {
						const chunkDoc = new Document({ pageContent: chunkData.content, metadata: { ...doc.metadata } });
						cachedVectors.push({ vector: chunkData.embedding, doc: chunkDoc });
					} else {
						logger.warn(`Invalid cached chunk data found for ${sourcePath}. Content or embedding missing.`);
						doc.metadata.cacheValid = false; // Invalidate cache for this doc if any chunk is bad
					}
				});
			} else {
				// If cache claims valid but no chunks found, invalidate it
				// logger.debug(`Cache marked valid but no chunks found for ${sourcePath}. Invalidating.`);
				doc.metadata.cacheValid = false;
			}
		}

		// Process if cache wasn't valid or was invalidated
		if (!doc.metadata.cacheValid) {
			// logger.debug(`Processing content for ${sourcePath} (Cache Invalid/Missing)`);
			let contentToProcess = doc.pageContent;
			// If pageContent is empty (e.g., because cache was thought to be valid initially), fetch it
			if (!contentToProcess && doc.metadata.source) {
				const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
				if (file instanceof TFile) {
					contentToProcess = await getFileContent(file, plugin.app.vault);
				} else {
					logger.warn(`File not found or not a TFile for source: ${sourcePath}`);
				}
			}

			if (contentToProcess) {
				const processedContent = preprocessContent(contentToProcess);
				const chunks = splitContent(processedContent);
				// logger.debug(`Split ${sourcePath} into ${chunks.length} chunks.`);
				chunks.forEach(chunk => {
					if (chunk.trim()) {
						// ESLint/TS fix: Use defined type Document['metadata']
						chunksToEmbed.push({ chunk, docMetadata: doc.metadata as Document['metadata'] });
					}
				});
			} // ESLint fix: Removed empty else block here
		}
	}

	const totalSteps = chunksToEmbed.length + cachedVectors.length + 1; // +1 for query embedding later
	addTotalProgressSteps(totalSteps);
	updateCompletedSteps(0); // Initialize progress display

	if (cachedVectors.length > 0) {
		logger.debug(`Adding ${cachedVectors.length} cached vectors to vector store.`);
		try {
			await vectorStore.addVectors(cachedVectors.map(i => i.vector), cachedVectors.map(i => i.doc));
			updateCompletedSteps(cachedVectors.length); // Update progress for cached items
		} catch (e) {
			logger.error("Error adding cached vectors:", e);
			// Decide how to handle partial failure, maybe clear cache?
		}
	}

	if (chunksToEmbed.length > 0) {
		logger.info(`Embedding ${chunksToEmbed.length} new chunks...`);
		try {
			logger.time(`Embedding ${chunksToEmbed.length} chunks`);
			const embeddings = await embedder.embedDocuments(chunksToEmbed.map(item => item.chunk));
			logger.timeEnd(`Embedding ${chunksToEmbed.length} chunks`);

			if (abortController.signal.aborted) { throw new Error("Operation aborted during embedding"); }
			if (embeddings.length !== chunksToEmbed.length) { throw new Error(`Embedding results length (${embeddings.length}) does not match chunks length (${chunksToEmbed.length}).`); }

			const vectorsToAdd: number[][] = [];
			const docsToAdd: Document[] = [];
			const embeddingsToCacheBySource: Record<string, { content: string; embedding: number[] }[]> = {};

			for (let i = 0; i < embeddings.length; i++) {
				const embedding = embeddings[i];
				const { chunk, docMetadata } = chunksToEmbed[i];
				// Ensure sourcePath exists from metadata
				const sourcePath = docMetadata?.source;
				if (!sourcePath) {
					logger.warn(`Skipping chunk ${i + 1} due to missing source path in metadata.`);
					continue;
				}

				if (!embedding?.length) {
					logger.warn(`Empty embedding received for chunk ${i + 1} of ${sourcePath}. Skipping.`);
					continue;
				}

				const chunkDoc = new Document({ pageContent: chunk, metadata: { ...docMetadata } });
				vectorsToAdd.push(embedding);
				docsToAdd.push(chunkDoc);

				if (!embeddingsToCacheBySource[sourcePath]) {
					embeddingsToCacheBySource[sourcePath] = [];
				}
				embeddingsToCacheBySource[sourcePath].push({ content: chunk, embedding });
			}

			if (vectorsToAdd.length > 0) {
				logger.debug(`Adding ${vectorsToAdd.length} newly embedded vectors to vector store.`);
				await vectorStore.addVectors(vectorsToAdd, docsToAdd);
			}

			// Update Cache
			if (typeof Object.entries === 'function') {
				logger.debug("Updating embedding cache for newly embedded documents...");
				for (const [sourcePath, chunksData] of Object.entries(embeddingsToCacheBySource)) {
					// Find the original document again to get its stat for mtime
					const originalDoc = documents.find(d => d.metadata?.source === sourcePath);
					const mtime = originalDoc?.metadata?.stat?.mtime;
					if (mtime && chunksData.length > 0) {
						await fileCache.setEmbeddings(sourcePath, { mtime, chunks: chunksData });
					} else {
						logger.warn(`Cache update skipped for ${sourcePath}: Missing mtime or no valid chunks data.`);
					}
				}
				logger.debug("Embedding cache update complete.");
			} else {
				logger.warn("Object.entries unavailable. Skipping embedding cache update.");
			}

		} catch (error) {
			// Check if error is due to abort
			if (abortController?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
				logger.warn("Embedding process aborted.");
			} else {
				logger.error(`Error during embedding or adding new vectors:`, error);
			}
			throw error; // Re-throw to signal failure
		}
	} else {
		logger.info("No new chunks needed embedding.");
	}

	logger.info("Vector store creation finished.");
	return vectorStore;
}


/** Queries the vector store */
export async function queryVectorStore(
	query: string, vectorStore: MemoryVectorStore, updateCompletedSteps: (steps: number) => void,
): Promise<string> {
	logger.info("Querying vector store...");
	const MAX_SEARCH_RESULTS = 12;
	const HIGH_SCORE_THRESHOLD = 0.5;
	const MAX_LOW_SCORE_RESULTS = 6;
	const MAX_CONTEXT_LENGTH = 8000;
	let results: [Document, number][] = [];

	logger.time("Vector Store Query");
	try {
		results = await vectorStore.similaritySearchWithScore(query, MAX_SEARCH_RESULTS);
		updateCompletedSteps(1); // Count query embedding as one step
	}
	catch (e) {
		logger.error("Similarity search error:", e);
		updateCompletedSteps(1); // Still count the failed step
		return "[Error querying vector store]";
	}
	finally {
		logger.timeEnd("Vector Store Query");
	}

	if (!results || results.length === 0) {
		logger.debug("Vector store query returned no results.");
		return "";
	}
	logger.debug(`Retrieved ${results.length} initial results from vector store.`);

	let totalLength = 0;
	// Group results by source document basename
	const groupedResults = results.reduce(
		(acc: Record<string, { highScoreChunks: { content: string; score: number }[]; lowScoreChunks: { content: string; score: number }[]; sortTime: number; maxScore: number; }>,
			[doc, score]: [Document, number]) => {
			// Validate doc and score
			if (!doc?.metadata?.basename || typeof score !== 'number') {
				logger.warn("Skipping result with invalid document or score:", { doc, score });
				return acc;
			}

			const basename = doc.metadata.basename;
			if (!acc[basename]) {
				acc[basename] = {
					highScoreChunks: [],
					lowScoreChunks: [],
					// Use ctime as fallback for sortTime if mtime isn't available
					sortTime: doc.metadata.stat?.mtime || doc.metadata.stat?.ctime || Date.now(),
					maxScore: 0,
				};
			}

			const content = doc.pageContent?.trim();
			if (!content) { // Skip empty content chunks
				// logger.debug(`Skipping empty chunk from ${basename}`);
				return acc;
			}

			// Update max score for the source
			acc[basename].maxScore = Math.max(acc[basename].maxScore, score);

			// Add chunk if it fits within the total length limit
			if (totalLength + content.length <= MAX_CONTEXT_LENGTH) {
				if (score >= HIGH_SCORE_THRESHOLD) {
					acc[basename].highScoreChunks.push({ content, score });
				} else {
					acc[basename].lowScoreChunks.push({ content, score });
				}
				totalLength += content.length;
			}
			// else { logger.debug(`Skipping chunk from ${basename} due to length limit.`); }

			return acc;
		},
		{}
	);

	if (typeof Object.entries !== 'function') {
		logger.error("Object.entries not available. Cannot assemble context.");
		return "[Error assembling context: Incompatible environment]";
	}

	// Sort sources: primarily by highest score chunk, secondarily by modification time (newest first)
	const sortedSources = (Object.entries(groupedResults) as [string, typeof groupedResults[string]][])
		.sort(([, a], [, b]) => {
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
			return b.sortTime - a.sortTime;
		});

	let totalLowScoreCount = 0;
	const finalContextParts: string[] = [];

	// Assemble context from sorted sources
	for (const [basename, { highScoreChunks, lowScoreChunks }] of sortedSources) {
		const sourceParts: string[] = [];
		// Sort high score chunks within the source by score (highest first)
		highScoreChunks.sort((a, b) => b.score - a.score);
		highScoreChunks.forEach(c => sourceParts.push(c.content));

		// Include low score chunks if limit not reached
		if (totalLowScoreCount < MAX_LOW_SCORE_RESULTS) {
			const remainingSlots = MAX_LOW_SCORE_RESULTS - totalLowScoreCount;
			// Sort low score chunks within the source by score (highest first)
			lowScoreChunks.sort((a, b) => b.score - a.score);
			const lowScoreToInclude = lowScoreChunks.slice(0, remainingSlots);
			lowScoreToInclude.forEach(c => sourceParts.push(c.content));
			totalLowScoreCount += lowScoreToInclude.length;
		}

		if (sourceParts.length > 0) {
			finalContextParts.push(`[[${basename}]]\n${sourceParts.join("\n\n")}`);
		}
	}

	const finalContext = finalContextParts.join("\n\n---\n\n").trim();
	logger.info(`Assembled context. Final Length: ${finalContext.length}, Sources: ${finalContextParts.length}`);
	return finalContext;
}

// --- Cache Clearing Functions ---
export async function clearEmbeddingsCache() { logger.warn("Clearing Embeddings Cache..."); await fileCache.clearEmbeddings(); logger.info("Embeddings Cache Cleared."); }
export async function clearContentCache() { logger.warn("Clearing Content Cache..."); await fileCache.clearContent(); logger.info("Content Cache Cleared."); }
export async function clearAllCache() { logger.warn("Clearing ALL Caches..."); await fileCache.clearAll(); logger.info("All Caches Cleared."); }

// --- END OF FILE rag.ts ---