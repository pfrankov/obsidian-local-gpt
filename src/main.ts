import { Editor, Menu, Notice, Plugin, requestUrl, TFile } from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "./spinnerPlugin";
import {
	actionPalettePlugin,
	showActionPalette,
	hideActionPalette,
} from "./ui/actionPalettePlugin";
import { LocalGPTAction, LocalGPTSettings } from "./interfaces";

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
					onSubmit: (text: string, selectedFiles: string[] = []) => {
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
									name: p.model || "Unknown Model",
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
				});
				this.app.workspace.updateOptions();
			},
		});
	}

	private async runFreeform(
		editor: Editor,
		userInput: string,
		selectedFiles: string[] = [],
		overrideProviderId?: string | null,
		customTemperature?: number,
	) {
		return this.executeAction(
			{
				prompt: userInput,
				system: undefined,
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
		// @ts-expect-error, not typed
		const editorView = editor.cm;

		const selection = editor.getSelection();
		let selectedText = selection || editor.getValue();
		const cursorPositionFrom = editor.getCursor("from");
		const cursorPositionTo = editor.getCursor("to");

		const abortController = new AbortController();
		this.abortControllers.push(abortController);

		const spinner = editorView.plugin(spinnerPlugin) || undefined;
		const hideSpinner = spinner?.show(editor.posToOffset(cursorPositionTo));
		this.app.workspace.updateOptions();

		abortController.signal.addEventListener("abort", () => {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
		});

		const onUpdate = (updatedString: string) => {
			spinner.processText(updatedString, (text: string) =>
				this.processText(text, selectedText),
			);
			this.app.workspace.updateOptions();
		};

		const regexp = /!\[\[(.+?\.(?:png|jpe?g))]]/gi;
		const fileNames = Array.from(
			selectedText.matchAll(regexp),
			(match) => match[1],
		);

		selectedText = selectedText.replace(regexp, "");

		const imagesInBase64 =
			(
				await Promise.all<string>(
					fileNames.map((fileName) => {
						const filePath =
							this.app.metadataCache.getFirstLinkpathDest(
								fileName,
								// @ts-ignore
								this.app.workspace.getActiveFile().path,
							);

						if (!filePath) {
							return Promise.resolve("");
						}

						return this.app.vault.adapter
							.readBinary(filePath.path)
							.then((buffer) => {
								const extension =
									filePath.extension.toLowerCase();
								const mimeType =
									extension === "jpg" ? "jpeg" : extension;
								const blob = new Blob([buffer], {
									type: `image/${mimeType}`,
								});
								return new Promise((resolve) => {
									const reader = new FileReader();
									reader.onloadend = () =>
										resolve(reader.result as string);
									reader.readAsDataURL(blob);
								});
							});
					}),
				)
			).filter(Boolean) || [];

		logger.time("Processing Embeddings");

		logger.timeEnd("Processing Embeddings");
		logger.debug("Selected text", selectedText);

		const aiRequestWaiter = await waitForAI();

		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;

		const context = await this.enhanceWithContext(
			selectedText,
			aiProviders,
			aiProviders.providers.find(
				(provider: IAIProvider) =>
					provider.id === this.settings.aiProviders.embedding,
			),
			abortController,
			params.selectedFiles,
		);

		// Select provider: prefer vision when images are present; otherwise use override or default main
		let provider: IAIProvider | undefined;
		if (imagesInBase64.length) {
			provider = aiProviders.providers.find(
				(p: IAIProvider) => p.id === this.settings.aiProviders.vision,
			);
		}
		if (!provider) {
			const preferredProviderId =
				params.overrideProviderId || this.settings.aiProviders.main;
			provider = aiProviders.providers.find(
				(p) => p.id === preferredProviderId,
			);
		}

		if (!provider) {
			throw new Error("No AI provider found");
		}

		if (
			this.actionPaletteModel &&
			params.overrideProviderId &&
			this.actionPaletteModelProviderId === params.overrideProviderId
		) {
			provider = { ...provider, model: this.actionPaletteModel };
		}

		let fullText = "";
		try {
			fullText = await aiProviders.execute({
				provider,
				prompt: preparePrompt(params.prompt, selectedText, context),
				images: imagesInBase64,
				systemPrompt: params.system,
				options: {
					temperature:
						params.temperature ||
						CREATIVITY[this.settings.defaults.creativity]
							.temperature,
				},
				onProgress: (chunk: string, accumulatedText: string) => {
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
		} finally {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
		}

		if (abortController.signal.aborted) {
			return;
		}

		// Remove any thinking tags from the final text
		const finalText = removeThinkingTags(fullText).trim();

		if (params.replace) {
			editor.replaceRange(
				finalText,
				cursorPositionFrom,
				cursorPositionTo,
			);
		} else {
			const isLastLine = editor.lastLine() === cursorPositionTo.line;
			const text = this.processText(finalText, selectedText);
			editor.replaceRange(isLastLine ? "\n" + text : text, {
				ch: 0,
				line: cursorPositionTo.line + 1,
			});
		}
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

		const linkedFiles = getLinkedFiles(
			selectedText,
			this.app.vault,
			this.app.metadataCache,
			activeFile.path,
		);

		// Add files selected via @ mention in Action Palette
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

		const allLinkedFiles = [...linkedFiles, ...additionalFiles];

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

			if (processedDocs.size === 0 || abortController?.signal.aborted) {
				this.hideStatusBar();
				return "";
			}

			const retrieveDocuments = Array.from(processedDocs.values());

			if (abortController?.signal.aborted) {
				this.hideStatusBar();
				return "";
			}

			const contextLimit = (() => {
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
			})();

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

			this.hideStatusBar();
			return relevantContext.trim() || "";
		} catch (error) {
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
	}

	onunload() {
		document.removeEventListener("keydown", this.escapeHandler);
		window.clearInterval(this.updatingInterval);
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId);
		}
	}

	async loadSettings() {
		const loadedData: LocalGPTSettings = await this.loadData();
		let needToSave = false;

		// Migration
		if (loadedData) {
			const oldDefaultProviders = {
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
			};

			if (!loadedData._version || loadedData._version < 1) {
				needToSave = true;

				(loadedData as any).providers = oldDefaultProviders;
				(loadedData as any).providers.ollama.ollamaUrl = (
					loadedData as any
				).ollamaUrl;
				delete (loadedData as any).ollamaUrl;
				(loadedData as any).providers.ollama.defaultModel = (
					loadedData as any
				).defaultModel;
				delete (loadedData as any).defaultModel;
				(loadedData as any).providers.openaiCompatible &&
					((loadedData as any).providers.openaiCompatible.apiKey =
						"");

				loadedData._version = 2;
			}

			if (loadedData._version < 3) {
				needToSave = true;
				(loadedData as any).defaultProvider =
					(loadedData as any).selectedProvider || "ollama";
				delete (loadedData as any).selectedProvider;

				const providers = (loadedData as any).providers;
				if (providers) {
					Object.keys(providers).forEach((key) => {
						providers[key].type = key;
					});
				}

				loadedData._version = 3;
			}

			if (loadedData._version < 4) {
				needToSave = true;
				(loadedData as any).defaults = {
					provider: (loadedData as any).defaultProvider || "ollama",
					fallbackProvider:
						(loadedData as any).fallbackProvider || "",
					creativity: "low",
				};
				delete (loadedData as any).defaultProvider;
				delete (loadedData as any).fallbackProvider;

				loadedData._version = 4;
			}

			if (loadedData._version < 5) {
				needToSave = true;

				const providers = (loadedData as any).providers;
				if (providers) {
					Object.keys(oldDefaultProviders).forEach((provider) => {
						if (providers[provider]) {
							providers[provider].embeddingModel = (
								oldDefaultProviders as any
							)[provider].embeddingModel;
						}
					});
				}

				loadedData._version = 5;
				setTimeout(() => {
					new Notice(
						`🎉 LocalGPT can finally use\ncontext from links!\nCheck the Settings!`,
						0,
					);
				}, 10000);
			}

			if (loadedData._version < 6) {
				needToSave = true;
				const providers = (loadedData as any).providers;
				if (providers) {
					Object.keys(oldDefaultProviders).forEach((provider) => {
						if (providers[provider]?.type === "ollama") {
							providers[provider].url =
								providers[provider].ollamaUrl;
							delete providers[provider].ollamaUrl;
						}
						if (providers[provider]?.type === "openaiCompatible") {
							providers[provider].url =
								providers[provider].url.replace(/\/+$/i, "") +
								"/v1";
						}
					});
				}

				loadedData._version = 6;
			}

			if (loadedData._version < 7) {
				needToSave = true;

				new Notice(I18n.t("notices.importantUpdate"), 0);

				const aiRequestWaiter = await waitForAI();
				const aiProviders = await aiRequestWaiter.promise;

				loadedData.aiProviders = {
					main: null,
					embedding: null,
					vision: null,
				};

				const oldProviders = (loadedData as any).providers;
				const oldDefaults = (loadedData as any).defaults;

				if (oldProviders && oldDefaults?.provider) {
					const provider = oldDefaults.provider;
					const typesMap: { [key: string]: string } = {
						ollama: "ollama",
						openaiCompatible: "openai",
					};

					const providerConfig = oldProviders[provider];
					if (providerConfig) {
						const type = typesMap[providerConfig.type];

						if (providerConfig.defaultModel) {
							let model = providerConfig.defaultModel;
							if (
								type === "ollama" &&
								!model.endsWith(":latest")
							) {
								model = model + ":latest";
							}

							const id = `id-${Date.now().toString()}`;
							const newProvider = await (
								aiProviders as any
							).migrateProvider({
								id,
								name: `Local GPT ${provider}`,
								apiKey: providerConfig.apiKey,
								url: providerConfig.url,
								type,
								model,
							});

							if (newProvider) {
								loadedData.aiProviders.main = newProvider.id;
							}
						}

						if (providerConfig.embeddingModel) {
							let model = providerConfig.embeddingModel;
							if (
								type === "ollama" &&
								!model.endsWith(":latest")
							) {
								model = model + ":latest";
							}

							const id = `id-${Date.now().toString()}`;
							const newProvider = await (
								aiProviders as any
							).migrateProvider({
								id,
								name: `Local GPT ${provider} embeddings`,
								apiKey: providerConfig.apiKey,
								url: providerConfig.url,
								type,
								model,
							});

							if (newProvider) {
								loadedData.aiProviders.embedding =
									newProvider.id;
							}
						}
					}
				}

				delete (loadedData as any).defaults;
				delete (loadedData as any).providers;

				loadedData._version = 7;
			}

			// v8: introduce defaults.contextLimit preset for Enhanced Actions
			if (loadedData._version < 8) {
				needToSave = true;
				// Keep current behavior equivalent to "local" preset
				(loadedData as any).defaults =
					(loadedData as any).defaults || {};
				(loadedData as any).defaults.contextLimit =
					(loadedData as any).defaults.contextLimit || "local";

				loadedData._version = 8;
			}
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		if (needToSave) {
			await this.saveData(this.settings);
		}
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
		let ratio = 0;
		if (this.totalProgressSteps > 0) {
			ratio = this.completedProgressSteps / this.totalProgressSteps;
		}
		if (ratio > 1) {
			ratio = 1; // safety clamp, logical invariant already enforced
		}
		const newTarget = Math.floor(ratio * 100);
		if (newTarget === this.targetPercentage) {
			return;
		}
		const now = performance.now();
		if (this.lastTargetUpdateTime !== null) {
			const dt = now - this.lastTargetUpdateTime;
			const diff = newTarget - this.targetPercentage;
			if (dt > 0 && diff > 0) {
				const instantaneous = diff / dt;
				const alpha = 0.25; // smoothing factor
				if (this.baseSpeed === 0) {
					this.baseSpeed = instantaneous;
				} else {
					this.baseSpeed =
						this.baseSpeed * (1 - alpha) + instantaneous * alpha;
				}
				// Clamp speed to avoid extreme jumps
				const MIN = 0.02 / 16; // ~0.02% per frame at 60fps
				const MAX = 3 / 16; // ~3% per frame at 60fps
				if (this.baseSpeed < MIN) {
					this.baseSpeed = MIN;
				}
				if (this.baseSpeed > MAX) {
					this.baseSpeed = MAX;
				}
			}
		}
		this.targetPercentage = newTarget;
		this.lastTargetUpdateTime = now;
		if (this.frameId === null) {
			this.lastFrameTime = null;
			this.frameId = requestAnimationFrame(this.animationLoop);
		}
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
