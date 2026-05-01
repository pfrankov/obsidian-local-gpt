import { App, Notice, TFile } from "obsidian";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { getLinkedFiles, searchDocuments, startProcessing } from "./rag";
import type { IAIDocument, LocalGPTSettings } from "./interfaces";
import { I18n } from "./i18n";

interface ContextEnhancementOptions {
	app: App;
	settings: LocalGPTSettings;
	selectedText: string;
	aiProviders: IAIProvidersService;
	aiProvider: IAIProvider | undefined;
	abortController: AbortController;
	selectedFiles: string[] | undefined;
	queryText: string;
	initializeProgress: () => void;
	updateCompletedSteps: (steps: number) => void;
	addTotalProgressSteps: (steps: number) => void;
	hideStatusBar: () => void;
}

export async function enhanceWithContext({
	app,
	settings,
	selectedText,
	aiProviders,
	aiProvider,
	abortController,
	selectedFiles,
	queryText,
	initializeProgress,
	updateCompletedSteps,
	addTotalProgressSteps,
	hideStatusBar,
}: ContextEnhancementOptions): Promise<string> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile || !aiProvider || abortController?.signal.aborted) {
		return "";
	}

	const allLinkedFiles = collectLinkedFilesForContext(
		app,
		selectedText,
		selectedFiles,
		activeFile.path,
	);
	if (allLinkedFiles.length === 0) {
		return "";
	}

	try {
		const relevantContext = await retrieveRelevantContext({
			app,
			settings,
			activeFile,
			allLinkedFiles,
			aiProviders,
			aiProvider,
			abortController,
			selectedFiles,
			queryText,
			initializeProgress,
			updateCompletedSteps,
			addTotalProgressSteps,
		});
		return finishContextProcessing(relevantContext, hideStatusBar);
	} catch (error) {
		return handleContextError(error, abortController, hideStatusBar);
	}
}

interface RelevantContextOptions {
	app: App;
	settings: LocalGPTSettings;
	activeFile: TFile;
	allLinkedFiles: TFile[];
	aiProviders: IAIProvidersService;
	aiProvider: IAIProvider;
	abortController: AbortController;
	selectedFiles: string[] | undefined;
	queryText: string;
	initializeProgress: () => void;
	updateCompletedSteps: (steps: number) => void;
	addTotalProgressSteps: (steps: number) => void;
}

async function retrieveRelevantContext({
	app,
	settings,
	activeFile,
	allLinkedFiles,
	aiProviders,
	aiProvider,
	abortController,
	selectedFiles,
	queryText,
	initializeProgress,
	updateCompletedSteps,
	addTotalProgressSteps,
}: RelevantContextOptions): Promise<string> {
	initializeProgress();

	const processedDocs = await startProcessing(
		allLinkedFiles,
		app.vault,
		app.metadataCache,
		activeFile,
		updateCompletedSteps,
		selectedFiles?.includes(activeFile.path) ?? false,
	);

	if (shouldAbortProcessing(processedDocs, abortController)) {
		return "";
	}

	const retrieveDocuments = Array.from(processedDocs.values());
	if (abortController?.signal.aborted) {
		return "";
	}

	const relevantContext = await searchDocuments(
		queryText,
		retrieveDocuments,
		aiProviders,
		aiProvider,
		abortController,
		updateCompletedSteps,
		addTotalProgressSteps,
		resolveContextLimit(settings),
	);

	return relevantContext.trim() || "";
}

function finishContextProcessing(
	result: string,
	hideStatusBar: () => void,
): string {
	hideStatusBar();
	return result;
}

function handleContextError(
	error: unknown,
	abortController: AbortController,
	hideStatusBar: () => void,
): string {
	hideStatusBar();
	if (!abortController?.signal.aborted) {
		console.error("Error processing RAG:", error);
		new Notice(
			I18n.t("notices.errorProcessingRag", {
				message: (error as any).message,
			}),
		);
	}
	return "";
}

function collectLinkedFilesForContext(
	app: App,
	selectedText: string,
	selectedFiles: string[] | undefined,
	activeFilePath: string,
): TFile[] {
	const linkedFiles = getLinkedFiles(
		selectedText,
		app.vault,
		app.metadataCache,
		activeFilePath,
	);

	const additionalFiles =
		selectedFiles
			?.map((filePath) => app.vault.getAbstractFileByPath(filePath))
			.filter(
				(file): file is TFile =>
					file !== null &&
					file instanceof TFile &&
					(file.extension === "md" || file.extension === "pdf"),
			) || [];

	return [...linkedFiles, ...additionalFiles];
}

function shouldAbortProcessing(
	processedDocs: Map<string, IAIDocument>,
	abortController: AbortController,
): boolean {
	return processedDocs.size === 0 || abortController?.signal.aborted;
}

function resolveContextLimit(settings: LocalGPTSettings): number {
	const preset = settings?.defaults?.contextLimit as
		| "local"
		| "cloud"
		| "advanced"
		| "max";
	const map: Record<string, number> = {
		local: 10_000,
		cloud: 32_000,
		advanced: 100_000,
		max: 3_000_000,
	};
	return map[preset];
}
