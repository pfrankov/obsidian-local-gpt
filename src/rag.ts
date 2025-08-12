import { TFile, Vault, MetadataCache } from "obsidian";
import { IAIDocument, IAIProvidersRetrievalResult } from "./interfaces";
import { logger } from "./logger";
import { extractTextFromPDF } from "./processors/pdf";
import { fileCache } from "./indexedDB";

const MAX_DEPTH = 10;
const MAX_CONTEXT_LENGTH = 10000;

export interface ProcessingContext {
	vault: Vault;
	metadataCache: MetadataCache;
	activeFile: TFile;
}

export async function startProcessing(
	linkedFiles: TFile[],
	vault: Vault,
	metadataCache: MetadataCache,
	activeFile: TFile,
	updateCompletedSteps?: (steps: number) => void,
): Promise<Map<string, IAIDocument>> {
	logger.info("Starting RAG processing");
	const processedDocs = new Map<string, IAIDocument>();
	const context: ProcessingContext = { vault, metadataCache, activeFile };

	await Promise.all(
		linkedFiles.map(async (file) => {
			await processDocumentForRAG(file, context, processedDocs, 0, false);
			updateCompletedSteps?.(1);
		}),
	);

	return processedDocs;
}

export async function getFileContent(
	file: TFile,
	vault: Vault,
): Promise<string> {
	if (file.extension === "pdf") {
		const cachedContent = await fileCache.getContent(file.path);
		if (cachedContent?.mtime === file.stat.mtime) {
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

	return vault.cachedRead(file);
}

export async function processDocumentForRAG(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, IAIDocument>,
	depth: number,
	isBacklink: boolean,
): Promise<Map<string, IAIDocument>> {
	if (
		depth > MAX_DEPTH ||
		processedDocs.has(file.path) ||
		file.path === context.activeFile.path
	) {
		return processedDocs;
	}

	try {
		const content = await getFileContent(file, context.vault);
		processedDocs.set(file.path, {
			content: content,
			meta: {
				source: file.path,
				basename: file.basename,
				stat: file.stat,
				depth,
				isBacklink,
			},
		});

		if (file.extension === "md" && !isBacklink) {
			const linkedFiles = getLinkedFiles(
				content,
				context.vault,
				context.metadataCache,
				file.path,
			);
			const backlinkFiles = getBacklinkFiles(
				file,
				context,
				processedDocs,
			);

			await Promise.all([
				...linkedFiles.map((linkedFile) =>
					processDocumentForRAG(
						linkedFile,
						context,
						processedDocs,
						depth + 1,
						false,
					),
				),
				...backlinkFiles.map((backlinkFile) =>
					processDocumentForRAG(
						backlinkFile,
						context,
						processedDocs,
						depth,
						true,
					),
				),
			]);
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

	return Array.from(content.matchAll(linkRegex), (match) => match[1])
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
	processedDocs: Map<string, IAIDocument>,
): TFile[] {
	return Object.entries(context.metadataCache.resolvedLinks)
		.filter(
			([sourcePath, links]) =>
				links[file.path] && !processedDocs.has(sourcePath),
		)
		.map(([sourcePath]) => context.vault.getAbstractFileByPath(sourcePath))
		.filter(
			(backlinkFile): backlinkFile is TFile =>
				backlinkFile instanceof TFile &&
				backlinkFile.extension === "md",
		);
}

export async function searchDocuments(
	query: string,
	documents: IAIDocument[],
	aiProviders: any,
	embeddingProvider: any,
	abortController: AbortController,
    updateCompletedSteps: (steps: number) => void,
    addTotalProgressSteps?: (steps: number) => void,
): Promise<string> {
	if (abortController?.signal.aborted) return "";

	try {
		let lastProcessedChunks = 0;
		let initialized = false;
		const results = await aiProviders.retrieve({
			query,
			documents,
			embeddingProvider,
			onProgress: (progress: any) => {
				if (abortController?.signal.aborted) return;
				// Initialize dynamic steps based on total chunks when first progress event arrives
				if (!initialized) {
					initialized = true;
					// Allocate steps for each chunk
					addTotalProgressSteps?.(progress.totalChunks || 0);
				}
				const processed = progress.processedChunks?.length || 0;
				if (processed > lastProcessedChunks) {
					updateCompletedSteps(processed - lastProcessedChunks);
					lastProcessedChunks = processed;
				}
			},
			abortController
		});
		return formatResults(results);
	} catch (error) {
		if (!abortController?.signal.aborted) {
			console.error("Error in searchDocuments:", error);
		}
		return "";
	}
}

function formatResults(results: IAIProvidersRetrievalResult[]): string {
	if (!results?.length) return "";

	const groupedResults = new Map<string, IAIProvidersRetrievalResult[]>();

	for (const result of results) {
		const basename = result.document.meta?.basename;
		if (!groupedResults.has(basename)) {
			groupedResults.set(basename, []);
		}
		groupedResults.get(basename)!.push(result);
	}

	const sortedGroups = Array.from(groupedResults.entries()).sort(
		(a, b) =>
			(b[1][0]?.document.meta?.stat?.ctime || 0) -
			(a[1][0]?.document.meta?.stat?.ctime || 0),
	);

	let formattedResults = "";
	let totalLength = 0;

	for (const [basename, groupResults] of sortedGroups) {
		if (totalLength >= MAX_CONTEXT_LENGTH) break;

		formattedResults += `[[${basename}]]\n`;

		const sortedResults = groupResults.sort((a, b) => b.score - a.score);
		for (const result of sortedResults) {
			const content = result.content.trim();
			if (content && totalLength + content.length < MAX_CONTEXT_LENGTH) {
				formattedResults += `${content}\n\n`;
				totalLength += content.length + 2;
			}
		}
	}

	return formattedResults.trim();
}
