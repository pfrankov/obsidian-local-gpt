import { TFile, Vault, MetadataCache } from "obsidian";
import { IAIDocument, IAIProvidersRetrievalResult } from "./interfaces";
import { logger } from "./logger";
import { extractTextFromPDF } from "./processors/pdf";
import { fileCache } from "./indexedDB";

const MAX_DEPTH = 10;
const WIKI_LINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK_REGEX = /\[[^\]]+\]\(([^)]+)\)/g;
const SUPPORTED_RAG_EXTENSIONS = new Set(["md", "pdf"]);

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
	if (depth > MAX_DEPTH || processedDocs.has(file.path)) {
		return processedDocs;
	}

	try {
		if (file.path === context.activeFile.path) {
			await traverseLinkedGraph(file, context, processedDocs, depth, {
				includeBacklinks: false,
			});
			return processedDocs;
		}

		const content = await getFileContent(file, context.vault);
		processedDocs.set(file.path, {
			content,
			meta: {
				source: file.path,
				basename: file.basename,
				stat: file.stat,
				depth,
				isBacklink,
			},
		});

		if (file.extension === "md") {
			await traverseLinkedGraph(file, context, processedDocs, depth, {
				content,
				includeForwardLinks: !isBacklink,
			});
		}
	} catch (error) {
		console.error(`Error processing document ${file.path}:`, error);
	}

	return processedDocs;
}

async function traverseLinkedGraph(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, IAIDocument>,
	depth: number,
	options?: {
		content?: string;
		includeForwardLinks?: boolean;
		includeBacklinks?: boolean;
	},
) {
	const includeForwardLinks = options?.includeForwardLinks ?? true;
	const includeBacklinks = options?.includeBacklinks ?? true;

	const linkedFiles = includeForwardLinks
		? resolveForwardLinks(file, context, options?.content)
		: [];
	const backlinkFiles = includeBacklinks
		? getBacklinkFiles(file, context, processedDocs)
		: [];

	await Promise.all([
		...processFilesForRAG(
			linkedFiles,
			context,
			processedDocs,
			depth + 1,
			false,
		),
		...processFilesForRAG(
			backlinkFiles,
			context,
			processedDocs,
			depth,
			true,
		),
	]);
}

function resolveForwardLinks(
	file: TFile,
	context: ProcessingContext,
	content?: string,
): TFile[] {
	if (content !== undefined) {
		return getLinkedFiles(
			content,
			context.vault,
			context.metadataCache,
			file.path,
			true,
		);
	}
	return getResolvedLinkedFiles(
		file.path,
		context.vault,
		context.metadataCache,
	);
}

function processFilesForRAG(
	files: TFile[],
	context: ProcessingContext,
	processedDocs: Map<string, IAIDocument>,
	depth: number,
	isBacklink: boolean,
): Promise<Map<string, IAIDocument>>[] {
	return files.map((candidate) =>
		processDocumentForRAG(
			candidate,
			context,
			processedDocs,
			depth,
			isBacklink,
		),
	);
}

function getResolvedLinkedFiles(
	currentFilePath: string,
	vault: Vault,
	metadataCache: MetadataCache,
): TFile[] {
	const resolvedLinks = metadataCache?.resolvedLinks;
	const links = resolvedLinks?.[currentFilePath];
	if (!links) return [];

	return Object.keys(links)
		.map((targetPath) => vault.getAbstractFileByPath(targetPath))
		.filter(isSupportedRagFile);
}

export function getLinkedFiles(
	content: string,
	vault: Vault,
	metadataCache: MetadataCache,
	currentFilePath: string,
	includeAllMarkdownLinks = false,
): TFile[] {
	const sanitizedContent = sanitizeMarkdownForLinks(content);
	const wikiLinks = Array.from(
		sanitizedContent.matchAll(WIKI_LINK_REGEX),
		(match) => match[1],
	);
	const markdownCandidates = Array.from(
		sanitizedContent.matchAll(MARKDOWN_LINK_REGEX),
		(match) => normalizeMarkdownLink(match[1]),
	).filter((link): link is string => Boolean(link));
	const markdownLinks =
		includeAllMarkdownLinks ||
		(wikiLinks.length === 0 && markdownCandidates.length === 1)
			? markdownCandidates
			: [];

	return [...wikiLinks, ...markdownLinks]
		.map((linkText) => {
			const linkPath = metadataCache.getFirstLinkpathDest(
				linkText,
				currentFilePath,
			);
			return linkPath ? vault.getAbstractFileByPath(linkPath.path) : null;
		})
		.filter(isSupportedRagFile);
}

