import { Editor, Notice, Plugin, requestUrl } from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "./spinnerPlugin";
import {
	getTrackedRange,
	releaseTrackedRange,
	requestPositionTracker,
	trackSelectionRange,
} from "./requestPositionTracker";
import { actionPalettePlugin } from "./ui/actionPalettePlugin";
import type { LocalGPTAction, LocalGPTSettings } from "./interfaces";
import { ensureActionIds } from "./actionUtils";

import { logger } from "./logger";
import { I18n } from "./i18n";
import { fileCache } from "./indexedDB";
import { initAI, waitForAI } from "@obsidian-ai-providers/sdk";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { ProgressStatusBar } from "./progressStatusBar";
import { migrateSettings } from "./settingsMigration";
import {
	getActionPaletteInitialSelectedFiles,
	registerLocalGPTCommands,
} from "./localGptCommands";
import { enhanceWithContext as enhanceContext } from "./contextEnhancer";
import { extractImagesFromSelection } from "./selectionImages";
import {
	executeProviderRequest,
	overrideProviderModel,
	selectProvider,
} from "./providerRequest";
import { removeThinkingTags } from "./textProcessing";

type SelectionContextMode = "selection" | "selection-or-document";

export default class LocalGPT extends Plugin {
	settings!: LocalGPTSettings;
	actionPaletteProviderId: string | null = null;
	actionPaletteModel: string | null = null;
	actionPaletteModelProviderId: string | null = null;
	actionPaletteCreativityKey: string | null = null; // "", "low", "medium", "high"
	abortControllers: AbortController[] = [];
	updatingInterval!: number;
	private progressStatusBar!: ProgressStatusBar;

	async onload() {
		initAI(this.app, this, async () => {
			await this.loadSettings();
			this.addSettingTab(new LocalGPTSettingTab(this.app, this));
			this.reload();
			this.app.workspace.onLayoutReady(async () => {
				// @ts-ignore
				await fileCache.init(this.app.appId);

				window.setTimeout(() => {
					this.checkUpdates();
				}, 5000);
			});
			this.registerEditorExtension(spinnerPlugin);
			this.registerEditorExtension(requestPositionTracker);
			this.registerEditorExtension(actionPalettePlugin);
			this.initializeStatusBar();
		});
	}

	private initializeStatusBar() {
		this.progressStatusBar = new ProgressStatusBar(this.addStatusBarItem());
	}

	private getLegacyActionPaletteSystemPromptStorageKey(): string {
		const vaultName = this.app?.vault?.getName?.();
		return vaultName
			? `${this.manifest.id}:action-palette-system-prompt:${vaultName}`
			: `${this.manifest.id}:action-palette-system-prompt`;
	}

	processText(text: string, selectedText: string) {
		if (!text.trim()) {
			return "";
		}

		// Remove <think>...</think> tags and their content from the final output
		const cleanText = removeThinkingTags(text).trim();

		return ["\n", cleanText.replace(selectedText, "").trim(), "\n"].join(
			"",
		);
	}

	private addCommands() {
		registerLocalGPTCommands(this);
	}

	private getActionPaletteInitialSelectedFiles(editor: Editor): string[] {
		return getActionPaletteInitialSelectedFiles(this, editor);
	}

	async runFreeform(
		editor: Editor,
		userInput: string,
		selectedFiles: string[] = [],
		overrideProviderId?: string | null,
		customTemperature?: number,
		systemPrompt?: string,
	) {
		return this.executeAction(
			{
				prompt: userInput,
				system: systemPrompt,
				replace: false,
				selectedFiles,
				overrideProviderId: overrideProviderId || undefined,
				temperature: customTemperature,
				selectionContextMode: "selection",
			},
			editor,
		);
	}

	async runAction(action: LocalGPTAction, editor: Editor) {
		return this.executeAction(
			{
				prompt: action.prompt,
				system: action.system,
				replace: !!action.replace,
				temperature:
					action.temperature ||
					CREATIVITY[this.settings.defaults.creativity].temperature,
				selectionContextMode: "selection-or-document",
			},
			editor,
		);
	}

