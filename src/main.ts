import { Editor, Menu, Notice, Plugin, requestUrl } from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "./spinnerPlugin";
import { LocalGPTAction, LocalGPTSettings } from "./interfaces";

import { getLinkedFiles, startProcessing, searchDocuments } from "./rag";
import { logger } from "./logger";
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
	abortControllers: AbortController[] = [];
	updatingInterval: number;
	private statusBarItem: HTMLElement;
	private currentPercentage: number = 0;
	private targetPercentage: number = 0;
	private animationFrameId: number | null = null;
	private totalProgressSteps: number = 0;
	private completedProgressSteps: number = 0;

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
			name: "Show context menu",
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
	}

	async runAction(action: LocalGPTAction, editor: Editor) {
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
		);

		let provider = aiProviders.providers.find(
			(p: IAIProvider) => p.id === this.settings.aiProviders.main,
		);
		if (imagesInBase64.length) {
			provider =
				aiProviders.providers.find(
					(p: IAIProvider) =>
						p.id === this.settings.aiProviders.vision,
				) || provider;
		}

		if (!provider) {
			throw new Error("No AI provider found");
		}

		const chunkHandler = await aiProviders.execute({
			provider,
			prompt: preparePrompt(action.prompt, selectedText, context),
			images: imagesInBase64,
			systemPrompt: action.system,
			options: {
				temperature:
					action.temperature ||
					CREATIVITY[this.settings.defaults.creativity].temperature,
			},
		});

		chunkHandler.onData((chunk: string, accumulatedText: string) => {
			onUpdate(accumulatedText);
		});

		chunkHandler.onEnd((fullText: string) => {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();

			// Remove any thinking tags from the final text
			const finalText = removeThinkingTags(fullText).trim();

			if (action.replace) {
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
		});

		chunkHandler.onError((error: Error) => {
			console.log("abort handled");
			if (!abortController.signal.aborted) {
				new Notice(`Error while generating text: ${error.message}`);
			}
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
			logger.separator();
		});

		abortController.signal.addEventListener("abort", () => {
			console.log("make abort");
			chunkHandler.abort();
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();
		});
	}

	async enhanceWithContext(
		selectedText: string,
		aiProviders: IAIProvidersService,
		aiProvider: IAIProvider | undefined,
		abortController: AbortController,
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
		if (linkedFiles.length === 0) {
			return "";
		}

		try {
			this.initializeProgress();

			// Add total steps: processing files + search
			this.addTotalProgressSteps(linkedFiles.length + 1);

			const processedDocs = await startProcessing(
				linkedFiles,
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

			const relevantContext = await searchDocuments(
				selectedText,
				retrieveDocuments,
				aiProviders,
				aiProvider,
				abortController,
				this.updateCompletedSteps.bind(this),
			);

			this.hideStatusBar();
			return relevantContext.trim() || "";
		} catch (error) {
			this.hideStatusBar();
			if (!abortController?.signal.aborted) {
				console.error("Error processing RAG:", error);
				new Notice(
					`Error processing related documents: ${error.message}. Continuing with original text.`,
				);
			}
			return "";
		}
	}

	onunload() {
		document.removeEventListener("keydown", this.escapeHandler);
		window.clearInterval(this.updatingInterval);
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
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

				new Notice("️🚨 IMPORTANT! Update Local GPT settings!", 0);

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
				new Notice(`⬆️ Local GPT: a new version is available`);
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
		this.statusBarItem.show();
		this.updateStatusBar();
	}

	private addTotalProgressSteps(steps: number) {
		this.totalProgressSteps += steps;
		this.updateProgressBar();
	}

	private updateCompletedSteps(steps: number) {
		this.completedProgressSteps += steps;
		this.updateProgressBar();
	}

	private updateProgressBar() {
		const newTargetPercentage =
			this.totalProgressSteps > 0
				? Math.round(
						(this.completedProgressSteps /
							this.totalProgressSteps) *
							100,
					)
				: 0;

		if (this.targetPercentage !== newTargetPercentage) {
			this.targetPercentage = newTargetPercentage;
			if (this.animationFrameId === null) {
				this.animatePercentage();
			}
		}
	}

	private updateStatusBar() {
		this.statusBarItem.setAttr(
			"data-text",
			this.currentPercentage
				? `✨ Enhancing ${this.currentPercentage}%`
				: "✨ Enhancing",
		);
		this.statusBarItem.setText(` `);
	}

	private animatePercentage() {
		const startTime = performance.now();
		const duration = 300;

		const animate = (currentTime: number) => {
			const elapsedTime = currentTime - startTime;
			const progress = Math.min(elapsedTime / duration, 1);

			this.currentPercentage = Math.round(
				this.currentPercentage +
					(this.targetPercentage - this.currentPercentage) * progress,
			);

			this.updateStatusBar();

			if (progress < 1) {
				this.animationFrameId = requestAnimationFrame(animate);
			} else {
				this.animationFrameId = null;
			}
		};

		this.animationFrameId = requestAnimationFrame(animate);
	}

	private hideStatusBar() {
		this.statusBarItem.hide();
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
	}
}