function isSupportedRagFile(file: unknown): file is TFile {
	return (
		file instanceof TFile && SUPPORTED_RAG_EXTENSIONS.has(file.extension)
	);
}

function sanitizeMarkdownForLinks(content: string): string {
	return content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/`[^`]*`/g, "");
}

function normalizeMarkdownLink(rawLink: string): string | null {
	const withoutAnchor = rawLink.split("#")[0].trim();
	const normalized = withoutAnchor.replace(/^<|>$/g, "");
	if (
		!normalized ||
		normalized.startsWith("/") ||
		/^[a-z]+:/i.test(normalized)
	) {
		return null;
	}

	return normalized;
}

export function getBacklinkFiles(
	file: TFile,
	context: ProcessingContext,
	processedDocs: Map<string, IAIDocument>,
): TFile[] {
	const resolvedLinks = context.metadataCache.resolvedLinks || {};
	const backlinks: TFile[] = [];

	for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
		if (processedDocs.has(sourcePath) || !links?.[file.path]) {
			continue;
		}
		const backlinkFile = context.vault.getAbstractFileByPath(
			sourcePath,
		) as TFile | null;
		if (backlinkFile?.extension === "md") {
			backlinks.push(backlinkFile);
		}
	}

	return backlinks;
}

export async function searchDocuments(
	query: string,
	documents: IAIDocument[],
	aiProviders: any,
	embeddingProvider: any,
	abortController: AbortController,
	updateCompletedSteps: (steps: number) => void,
	addTotalProgressSteps: (steps: number) => void,
	contextLimit: number,
): Promise<string> {
	if (abortController?.signal.aborted) return "";

	try {
		let lastProcessedChunks = 0;
		let initialized = false;

		logger.info("Passed contextLimit for context", contextLimit);

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
			abortController,
		});
		// Fallback: if no progress events fired but we got results, mimic one step for backward compatibility
		if (!initialized && results?.length) {
			updateCompletedSteps(1);
		}
		return formatResults(results, contextLimit);
	} catch (error) {
		if (!abortController?.signal.aborted) {
			console.error("Error in searchDocuments:", error);
		}
		return "";
	}
}

function formatResults(
	results: IAIProvidersRetrievalResult[],
	contextLimit: number,
): string {
	if (!results?.length) return "";

	const groupedResults = groupResultsByBasename(results);
	const sortedGroups = sortResultGroups(groupedResults);
	const { text, length } = formatGroupedResults(sortedGroups, contextLimit);

	logger.info("Total length of context", length);

	return text;
}

function groupResultsByBasename(
	results: IAIProvidersRetrievalResult[],
): Map<string, IAIProvidersRetrievalResult[]> {
	return results.reduce((map, result) => {
		const basename = result.document.meta?.basename;
		const existing = map.get(basename) || [];
		existing.push(result);
		map.set(basename, existing);
		return map;
	}, new Map<string, IAIProvidersRetrievalResult[]>());
}

function sortResultGroups(
	groupedResults: Map<string, IAIProvidersRetrievalResult[]>,
): Array<[string, IAIProvidersRetrievalResult[]]> {
	return Array.from(groupedResults.entries()).sort(
		(a, b) =>
			(b[1][0]?.document.meta?.stat?.ctime || 0) -
			(a[1][0]?.document.meta?.stat?.ctime || 0),
	);
}

function formatGroupedResults(
	groups: Array<[string, IAIProvidersRetrievalResult[]]>,
	contextLimit: number,
): { text: string; length: number } {
	let formattedResults = "";
	let totalLength = 0;

	for (const [basename, groupResults] of groups) {
		if (totalLength >= contextLimit) break;

		formattedResults += `[[${basename}]]\n`;
		const { text, length } = formatSingleGroup(
			groupResults,
			contextLimit,
			totalLength,
		);
		formattedResults += text;
		totalLength += length;
	}

	const trimmed = formattedResults.trim();
	return { text: trimmed, length: trimmed.length };
}

function formatSingleGroup(
	groupResults: IAIProvidersRetrievalResult[],
	contextLimit: number,
	currentLength: number,
): { text: string; length: number } {
	let groupText = "";
	let addedLength = 0;
	const sortedResults = [...groupResults].sort((a, b) => b.score - a.score);

	for (const result of sortedResults) {
		const content = result.content.trim();
		const projectedLength =
			currentLength + addedLength + content.length + 2;
		if (!content || projectedLength >= contextLimit) {
			continue;
		}
		groupText += `${content}\n\n`;
		addedLength += content.length + 2;
	}

	return { text: groupText, length: addedLength };
}