	private async executeAction(
		params: {
			prompt: string;
			system?: string;
			replace?: boolean;
			temperature?: number;
			selectedFiles?: string[];
			overrideProviderId?: string | null;
			selectionContextMode: SelectionContextMode;
		},
		editor: Editor,
	) {
		const {
			editorView,
			cursorOffsetFrom,
			cursorOffsetTo,
			selectedTextRef,
		} = this.extractSelectionContext(editor, params.selectionContextMode);
		const { abortController, hideSpinner, onUpdate } =
			this.createExecutionContext(
				editorView,
				cursorOffsetTo,
				selectedTextRef,
			);
		let selectionTrackerId = trackSelectionRange(
			editorView,
			cursorOffsetFrom,
			cursorOffsetTo,
		);
		const releaseSelectionTracker = () => {
			if (!selectionTrackerId) {
				return;
			}
			releaseTrackedRange(editorView, selectionTrackerId);
			selectionTrackerId = null;
		};
		abortController.signal.addEventListener(
			"abort",
			releaseSelectionTracker,
		);

		try {
			const { cleanedText, imagesInBase64 } =
				await extractImagesFromSelection(
					this.app,
					selectedTextRef.value,
				);
			selectedTextRef.value = cleanedText;

			logger.time("Processing Embeddings");
			logger.timeEnd("Processing Embeddings");
			logger.debug("Selected text", cleanedText);

			const aiRequestWaiter = await waitForAI();
			const aiProviders: IAIProvidersService =
				await aiRequestWaiter.promise;

			const embeddingProvider = aiProviders.providers.find(
				(provider: IAIProvider) =>
					provider.id === this.settings.aiProviders.embedding,
			);

			const contextQuery = cleanedText.trim()
				? cleanedText
				: params.prompt;
			const context = await this.enhanceWithContext(
				cleanedText,
				aiProviders,
				embeddingProvider,
				abortController,
				params.selectedFiles,
				contextQuery,
			);

			const provider = selectProvider(
				aiProviders,
				this.settings,
				imagesInBase64.length > 0,
				params.overrideProviderId,
			);
			const adjustedProvider = overrideProviderModel(
				provider,
				params.overrideProviderId,
				this.actionPaletteModel,
				this.actionPaletteModelProviderId,
			);

			let fullText = "";
			try {
				fullText = await executeProviderRequest({
					aiProviders,
					provider: adjustedProvider,
					settings: this.settings,
					prompt: params.prompt,
					system: params.system,
					temperature: params.temperature,
					selectedText: cleanedText,
					context,
					imagesInBase64,
					abortController,
					onUpdate,
				});
			} finally {
				hideSpinner && hideSpinner();
				this.app.workspace.updateOptions();
			}

			if (abortController.signal.aborted) {
				return;
			}

			const finalText = removeThinkingTags(fullText).trim();
			const trackedRange = selectionTrackerId
				? getTrackedRange(editorView, selectionTrackerId)
				: null;
			const mappedRange = trackedRange || {
				from: cursorOffsetFrom,
				to: cursorOffsetTo,
				insertAfter: cursorOffsetTo,
			};
			const insertionOffset = params.replace
				? mappedRange.to
				: mappedRange.insertAfter;
			this.applyTextResult(
				editor,
				params.replace,
				finalText,
				selectedTextRef.value,
				mappedRange.from,
				insertionOffset,
			);
		} finally {
			releaseSelectionTracker();
		}
	}

	private extractSelectionContext(
		editor: Editor,
		selectionContextMode: SelectionContextMode,
	) {
		// @ts-expect-error, not typed
		const editorView = editor.cm;
		const selection = editor.getSelection();
		const selectedTextRef = {
			value:
				selection ||
				(selectionContextMode === "selection-or-document"
					? editor.getValue()
					: ""),
		};
		const cursorPositionFrom = editor.getCursor("from");
		const cursorPositionTo = editor.getCursor("to");
		const cursorOffsetFrom = editor.posToOffset(cursorPositionFrom);
		const cursorOffsetTo = editor.posToOffset(cursorPositionTo);

		return {
			editorView,
			cursorOffsetFrom,
			cursorOffsetTo,
			selectedTextRef,
		};
	}

