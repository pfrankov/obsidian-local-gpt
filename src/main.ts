import { Editor, Notice, Plugin, Menu, requestUrl } from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "spinnerPlugin";
import {
	LocalGPTSettings,
	AIProvider,
	Providers,
	OpenAICompatibleProvider,
	OllamaProvider,
	LocalGPTAction,
} from "./interfaces";
import { OllamaAIProvider } from "./providers/ollama";
import { OpenAICompatibleAIProvider } from "./providers/openai-compatible";
import {
	startProcessing,
	createVectorStore,
	queryVectorStore,
	getLinkedFiles,
} from "./rag";
import { logger } from "./logger";
import { fileCache } from "./indexedDB";

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
		await this.loadSettings();
		this.reload();
		this.app.workspace.onLayoutReady(async () => {
			// @ts-ignore
			await fileCache.init(this.app.appId);

			window.setTimeout(() => {
				this.checkUpdates();
			}, 5000);
		});

		this.registerEditorExtension(spinnerPlugin);
		this.addSettingTab(new LocalGPTSettingTab(this.app, this));
		this.initializeStatusBar();
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
		return ["\n", text.trim().replace(selectedText, "").trim(), "\n"].join(
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
			spinner.updateContent(
				this.processText(updatedString, selectedText),
			);
			this.app.workspace.updateOptions();
		};

		const getAIProvider = (providerName: string): AIProvider => {
			switch (this.settings.providers[providerName].type) {
				case Providers.OPENAI_COMPATIBLE: {
					const { url, apiKey, defaultModel, embeddingModel } = this
						.settings.providers[
						providerName
					] as OpenAICompatibleProvider;
					return new OpenAICompatibleAIProvider({
						url,
						apiKey,
						defaultModel,
						embeddingModel,
						abortController,
						onUpdate,
					});
				}
				case Providers.OLLAMA:
				default: {
					const { ollamaUrl, defaultModel, embeddingModel } = this
						.settings.providers[providerName] as OllamaProvider;
					return new OllamaAIProvider({
						defaultModel,
						ollamaUrl,
						embeddingModel,
						abortController,
						onUpdate,
					});
				}
			}
		};

		const aiProvider = getAIProvider(this.settings.defaults.provider);

		const regexp = /!\[\[(.+?\.(?:png|jpe?g))]]/gi;
		const fileNames = Array.from(
			selectedText.matchAll(regexp),
			(match) => match[1],
		);

		selectedText = selectedText.replace(regexp, "");

		const imagesInBase64 =
			(
				await Promise.all(
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
								const bytes = new Uint8Array(buffer);

								const output = [];
								for (const byte of bytes) {
									output.push(String.fromCharCode(byte));
								}

								const binString = output.join("");

								return btoa(binString);
							});
					}),
				)
			).filter(Boolean) || [];

		logger.time("Processing Embeddings");
		const context = await this.enhanceWithContext(selectedText, aiProvider);
		logger.timeEnd("Processing Embeddings");
		logger.debug("Selected text", selectedText);

		const aiRequest = {
			text: selectedText,
			action,
			images: imagesInBase64,
			options: {
				temperature:
					CREATIVITY[this.settings.defaults.creativity].temperature,
			},
			context,
		};

		aiProvider
			.process(aiRequest)
			.catch((error) => {
				if (this.settings.defaults.fallbackProvider) {
					new Notice(`Action processed with a fallback`);
					return getAIProvider(
						this.settings.defaults.fallbackProvider,
					).process(aiRequest);
				}
				return Promise.reject(error);
			})
			.then((data) => {
				hideSpinner && hideSpinner();
				this.app.workspace.updateOptions();

				if (action.replace) {
					editor.replaceRange(
						data.trim(),
						cursorPositionFrom,
						cursorPositionTo,
					);
				} else {
					const isLastLine =
						editor.lastLine() === cursorPositionTo.line;
					const text = this.processText(data, selectedText);
					editor.replaceRange(isLastLine ? "\n" + text : text, {
						ch: 0,
						line: cursorPositionTo.line + 1,
					});
				}
			})
			.catch((error) => {
				if (!abortController.signal.aborted) {
					new Notice(`Error while generating text: ${error.message}`);
				}
				hideSpinner && hideSpinner();
				this.app.workspace.updateOptions();
			})
			.finally(() => {
				logger.separator();
			});
	}

	async enhanceWithContext(
		selectedText: string,
		aiProvider: AIProvider,
	): Promise<string> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return "";
		}
		if (
			!this.settings.providers[this.settings.defaults.provider]
				.embeddingModel
		) {
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
			if (aiProvider.abortController?.signal.aborted) {
				return "";
			}

			this.initializeProgress();

			const processedDocs = await startProcessing(
				linkedFiles,
				this.app.vault,
				this.app.metadataCache,
				activeFile,
			);

			if (processedDocs.size === 0) {
				this.hideStatusBar();
				return "";
			}

			if (aiProvider.abortController?.signal.aborted) {
				this.hideStatusBar();
				return "";
			}

			const vectorStore = await createVectorStore(
				Array.from(processedDocs.values()),
				this,
				activeFile.path,
				aiProvider,
				this.addTotalProgressSteps.bind(this),
				this.updateCompletedSteps.bind(this),
			);

			if (aiProvider.abortController?.signal.aborted) {
				this.hideStatusBar();
				return "";
			}

			const relevantContext = await queryVectorStore(
				selectedText,
				vectorStore,
			);

			this.hideStatusBar();

			if (relevantContext.trim()) {
				return relevantContext;
			}
		} catch (error) {
			this.hideStatusBar();
			if (aiProvider.abortController?.signal.aborted) {
				return "";
			}

			console.error("Error processing RAG:", error);
			new Notice(
				`Error processing related documents: ${error.message}. Continuing with original text.`,
			);
		}

		return "";
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
			// @ts-ignore
			if (!loadedData._version || loadedData._version < 1) {
				needToSave = true;

				loadedData.providers = DEFAULT_SETTINGS.providers;
				// @ts-ignore
				loadedData.providers.ollama.ollamaUrl = loadedData.ollamaUrl;
				// @ts-ignore
				delete loadedData.ollamaUrl;
				// @ts-ignore
				loadedData.providers.ollama.defaultModel =
					// @ts-ignore
					loadedData.defaultModel;
				// @ts-ignore
				delete loadedData.defaultModel;
				// @ts-ignore
				loadedData.providers.openaiCompatible &&
					// @ts-ignore
					(loadedData.providers.openaiCompatible.apiKey = "");

				loadedData._version = 2;
			}
			if (loadedData._version < 3) {
				needToSave = true;
				// @ts-ignore
				loadedData.defaultProvider =
					// @ts-ignore
					loadedData.selectedProvider ||
					// @ts-ignore
					DEFAULT_SETTINGS.defaultProvider;
				// @ts-ignore
				delete loadedData.selectedProvider;

				Object.keys(loadedData.providers).forEach((key) => {
					// @ts-ignore
					loadedData.providers[key].type = key;
				});

				loadedData._version = 3;
			}
			if (loadedData._version < 4) {
				needToSave = true;
				loadedData.defaults = {
					provider:
						// @ts-ignore
						loadedData.defaultProvider ||
						DEFAULT_SETTINGS.defaults.provider,
					fallbackProvider:
						// @ts-ignore
						loadedData.fallbackProvider ||
						DEFAULT_SETTINGS.defaults.fallbackProvider,
					creativity: DEFAULT_SETTINGS.defaults.creativity,
				};
				// @ts-ignore
				delete loadedData.defaultProvider;
				// @ts-ignore
				delete loadedData.fallbackProvider;

				loadedData._version = 4;
			}

			if (loadedData._version < 5) {
				needToSave = true;

				Object.keys(DEFAULT_SETTINGS.providers).forEach((provider) => {
					if (loadedData.providers[provider]) {
						loadedData.providers[provider].embeddingModel =
							DEFAULT_SETTINGS.providers[provider].embeddingModel;
					}
				});

				loadedData._version = 5;
				setTimeout(() => {
					new Notice(
						`🎉 LocalGPT can finally use\ncontext from links!\nCheck the Settings!`,
						0,
					);
				}, 10000);
			}

			Object.keys(DEFAULT_SETTINGS.providers).forEach((key) => {
				if (
					loadedData.providers[
						key as keyof typeof DEFAULT_SETTINGS.providers
					]
				) {
					return;
				}
				// @ts-ignore
				loadedData.providers[key] =
					DEFAULT_SETTINGS.providers[
						key as keyof typeof DEFAULT_SETTINGS.providers
					];
				needToSave = true;
			});
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
