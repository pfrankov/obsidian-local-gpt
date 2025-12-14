import { Editor, Menu, Notice, Plugin, requestUrl, TFile } from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "./spinnerPlugin";
import {
	actionPalettePlugin,
	showActionPalette,
	hideActionPalette,
} from "./ui/actionPalettePlugin";
import { IAIDocument, LocalGPTAction, LocalGPTSettings } from "./interfaces";
import { PWACreatorModal } from "./pwa/PWACreatorModal";
import { PWAConfig } from "./pwa/pwaInterfaces";

import { getLinkedFiles, startProcessing, searchDocuments } from "./rag";
import { logger } from "./logger";
import { I18n } from "./i18n";
import { fileCache } from "./indexedDB";
import {
	initAI,
	waitForAI,
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { preparePrompt } from "./utils";

/**
 * Remove all thinking tags and their content from text
 * Used for final output processing
 *
 * @param text Text that may contain thinking tags
 * @returns Clean text without thinking tags and their content
 */
function removeThinkingTags(text: string): string {
	return text.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
}

const MIN_BASE_SPEED = 0.02 / 16;
const MAX_BASE_SPEED = 3 / 16;

export default class LocalGPT extends Plugin {
	settings: LocalGPTSettings;
	actionPaletteProviderId: string | null = null;
	actionPaletteModel: string | null = null;
	actionPaletteModelProviderId: string | null = null;
	actionPaletteCreativityKey: string | null = null; // "", "low", "medium", "high"
	abortControllers: AbortController[] = [];
	updatingInterval: number;
	private statusBarItem: HTMLElement;
	private currentPercentage = 0;
	private targetPercentage = 0;
	private frameId: number | null = null;
	private lastFrameTime: number | null = null;
	private displayedPercentage = 0; // fractional internal value
	private baseSpeed = 0; // percent per ms (smoothed)
	private lastTargetUpdateTime: number | null = null;
	private progressFinished = false; // controls when we can show 100%
	private totalProgressSteps = 0;
	private completedProgressSteps = 0;

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
			this.registerEditorExtension(actionPalettePlugin);
			this.initializeStatusBar();
		});
	}

	private initializeStatusBar() {
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("local-gpt-status");
		this.statusBarItem.hide();
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
		this.addCommand({
			id: "context-menu",
			name: I18n.t("commands.showContextMenu"),
			editorCallback: (editor: Editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm;

				const cursorPositionFrom = editor.getCursor("from");
				const cursorPositionTo = editor.getCursor("to");

				const contextMenu = new Menu();

				this.settings.actions.forEach((action) => {
					contextMenu.addItem((item) => {
						item.setTitle(action.name).onClick(
							this.runAction.bind(this, action, editor),
						);
					});
				});

				const fromRect = editorView.coordsAtPos(
					editor.posToOffset(cursorPositionFrom),
				);
				const toRect = editorView.coordsAtPos(
					editor.posToOffset(cursorPositionTo),
				);
				contextMenu.showAtPosition({
					x: fromRect.left,
					y: toRect.top + (editorView.defaultLineHeight || 0),
				});
			},
		});

		this.settings.actions.forEach((action, index) => {
			this.addCommand({
				id: `quick-access-${index + 1}`,
				name: `${index + 1} | ${action.name}`,
				editorCallback: (editor: Editor) => {
					this.runAction(action, editor);
				},
			});
		});

		this.addCommand({
			id: "local-gpt-action-palette",
			name: I18n.t("commands.actionPalette.name"),
			editorCallback: async (editor: Editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm;
				const cursorPositionFrom = editor.getCursor("from");
				const insertPos = editor.posToOffset({
					line: cursorPositionFrom.line,
					ch: 0,
				});

				let modelLabel = "";
				let currentProviderId: string | undefined;
				try {
					const aiRequestWaiter = await waitForAI();
					const aiProviders: IAIProvidersService =
						await aiRequestWaiter.promise;
					const selectedProviderId =
						this.actionPaletteProviderId ||
						this.settings.aiProviders.main;
					const provider = aiProviders.providers.find(
						(p: IAIProvider) => p.id === selectedProviderId,
					);
					if (provider) {
						currentProviderId = provider.id;
						const modelToShow =
							this.actionPaletteModelProviderId === provider.id
								? this.actionPaletteModel || provider.model
								: provider.model;
						// Compose creativity label for badge
						const creativityKey =
							this.actionPaletteCreativityKey ??
							this.settings.defaults.creativity ??
							"";
						const creativityLabelMap: Record<string, string> = {
							"": I18n.t("settings.creativityNone"),
							low: I18n.t("settings.creativityLow"),
							medium: I18n.t("settings.creativityMedium"),
							high: I18n.t("settings.creativityHigh"),
						};
						const creativityLabel =
							creativityLabelMap[creativityKey] || "";

						modelLabel = [
							provider.name,
							modelToShow,
							creativityLabel,
						]
							.filter(Boolean)
							.join(" · ");
					}
				} catch (e) {
					void e;
				}

				showActionPalette(editorView, insertPos, {
					onSubmit: (
						text: string,
						selectedFiles: string[] = [],
						systemPrompt?: string,
					) => {
						const overrideProviderId =
							this.actionPaletteProviderId ||
							this.settings.aiProviders.main;
						// Palette-only creativity override
						const creativityKey =
							this.actionPaletteCreativityKey ??
							this.settings.defaults.creativity ??
							"";
						const temperatureOverride = (CREATIVITY as any)[
							creativityKey
						]?.temperature as number | undefined;

						this.runFreeform(
							editor,
							text,
							selectedFiles,
							overrideProviderId,
							temperatureOverride,
							systemPrompt,
						).finally(() => {});

						hideActionPalette(editorView);
						this.app.workspace.updateOptions();
					},
					onCancel: () => {
						hideActionPalette(editorView);
						this.app.workspace.updateOptions();
					},
					placeholder: I18n.t("commands.actionPalette.placeholder"),
					modelLabel: modelLabel,
					providerId: currentProviderId,
					getFiles: () => {
						return this.app.vault
							.getMarkdownFiles()
							.concat(
								this.app.vault
									.getFiles()
									.filter((f) => f.extension === "pdf"),
							)
							.map((file) => ({
								path: file.path,
								basename: file.basename,
								extension: file.extension,
							}));
					},
					getProviders: async () => {
						try {
							const aiRequestWaiter = await waitForAI();
							const aiProviders: IAIProvidersService =
								await aiRequestWaiter.promise;

							return aiProviders.providers
								.filter((p) => Boolean(p.model))
								.map((p) => ({
									id: p.id,
									name:
										p.model ||
										I18n.t(
											"commands.actionPalette.unknownModel",
										),
									providerName: p.name,
									providerUrl:
										(p as unknown as { url?: string })
											.url || "",
								}));
						} catch (error) {
							console.error("Error fetching models:", error);
							return [];
						}
					},
					getModels: async (providerId: string) => {
						try {
							const aiRequestWaiter = await waitForAI();
							const aiProviders: IAIProvidersService =
								await aiRequestWaiter.promise;
							const provider = aiProviders.providers.find(
								(p: IAIProvider) => p.id === providerId,
							);
							if (!provider) return [];
							const models =
								provider.availableModels ||
								(await aiProviders.fetchModels(provider));
							return models.map((m) => ({ id: m, name: m }));
						} catch (error) {
							console.error("Error fetching models:", error);
							return [];
						}
					},
					onProviderChange: async (providerId: string) => {
						// Only override Action Palette provider, keep settings unchanged
						this.actionPaletteProviderId = providerId;
						this.actionPaletteModel = null;
						this.actionPaletteModelProviderId = null;
					},
					onModelChange: async (model: string) => {
						const providerId =
							this.actionPaletteProviderId ||
							this.settings.aiProviders.main;
						this.actionPaletteModel = model;
						this.actionPaletteModelProviderId = providerId;
					},
					onCreativityChange: async (creativityKey: string) => {
						// Only override Action Palette creativity, keep settings unchanged
						this.actionPaletteCreativityKey = creativityKey;
					},
					getSystemPrompts: () => {
						return this.settings.actions
							.filter((action) => action.system)
							.map((action) => ({
								name: action.name,
								system: action.system!,
							}));
					},
				});
				this.app.workspace.updateOptions();
			},
		});

		// Add PWA Creator command
		this.addCommand({
			id: "create-pwa",
			name: "Create Progressive Web App",
			callback: () => {
				new PWACreatorModal(this.app, (config: PWAConfig) => {
					console.log("PWA created with config:", config);
				}).open();
			},
		});
	}

	private async runFreeform(
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
		},
		editor: Editor,
	) {
		const {
			editorView,
			cursorPositionFrom,
			cursorPositionTo,
			cursorOffsetTo,
			selectedTextRef,
		} = this.extractSelectionContext(editor);
		const { abortController, hideSpinner, onUpdate } =
			this.createExecutionContext(
				editorView,
				cursorOffsetTo,
				selectedTextRef,
			);

		const { cleanedText, imagesInBase64 } =
			await this.extractImagesFromSelection(selectedTextRef.value);
		selectedTextRef.value = cleanedText;

		logger.time("Processing Embeddings");
		logger.timeEnd("Processing Embeddings");
		logger.debug("Selected text", cleanedText);

		const aiRequestWaiter = await waitForAI();
		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;

		const embeddingProvider = aiProviders.providers.find(
			(provider: IAIProvider) =>
				provider.id === this.settings.aiProviders.embedding,
		);

		const context = await this.enhanceWithContext(
			cleanedText,
			aiProviders,
			embeddingProvider,
			abortController,
			params.selectedFiles,
		);

		const provider = this.selectProvider(
			aiProviders,
			imagesInBase64.length > 0,
			params.overrideProviderId,
		);
		const adjustedProvider = this.overrideProviderModel(provider, params);

		let fullText = "";
		try {
			fullText = await this.executeProviderRequest(
				aiProviders,
				adjustedProvider,
				params,
				cleanedText,
				context,
				imagesInBase64,
				abortController,
				onUpdate,
			);
		} finally {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
		}

		if (abortController.signal.aborted) {
			return;
		}

		const finalText = removeThinkingTags(fullText).trim();
		this.applyTextResult(
			editor,
			params.replace,
			finalText,
			selectedTextRef.value,
			cursorPositionFrom,
			cursorPositionTo,
		);
	}

	private extractSelectionContext(editor: Editor) {
		// @ts-expect-error, not typed
		const editorView = editor.cm;
		const selection = editor.getSelection();
		const selectedTextRef = { value: selection || editor.getValue() };
		const cursorPositionFrom = editor.getCursor("from");
		const cursorPositionTo = editor.getCursor("to");
		const cursorOffsetTo = editor.posToOffset(cursorPositionTo);

		return {
			editorView,
			cursorPositionFrom,
			cursorPositionTo,
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
			spinner.processText(updatedString, (text: string) =>
				this.processText(text, selectedTextRef.value),
			);
			this.app.workspace.updateOptions();
		};

		return { abortController, hideSpinner, onUpdate };
	}

	private async extractImagesFromSelection(
		selectedText: string,
	): Promise<{ cleanedText: string; imagesInBase64: string[] }> {
		const regexp = /!\[\[(.+?\.(?:png|jpe?g))]]/gi;
		const fileNames = Array.from(
			selectedText.matchAll(regexp),
			(match) => match[1],
		);

		const cleanedText = selectedText.replace(regexp, "");
		const imagesInBase64 =
			(
				await Promise.all<string>(
					fileNames.map((fileName) =>
						this.readImageAsDataUrl(fileName),
					),
				)
			).filter(Boolean) || [];

		return { cleanedText, imagesInBase64 };
	}

	private async readImageAsDataUrl(fileName: string): Promise<string> {
		const filePath = this.app.metadataCache.getFirstLinkpathDest(
			fileName,
			// @ts-ignore
			this.app.workspace.getActiveFile().path,
		);

		if (!filePath) {
			return "";
		}

		return this.app.vault.adapter
			.readBinary(filePath.path)
			.then((buffer) => {
				const extension = filePath.extension.toLowerCase();
				const mimeType = extension === "jpg" ? "jpeg" : extension;
				const blob = new Blob([buffer], {
					type: `image/${mimeType}`,
				});
				return new Promise((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(blob);
				});
			});
	}

	private selectProvider(
		aiProviders: IAIProvidersService,
		hasImages: boolean,
		overrideProviderId?: string | null,
	): IAIProvider {
		const visionCandidate = hasImages
			? aiProviders.providers.find(
					(p: IAIProvider) =>
						p.id === this.settings.aiProviders.vision,
				)
			: undefined;
		const preferredProviderId =
			overrideProviderId || this.settings.aiProviders.main;
		const fallback = aiProviders.providers.find(
			(p) => p.id === preferredProviderId,
		);

		const provider = visionCandidate || fallback;
		if (!provider) {
			throw new Error("No AI provider found");
		}
		return provider;
	}

	private overrideProviderModel(
		provider: IAIProvider,
		params: {
			overrideProviderId?: string | null;
		},
	): IAIProvider {
		if (
			this.actionPaletteModel &&
			params.overrideProviderId &&
			this.actionPaletteModelProviderId === params.overrideProviderId
		) {
			return { ...provider, model: this.actionPaletteModel };
		}
		return provider;
	}

	private async executeProviderRequest(
		aiProviders: IAIProvidersService,
		provider: IAIProvider,
		params: { prompt: string; system?: string; temperature?: number },
		selectedText: string,
		context: string,
		imagesInBase64: string[],
		abortController: AbortController,
		onUpdate: (updatedString: string) => void,
	): Promise<string> {
		try {
			return await aiProviders.execute({
				provider,
				prompt: preparePrompt(params.prompt, selectedText, context),
				images: imagesInBase64,
				systemPrompt: params.system,
				options: {
					temperature:
						params.temperature ??
						CREATIVITY[this.settings.defaults.creativity]
							.temperature,
				},
				onProgress: (_chunk: string, accumulatedText: string) => {
					onUpdate(accumulatedText);
				},
				abortController,
			});
		} catch (error) {
			if (!abortController.signal.aborted) {
				new Notice(
					I18n.t("notices.errorGenerating", {
						message: (error as any).message,
					}),
				);
			}
			logger.separator();
			return "";
		}
	}

	private applyTextResult(
		editor: Editor,
		replaceSelection: boolean | undefined,
		finalText: string,
		selectedText: string,
		cursorPositionFrom: any,
		cursorPositionTo: any,
	) {
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
		selectedFiles?: string[],
	): Promise<string> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !aiProvider || abortController?.signal.aborted) {
			return "";
		}

		const allLinkedFiles = this.collectLinkedFilesForContext(
			selectedText,
			selectedFiles,
			activeFile.path,
		);
		if (allLinkedFiles.length === 0) {
			return "";
		}

		try {
			this.initializeProgress();

			const processedDocs = await startProcessing(
				allLinkedFiles,
				this.app.vault,
				this.app.metadataCache,
				activeFile,
				this.updateCompletedSteps.bind(this),
			);

			if (this.shouldAbortProcessing(processedDocs, abortController)) {
				return this.finishContextProcessing("");
			}

			const retrieveDocuments = Array.from(processedDocs.values());

			if (abortController?.signal.aborted) {
				return this.finishContextProcessing("");
			}

			const contextLimit = this.resolveContextLimit();

			const relevantContext = await searchDocuments(
				selectedText,
				retrieveDocuments,
				aiProviders,
				aiProvider,
				abortController,
				this.updateCompletedSteps.bind(this),
				this.addTotalProgressSteps.bind(this),
				contextLimit,
			);

			return this.finishContextProcessing(relevantContext.trim() || "");
		} catch (error) {
			return this.handleContextError(error, abortController);
		}
	}

	private collectLinkedFilesForContext(
		selectedText: string,
		selectedFiles: string[] | undefined,
		activeFilePath: string,
	): TFile[] {
		const linkedFiles = getLinkedFiles(
			selectedText,
			this.app.vault,
			this.app.metadataCache,
			activeFilePath,
		);

		const additionalFiles =
			selectedFiles
				?.map((filePath) =>
					this.app.vault.getAbstractFileByPath(filePath),
				)
				.filter(
					(file): file is TFile =>
						file !== null &&
						file instanceof TFile &&
						(file.extension === "md" || file.extension === "pdf"),
				) || [];

		return [...linkedFiles, ...additionalFiles];
	}

	private shouldAbortProcessing(
		processedDocs: Map<string, IAIDocument>,
		abortController: AbortController,
	): boolean {
		return processedDocs.size === 0 || abortController?.signal.aborted;
	}

	private resolveContextLimit(): number {
		const preset = this.settings?.defaults?.contextLimit as
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

	private finishContextProcessing(result: string): string {
		this.hideStatusBar();
		return result;
	}

	private handleContextError(
		error: unknown,
		abortController: AbortController,
	): string {
		this.hideStatusBar();
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

	onunload() {
		document.removeEventListener("keydown", this.escapeHandler);
		window.clearInterval(this.updatingInterval);
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
		}
	}

	async loadSettings() {
		const loadedData: LocalGPTSettings | undefined = await this.loadData();
		const { settings, changed } = await this.migrateSettings(loadedData);

		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);

		if (changed) {
			await this.saveData(this.settings);
		}
	}

	// Legacy provider defaults used by older settings migrations
	private readonly legacyDefaultProviders = {
		ollama: {
			url: "http://localhost:11434",
			defaultModel: "gemma2",
			embeddingModel: "",
			type: "ollama",
		},
		ollama_fallback: {
			url: "http://localhost:11434",
			defaultModel: "gemma2",
			embeddingModel: "",
			type: "ollama",
		},
		openaiCompatible: {
			url: "http://localhost:8080/v1",
			apiKey: "",
			embeddingModel: "",
			type: "openaiCompatible",
		},
		openaiCompatible_fallback: {
			url: "http://localhost:8080/v1",
			apiKey: "",
			embeddingModel: "",
			type: "openaiCompatible",
		},
	} as const;

	private async migrateSettings(
		loadedData?: LocalGPTSettings,
	): Promise<{ settings?: LocalGPTSettings; changed: boolean }> {
		if (!loadedData) {
			return { settings: loadedData, changed: false };
		}

		let changed = false;
		changed = this.migrateToVersion2(loadedData) || changed;
		changed = this.migrateToVersion3(loadedData) || changed;
		changed = this.migrateToVersion4(loadedData) || changed;
		changed = this.migrateToVersion5(loadedData) || changed;
		changed = this.migrateToVersion6(loadedData) || changed;
		changed = (await this.migrateToVersion7(loadedData)) || changed;
		changed = this.migrateToVersion8(loadedData) || changed;

		return { settings: loadedData, changed };
	}

	private migrateToVersion2(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 1) {
			return false;
		}

		const providers: Record<string, any> = JSON.parse(
			JSON.stringify(this.legacyDefaultProviders),
		);

		(settings as any).providers = providers;
		(settings as any).providers.ollama.ollamaUrl = (
			settings as any
		).ollamaUrl;
		delete (settings as any).ollamaUrl;
		(settings as any).providers.ollama.defaultModel = (
			settings as any
		).defaultModel;
		delete (settings as any).defaultModel;
		(settings as any).providers.openaiCompatible &&
			((settings as any).providers.openaiCompatible.apiKey = "");

		settings._version = 2;
		return true;
	}

	private migrateToVersion3(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 3) {
			return false;
		}
		(settings as any).defaultProvider =
			(settings as any).selectedProvider || "ollama";
		delete (settings as any).selectedProvider;

		const providers = (settings as any).providers;
		if (providers) {
			Object.keys(providers).forEach((key) => {
				providers[key].type = key;
			});
		}

		settings._version = 3;
		return true;
	}

	private migrateToVersion4(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 4) {
			return false;
		}

		(settings as any).defaults = {
			provider: (settings as any).defaultProvider || "ollama",
			fallbackProvider: (settings as any).fallbackProvider || "",
			creativity: "low",
		};
		delete (settings as any).defaultProvider;
		delete (settings as any).fallbackProvider;

		settings._version = 4;
		return true;
	}

	private migrateToVersion5(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 5) {
			return false;
		}

		const providers = (settings as any).providers;
		if (providers) {
			Object.keys(this.legacyDefaultProviders).forEach((provider) => {
				if (providers[provider]) {
					providers[provider].embeddingModel = (
						this.legacyDefaultProviders as any
					)[provider].embeddingModel;
				}
			});
		}

		settings._version = 5;
		setTimeout(() => {
			new Notice(
				`🎉 LocalGPT can finally use\ncontext from links!\nCheck the Settings!`,
				0,
			);
		}, 10000);
		return true;
	}

	private migrateToVersion6(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 6) {
			return false;
		}

		const providers = (settings as any).providers;
		if (providers) {
			Object.keys(this.legacyDefaultProviders).forEach((provider) => {
				if (providers[provider]?.type === "ollama") {
					providers[provider].url = providers[provider].ollamaUrl;
					delete providers[provider].ollamaUrl;
				}
				if (providers[provider]?.type === "openaiCompatible") {
					providers[provider].url =
						providers[provider].url.replace(/\/+$/i, "") + "/v1";
				}
			});
		}

		settings._version = 6;
		return true;
	}

	private async migrateToVersion7(
		settings: LocalGPTSettings,
	): Promise<boolean> {
		if (settings._version && settings._version >= 7) {
			return false;
		}

		new Notice(I18n.t("notices.importantUpdate"), 0);
		const aiRequestWaiter = await waitForAI();
		const aiProviders = await aiRequestWaiter.promise;

		settings.aiProviders = {
			main: null,
			embedding: null,
			vision: null,
		};

		const oldProviders = (settings as any).providers;
		const oldDefaults = (settings as any).defaults;

		if (oldProviders && oldDefaults?.provider) {
			await this.migrateLegacyProviderConfig(
				settings,
				aiProviders,
				oldProviders,
				oldDefaults,
			);
		}

		delete (settings as any).defaults;
		delete (settings as any).providers;

		settings._version = 7;
		return true;
	}

	private async migrateLegacyProviderConfig(
		settings: LocalGPTSettings,
		aiProviders: any,
		oldProviders: Record<string, any>,
		oldDefaults: Record<string, any>,
	) {
		const provider = oldDefaults.provider;
		const typesMap: { [key: string]: string } = {
			ollama: "ollama",
			openaiCompatible: "openai",
		};

		const providerConfig = oldProviders[provider];
		if (!providerConfig) {
			return;
		}
		const type = typesMap[providerConfig.type];
		await this.createMigratedProvider(
			settings,
			aiProviders,
			provider,
			providerConfig,
			type,
			"main",
			providerConfig.defaultModel,
		);
		await this.createMigratedProvider(
			settings,
			aiProviders,
			provider,
			providerConfig,
			type,
			"embedding",
			providerConfig.embeddingModel,
		);
	}

	private async createMigratedProvider(
		settings: LocalGPTSettings,
		aiProviders: any,
		provider: string,
		providerConfig: any,
		type: string,
		targetKey: "main" | "embedding",
		model?: string,
	) {
		if (!model) {
			return;
		}
		let adjustedModel = model;
		if (type === "ollama" && !adjustedModel.endsWith(":latest")) {
			adjustedModel = `${adjustedModel}:latest`;
		}
		const id = `id-${Date.now().toString()}`;
		const newProvider = await (aiProviders as any).migrateProvider({
			id,
			name:
				targetKey === "main"
					? `Local GPT ${provider}`
					: `Local GPT ${provider} embeddings`,
			apiKey: providerConfig.apiKey,
			url: providerConfig.url,
			type,
			model: adjustedModel,
		});

		if (newProvider) {
			settings.aiProviders[targetKey] = newProvider.id;
		}
	}

	private migrateToVersion8(settings: LocalGPTSettings): boolean {
		if (settings._version && settings._version >= 8) {
			return false;
		}

		(settings as any).defaults = (settings as any).defaults || {};
		(settings as any).defaults.contextLimit =
			(settings as any).defaults.contextLimit || "local";

		settings._version = 8;
		return true;
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
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
		this.displayedPercentage = 0;
		this.baseSpeed = 0;
		this.lastTargetUpdateTime = null;
		this.lastFrameTime = null;
		this.progressFinished = false;
		this.stopAnimation();
		this.statusBarItem.show();
		this.updateStatusBar();
	}

	private addTotalProgressSteps(steps: number) {
		this.totalProgressSteps += steps;
		this.updateProgressBar();
	}

	private updateCompletedSteps(steps: number) {
		this.completedProgressSteps += steps;
		// Maintain invariant: total >= completed (dynamic totals may appear late)
		if (this.completedProgressSteps > this.totalProgressSteps) {
			this.totalProgressSteps = this.completedProgressSteps;
		}
		this.updateProgressBar();
	}

	private updateProgressBar() {
		const newTarget = this.calculateTargetPercentage();
		if (newTarget === this.targetPercentage) {
			return;
		}
		const now = performance.now();
		this.baseSpeed = this.calculateBaseSpeed(newTarget, now);
		this.targetPercentage = newTarget;
		this.lastTargetUpdateTime = now;
		this.ensureAnimationLoop();
	}

	private calculateTargetPercentage(): number {
		if (this.totalProgressSteps <= 0) {
			return 0;
		}
		const ratio = Math.min(
			this.completedProgressSteps / this.totalProgressSteps,
			1,
		);
		return Math.floor(ratio * 100);
	}

	private calculateBaseSpeed(newTarget: number, now: number): number {
		if (this.lastTargetUpdateTime === null) {
			return this.baseSpeed;
		}
		const dt = now - this.lastTargetUpdateTime;
		const diff = newTarget - this.targetPercentage;
		if (dt <= 0 || diff <= 0) {
			return this.baseSpeed;
		}
		const instantaneous = diff / dt;
		const blended =
			this.baseSpeed === 0
				? instantaneous
				: this.baseSpeed * 0.75 + instantaneous * 0.25;

		return Math.min(MAX_BASE_SPEED, Math.max(MIN_BASE_SPEED, blended));
	}

	private ensureAnimationLoop() {
		if (this.frameId !== null) {
			return;
		}
		this.lastFrameTime = null;
		this.frameId = requestAnimationFrame(this.animationLoop);
	}

	private updateStatusBar() {
		const shown = this.progressFinished
			? this.currentPercentage
			: Math.min(this.currentPercentage, 99);
		this.statusBarItem.setAttr(
			"data-text",
			shown
				? I18n.t("statusBar.enhancingWithProgress", {
						percent: String(shown),
					})
				: I18n.t("statusBar.enhancing"),
		);
		this.statusBarItem.setText(` `);
	}

	private animationLoop = (time: number) => {
		if (this.lastFrameTime === null) {
			this.lastFrameTime = time;
		}
		const delta = time - this.lastFrameTime;
		this.lastFrameTime = time;
		const target = this.targetPercentage;
		if (delta > 0 && this.displayedPercentage < target) {
			let speed = this.baseSpeed;
			if (speed === 0) {
				// Initial guess: reach target in ~400ms
				speed = (target - this.displayedPercentage) / 400;
			}
			this.displayedPercentage = Math.min(
				target,
				this.displayedPercentage + speed * delta,
			);
			const rounded = Math.floor(this.displayedPercentage);
			if (rounded !== this.currentPercentage) {
				this.currentPercentage = rounded;
				this.updateStatusBar();
			}
		}
		if (this.displayedPercentage >= target) {
			this.displayedPercentage = target;
			this.currentPercentage = target;
			this.updateStatusBar();
		}
		if (
			this.currentPercentage < this.targetPercentage ||
			this.displayedPercentage < this.targetPercentage
		) {
			this.frameId = requestAnimationFrame(this.animationLoop);
			return;
		}
		this.stopAnimation();
	};

	private stopAnimation() {
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
		}
		this.frameId = null;
		this.lastFrameTime = null;
	}

	private hideStatusBar() {
		this.statusBarItem.hide();
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
		this.displayedPercentage = 0;
		this.baseSpeed = 0;
		this.lastTargetUpdateTime = null;
		this.lastFrameTime = null;
		this.progressFinished = false;
		this.stopAnimation();
	}

	private markProgressFinished() {
		if (this.progressFinished) {
			return;
		}
		this.progressFinished = true;
		this.currentPercentage = 100;
		this.displayedPercentage = 100;
		this.targetPercentage = 100;
		this.updateStatusBar();
	}
}