	private createExecutionContext(
		editorView: any,
		cursorOffsetTo: number,
		selectedTextRef: { value: string },
	) {
		const abortController = new AbortController();
		this.abortControllers.push(abortController);

		const spinner = editorView.plugin(spinnerPlugin) || undefined;
		const hideSpinner = spinner?.show(cursorOffsetTo);
		this.app.workspace.updateOptions();

		abortController.signal.addEventListener("abort", () => {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
		});

		const onUpdate = (updatedString: string) => {
			if (!spinner) return;
			spinner.processText(
				updatedString,
				(text: string) => this.processText(text, selectedTextRef.value),
				cursorOffsetTo,
			);
			this.app.workspace.updateOptions();
		};

		return { abortController, hideSpinner, onUpdate };
	}

	private applyTextResult(
		editor: Editor,
		replaceSelection: boolean | undefined,
		finalText: string,
		selectedText: string,
		cursorOffsetFrom: number,
		cursorOffsetTo: number,
	) {
		const cursorPositionFrom = editor.offsetToPos(cursorOffsetFrom);
		const cursorPositionTo = editor.offsetToPos(cursorOffsetTo);
		if (replaceSelection) {
			editor.replaceRange(
				finalText,
				cursorPositionFrom,
				cursorPositionTo,
			);
			return;
		}
		const isLastLine = editor.lastLine() === cursorPositionTo.line;
		const text = this.processText(finalText, selectedText);
		editor.replaceRange(isLastLine ? "\n" + text : text, {
			ch: 0,
			line: cursorPositionTo.line + 1,
		});
	}

	async enhanceWithContext(
		selectedText: string,
		aiProviders: IAIProvidersService,
		aiProvider: IAIProvider | undefined,
		abortController: AbortController,
		selectedFiles: string[] | undefined,
		queryText: string,
	): Promise<string> {
		return enhanceContext({
			app: this.app,
			settings: this.settings,
			selectedText,
			aiProviders,
			aiProvider,
			abortController,
			selectedFiles,
			queryText,
			initializeProgress: () => this.initializeProgress(),
			updateCompletedSteps: (steps) => this.updateCompletedSteps(steps),
			addTotalProgressSteps: (steps) => this.addTotalProgressSteps(steps),
			hideStatusBar: () => this.hideStatusBar(),
		});
	}

	onunload() {
		document.removeEventListener("keydown", this.escapeHandler);
		window.clearInterval(this.updatingInterval);
		this.progressStatusBar?.dispose();
	}

	async loadSettings() {
		const loadedData: LocalGPTSettings | undefined = await this.loadData();
		const { settings, changed } = await this.migrateSettings(loadedData);

		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
		const { actions: actionsWithIds, changed: actionIdsChanged } =
			ensureActionIds(this.settings.actions || []);
		this.settings.actions = actionsWithIds;

		if (changed || actionIdsChanged) {
			await this.saveData(this.settings);
		}
	}

	private async migrateSettings(loadedData?: LocalGPTSettings) {
		return migrateSettings(
			loadedData,
			this.getLegacyActionPaletteSystemPromptStorageKey(),
		);
	}

	async checkUpdates() {
		try {
			const { json: response } = await requestUrl({
				url: "https://api.github.com/repos/pfrankov/obsidian-local-gpt/releases/latest",
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
				contentType: "application/json",
			});

			if (response.tag_name !== this.manifest.version) {
				new Notice(I18n.t("notices.newVersion"));
			}
		} catch (error) {
			console.error("Error checking for updates:", error);
		}
	}

	escapeHandler = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			this.abortControllers.forEach(
				(abortControllers: AbortController) => {
					abortControllers.abort();
				},
			);
			this.abortControllers = [];
		}
	};

	reload() {
		this.onunload();
		this.addCommands();
		this.abortControllers = [];
		this.updatingInterval = window.setInterval(
			this.checkUpdates.bind(this),
			10800000,
		); // every 3 hours
		document.addEventListener("keydown", this.escapeHandler);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.reload();
	}

	private initializeProgress() {
		this.progressStatusBar?.initialize();
	}

	private addTotalProgressSteps(steps: number) {
		this.progressStatusBar?.addTotalProgressSteps(steps);
	}

	private updateCompletedSteps(steps: number) {
		this.progressStatusBar?.updateCompletedSteps(steps);
	}

	private hideStatusBar() {
		this.progressStatusBar?.hide();
	}

	private markProgressFinished() {
		this.progressStatusBar?.markFinished();
	}
}
