import {
	Editor,
	Menu,
	Notice,
	Plugin,
	requestUrl,
	EditorSuggest,
	EditorPosition,
	TFile,
	EditorSuggestTriggerInfo,
	EditorSuggestContext,
	App, // For constructor and app property
	Scope, // For constructor of PopoverSuggest
	PopoverSuggest, // To extend from
	Instruction, // For setInstructions
} from "obsidian";
import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "./spinnerPlugin";
import { removeThinkingTags } from "./text-processing";
import { LocalGPTAction, LocalGPTSettings } from "./interfaces";

import {
	createVectorStore,
	getLinkedFiles,
	queryVectorStore,
	startProcessing,
} from "./rag";
import { logger } from "./logger";
import { fileCache } from "./indexedDB";
import {
	initAI,
	waitForAI,
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { preparePrompt } from "./utils";

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
	// 用于临时存储通过 "@" 符号选择的模型ID (内部变量)
	private _temporarilySelectedProviderId: string | null = null;
	editorSuggest?: EditorSuggest<IAIProvider>; // 用于存储 "@" 模型建议器的实例
	actionSuggest?: EditorSuggest<LocalGPTAction>; // 用于存储 "::" 动作建议器的实例

	// 获取临时选择的 Provider ID
	public getTemporaryProviderId(): string | null {
		return this._temporarilySelectedProviderId;
	}

	// 设置临时选择的 Provider ID
	public setTemporaryProviderId(id: string | null): void {
		this._temporarilySelectedProviderId = id;
		// 不再在此处显示 Notice，因为 ModelSuggestor 和 runAction 已经有相关提示了
		// (Notice is no longer shown here as ModelSuggestor and runAction already have related notifications)
	}

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
			// 注册模型建议器
			this.editorSuggest = new ModelSuggestor(this);
			this.registerEditorSuggest(this.editorSuggest);
			// 注册 "::" 动作建议器
			this.actionSuggest = new ActionSuggestor(this);
			this.registerEditorSuggest(this.actionSuggest);
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
			// 默认使用主AI Provider (Default to the main AI provider)
			(p: IAIProvider) => p.id === this.settings.aiProviders.main,
		);
		let modelDisplayName: string = ""; // 用于存储模型显示名称 (To store the model display name)

		// 检查是否有通过 "@" 临时选择的模型 (Check if a model was temporarily selected via "@")
		const tempId = this.getTemporaryProviderId(); // 使用 getter 方法 (Use getter method)
		if (tempId) {
			const tempProvider = aiProviders.providers.find(
				(p: IAIProvider) => p.id === tempId,
			);
			if (tempProvider) {
				provider = tempProvider; // 使用临时选择的 Provider (Use the temporarily selected provider)
				// 设置模型显示名称 (Set the model display name)
				modelDisplayName = `${provider.name}${provider.model ? ` (${provider.model})` : ""}`;
				new Notice(`Using temporarily selected model: ${modelDisplayName}`); // 提示用户 (Notify the user)
			} else {
				new Notice(
					`Could not find temporarily selected model ID: ${tempId}. Using default AI provider.`,
				);
				// 如果临时模型未找到，则尝试使用默认主模型的名称 (If temp model not found, try to use default main model's name)
				if (provider) {
					modelDisplayName = `${provider.name}${provider.model ? ` (${provider.model})` : ""}`;
				}
			}
			// 重置临时选择的 Provider ID，确保其仅生效一次 (Reset the temporary provider ID to ensure it's used only once)
			this.setTemporaryProviderId(null); // 使用 setter 方法 (Use setter method)
		} else if (provider) {
			// 如果没有临时选择，并且默认主 Provider 已确定，则设置其显示名称 (If no temporary selection and default main provider is set, set its display name)
			modelDisplayName = `${provider.name}${provider.model ? ` (${provider.model})` : ""}`;
		}

		// 处理图像：如果存在图像，并且当前选择的 Provider 不支持视觉功能，则尝试切换到视觉兼容的 Provider
		// (Handle images: if images are present and the currently selected provider does not support vision, try switching to a vision-compatible provider)
		if (imagesInBase64.length) {
			// 如果有图片，并且当前选择的provider不支持vision，尝试切换到vision-compatible provider
			// @ts-ignore
			if (!provider || !provider.capabilities?.vision) {
				const visionProvider = aiProviders.providers.find(
					(p: IAIProvider) =>
						p.id === this.settings.aiProviders.vision,
				);
				if (visionProvider) {
					provider = visionProvider;
					new Notice(
						`Switched to vision-capable model: ${provider.name} for image processing.`,
					);
				} else if (!provider) {
					// If no provider was selected at all and vision is needed but not configured
					new Notice(
						"Vision provider not configured, but images are present.",
					);
					throw new Error(
						"Vision provider not configured for image processing.",
					);
				}
				// If a provider was already selected but it's not vision capable,
				// and no specific vision provider is set, we might proceed without vision
				// or throw an error depending on desired behavior. Here, we'll let it proceed
				// and the provider itself might error out if it can't handle images.
			}
		}

		if (!provider) {
			new Notice("No AI provider found. Please configure a provider in settings.");
			throw new Error("No AI provider found");
		}

		// 如果在上述逻辑后 modelDisplayName 仍然为空 (例如，初始默认 provider 也未设置)，则最后尝试填充
		// (If modelDisplayName is still empty after the above logic (e.g., initial default provider was also not set), try one last time to populate it)
		if (!modelDisplayName && provider) {
			modelDisplayName = `${provider.name}${provider.model ? ` (${provider.model})` : ""}`;
		}

		// --- 性能指标变量初始化 (Performance Metrics Variable Initialization) ---
		const requestStartTime = performance.now(); // 请求开始时间 (Request start time)
		let firstChunkTime: number | null = null; // 首个数据块到达时间 (Time when the first chunk arrives)
		let tokensUsed: string | number = "N/A"; // 使用的 Token 数量，默认为 N/A (Number of tokens used, defaults to N/A)
		// --- End of Performance Metrics Variable Initialization ---

		const chunkHandler = await aiProviders.execute({
			provider, // 使用最终确定的 Provider (Use the finally determined provider)
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
			// --- TTFT捕获 (TTFT Capture) ---
			if (firstChunkTime === null) {
				firstChunkTime = performance.now(); // 记录首个数据块到达时间 (Record time of first chunk arrival)
			}
			// --- End of TTFT Capture ---
			onUpdate(accumulatedText);
		});

		chunkHandler.onEnd((fullText: string) => {
			hideSpinner && hideSpinner();
			this.app.workspace.updateOptions();

			// --- 总耗时与性能指标计算 (Total Time and Performance Metrics Calculation) ---
			const requestEndTime = performance.now(); // 请求结束时间 (Request end time)
			const totalTime = Math.round(requestEndTime - requestStartTime); // 总耗时 (Total time)
			const ttft = firstChunkTime ? Math.round(firstChunkTime - requestStartTime) : "N/A"; // 首字延迟 (Time to first token)
			// Token 数量目前假设为 "N/A" (Token count is currently assumed to be "N/A")
			// let tokensUsed = "N/A"; // 已在外部作用域定义 (Already defined in the outer scope)
			// --- End of Total Time and Performance Metrics Calculation ---

			// 移除思考标签并整理文本 (Remove thinking tags and trim the text)
			const cleanedFullText = removeThinkingTags(fullText).trim();
			// 为输出文本添加模型名称前缀 (Prepend model name to the output text)
			let finalText = `[${modelDisplayName || "AI"}]: ${cleanedFullText}`;

			// --- 格式化并附加性能指标 (Format and Append Performance Metrics) ---
			// 使用中文标签 (Using Chinese labels)
			const performanceMetrics = `\n\n---\n性能指标: Tokens: ${tokensUsed} | 首字延迟: ${ttft} ms | 总耗时: ${totalTime} ms`;
			finalText += performanceMetrics; // 将性能指标附加到最终文本后 (Append performance metrics to the final text)
			// --- End of Format and Append Performance Metrics ---

			if (action.replace) {
				// 如果动作用于替换选中文本 (If the action is to replace selected text)
				editor.replaceRange(
					finalText, // 插入带有模型名称的文本 (Insert text with model name)
					cursorPositionFrom,
					cursorPositionTo,
				);
			} else {
				// 否则，在选中文本后插入 (Otherwise, insert after the selected text)
				const isLastLine = editor.lastLine() === cursorPositionTo.line;
				// processText 进一步处理文本，例如移除原始选中文本部分 (processText further processes the text, e.g., removing the original selected text part)
				const textToInsert = this.processText(finalText, selectedText);
				editor.replaceRange(isLastLine ? "\n" + textToInsert : textToInsert, {
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
		if (!activeFile) {
			return "";
		}
		if (!aiProvider) {
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
			if (abortController?.signal.aborted) {
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

			if (abortController?.signal.aborted) {
				this.hideStatusBar();
				return "";
			}

			const vectorStore = await createVectorStore(
				Array.from(processedDocs.values()),
				this,
				activeFile.path,
				aiProvider as any,
				aiProviders,
				abortController,
				this.addTotalProgressSteps.bind(this),
				this.updateCompletedSteps.bind(this),
			);

			if (abortController?.signal.aborted) {
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
			if (abortController?.signal.aborted) {
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

// 用于 "::" 触发的动作建议器 (Action Suggestor for "::" trigger)
class ActionSuggestor extends PopoverSuggest<LocalGPTAction> implements EditorSuggest<LocalGPTAction> {
	private plugin: LocalGPT; // LocalGPT 插件实例引用 (Reference to the LocalGPT plugin instance)

	// Explicitly define properties from EditorSuggest (and PopoverSuggest if not already covered)
	app: App;
	scope: Scope;
	context: EditorSuggestContext | null;
	limit: number;
	instructionsEl: HTMLElement;

	constructor(plugin: LocalGPT) {
		super(plugin.app); // 将 App 实例传递给 PopoverSuggest 构造函数 (Pass App instance to PopoverSuggest constructor)
		this.plugin = plugin; // 初始化动作建议器，传入 LocalGPT 插件实例
		this.app = plugin.app; // Explicitly assign if required
		this.scope = new Scope(); // Explicitly assign if required
		this.instructionsEl = document.createElement('div');
		this.limit = 100; // 建议数量限制 (Suggestion limit)
		this.context = null;
		// Chinese comment: // 构造函数，初始化父类 PopoverSuggest 并设置插件实例 (Constructor, initializes parent PopoverSuggest and sets plugin instance)
	}

	// 设置建议弹窗的说明性文本 (Sets instructional text for the suggestion popover)
	setInstructions(cb: (instructionsEl: HTMLElement) => void): void {
		this.instructionsEl.empty();
		cb(this.instructionsEl);
		// Original implementation for reference, now using the required signature:
		// createDiv([
		// 	{ command: "↑↓", purpose: "导航 (Navigate)" },
		// 	{ command: "↵", purpose: "选择 (Select)" },
		// 	{ command: "esc", purpose: "关闭 (Dismiss)" },
		// ]);
	}

	// 更新建议上下文 (Updates the suggestion context)
	update(newContext: EditorSuggestContext): void {
		this.context = newContext;
		if (super.update) {
			super.update(newContext);
		}
	}

	// 建议弹窗打开时的回调 (Callback when suggestion popover opens)
	onOpen(): void {
		if (super.onOpen) {
			super.onOpen();
		}
	}

	// 建议弹窗关闭时的回调 (Callback when suggestion popover closes)
	onClose(): void {
		if (super.onClose) {
			super.onClose();
		}
	}
	
	// --- Potentially missing methods from EditorSuggest / AbstractInputSuggest ---
	// (Assuming these are required based on typical obsidian.d.ts structure for EditorSuggest)

	// 开始监听编辑器事件 (Start listening to editor events)
	startListening(): void {
		if (super.startListening) {
			// @ts-ignore - startListening might be protected or not exist on PopoverSuggest directly
			super.startListening();
		}
	}

	// 停止监听编辑器事件 (Stop listening to editor events)
	stopListening(): void {
		if (super.stopListening) {
			// @ts-ignore - stopListening might be protected or not exist on PopoverSuggest directly
			super.stopListening();
		}
	}
	
	// 是否应该显示建议 (Whether suggestions should be shown)
	shouldShowSuggestions(context: EditorSuggestContext): boolean {
		if (super.shouldShowSuggestions) {
			// @ts-ignore - shouldShowSuggestions might be protected or not exist on PopoverSuggest directly
			return super.shouldShowSuggestions(context);
		}
		return true; // Default implementation if not provided by superclass
	}
	// --- End of potentially missing methods ---


	// 当用户输入特定字符序列 (例如 "::") 时触发 (Triggered when the user types a specific character sequence, e.g., "::")
	onTrigger(
		cursor: EditorPosition, // 当前光标位置 (Current cursor position)
		editor: Editor, // 当前编辑器实例 (Current editor instance)
		_file: TFile | null, // 当前打开的文件 (Currently open file, may be null)
	): EditorSuggestTriggerInfo | null { // 返回触发信息或 null (Returns trigger info or null)
		// 检查条件：临时选择的模型ID是否存在，以及输入是否为 "::"
		// (Check conditions: if a temporary model ID is selected, and if the input is "::")
		if (!this.plugin.getTemporaryProviderId()) { // 使用 getter 方法 (Use getter method)
			return null; // 如果没有临时选择的模型，则不触发 (If no temporary model is selected, do not trigger)
		}

		const line = editor.getLine(cursor.line); // 获取当前行内容 (Get current line content)
		const sub = line.substring(0, cursor.ch); // 获取光标前的子字符串 (Get substring before the cursor)

		if (sub.endsWith("::")) {
			return {
				start: { line: cursor.line, ch: sub.lastIndexOf("::") }, // 建议开始的位置 (Start position for the suggestion)
				end: cursor, // 建议结束的位置 (End position for the suggestion)
				query: "", // "::" 后不需要额外查询，直接显示所有动作 (No additional query needed after "::", show all actions)
			};
		}
		return null; // 没有匹配则不触发建议 (No match, so don't trigger suggestions)
	}

	// 获取建议列表 (Get the list of suggestions)
	async getSuggestions(
		_context: EditorSuggestContext, // 编辑器建议上下文 (Editor suggest context) - _context is not used for now
	): Promise<LocalGPTAction[]> { // 返回一个 LocalGPTAction 数组的 Promise (Returns a Promise of an array of LocalGPTAction)
		// 直接返回插件设置中的所有动作 (Directly return all actions from plugin settings)
		return this.plugin.settings.actions;
	}

	// 渲染每个建议项 (Render each suggestion item)
	renderSuggestion(action: LocalGPTAction, el: HTMLElement): void {
		// 设置建议项的显示文本为动作名称 (Set the display text for the suggestion item to the action name)
		el.setText(action.name);
	}

	// 当用户选择一个建议项时调用 (Called when the user selects a suggestion item)
	selectSuggestion(action: LocalGPTAction, evt: MouseEvent | KeyboardEvent): void {
		const currentEditor = this.plugin.app.workspace.activeEditor?.editor;
		if (!currentEditor) {
			new Notice("Cannot find active editor to run action."); // 提示用户找不到编辑器 (Notify user editor not found)
			this.close(); // 关闭建议器 (Close the suggester)
			return;
		}
		// 执行选择的动作 (Execute the selected action)
		this.plugin.runAction(action, currentEditor);
		// 提示用户动作已执行 (Notify the user that the action has been executed)
		// new Notice(`Running action: ${action.name}`); // runAction 内部已有 Notice，此处可省略 (Notice already in runAction, can be omitted here)
		this.close(); // 显式关闭建议器 (Explicitly close the suggester)
	}
}

// 用于模型选择的建议器 (Model Suggestor)
class ModelSuggestor extends PopoverSuggest<IAIProvider> implements EditorSuggest<IAIProvider> {
	private plugin: LocalGPT; // LocalGPT 插件实例引用 (Reference to the LocalGPT plugin instance)
	private aiProvidersService: IAIProvidersService | null = null; // AI Providers 服务实例 (AI Providers service instance)
	
	// Explicitly define properties from EditorSuggest (and PopoverSuggest if not already covered)
	app: App; // PopoverSuggest constructor handles this.app
	scope: Scope; // PopoverSuggest constructor handles this.scope
	context: EditorSuggestContext | null;
	limit: number;
	instructionsEl: HTMLElement;

	constructor(plugin: LocalGPT) {
		super(plugin.app); // 将 App 实例传递给 PopoverSuggest 构造函数 (Pass App instance to PopoverSuggest constructor)
		this.plugin = plugin; // 初始化模型建议器，传入 LocalGPT 插件实例
		this.app = plugin.app; // Explicitly assign if required by strict interface conformance, though super(app) does it.
		this.scope = new Scope(); // PopoverSuggest's constructor creates a scope. Re-assigning might be needed if the interface demands direct ownership.
		this.instructionsEl = document.createElement('div');
		this.limit = 100; // 建议数量限制 (Suggestion limit)
		this.context = null;
		// Chinese comment: // 构造函数，初始化父类 PopoverSuggest 并设置插件实例 (Constructor, initializes parent PopoverSuggest and sets plugin instance)
		this.loadProviders(); // 异步加载 AI Providers (Asynchronously load AI Providers)
	}

	// 设置建议弹窗的说明性文本 (Sets instructional text for the suggestion popover)
	setInstructions(cb: (instructionsEl: HTMLElement) => void): void {
		this.instructionsEl.empty(); 
		cb(this.instructionsEl);
		// Original implementation for reference, now using the required signature:
		// createDiv([
		// 	{ command: "↑↓", purpose: "导航 (Navigate)" },
		// 	{ command: "↵", purpose: "选择 (Select)" },
		// 	{ command: "esc", purpose: "关闭 (Dismiss)" },
		// ]);
	}

	// 更新建议上下文 (Updates the suggestion context)
	update(newContext: EditorSuggestContext): void {
		this.context = newContext;
		if (super.update) {
			super.update(newContext);
		}
	}

	// 建议弹窗打开时的回调 (Callback when suggestion popover opens)
	onOpen(): void {
		if (super.onOpen) {
			super.onOpen();
		}
	}

	// 建议弹窗关闭时的回调 (Callback when suggestion popover closes)
	onClose(): void {
		if (super.onClose) {
			super.onClose();
		}
	}

	// --- Potentially missing methods from EditorSuggest / AbstractInputSuggest ---
	// (Assuming these are required based on typical obsidian.d.ts structure for EditorSuggest)

	// 开始监听编辑器事件 (Start listening to editor events)
	startListening(): void {
		if (super.startListening) {
			// @ts-ignore - startListening might be protected or not exist on PopoverSuggest directly
			super.startListening();
		}
	}

	// 停止监听编辑器事件 (Stop listening to editor events)
	stopListening(): void {
		if (super.stopListening) {
			// @ts-ignore - stopListening might be protected or not exist on PopoverSuggest directly
			super.stopListening();
		}
	}
	
	// 是否应该显示建议 (Whether suggestions should be shown)
	shouldShowSuggestions(context: EditorSuggestContext): boolean {
		if (super.shouldShowSuggestions) {
			// @ts-ignore - shouldShowSuggestions might be protected or not exist on PopoverSuggest directly
			return super.shouldShowSuggestions(context);
		}
		return true; // Default implementation if not provided by superclass
	}
	// --- End of potentially missing methods ---

	// 异步加载 AI Providers 服务 (Asynchronously loads the AI Providers service)
	private async loadProviders() {
		try {
			const aiRequestWaiter = await waitForAI(); // 等待 AI 服务初始化 (Wait for AI service initialization)
			this.aiProvidersService = await aiRequestWaiter.promise; // 获取 AI Providers 服务实例 (Get the AI Providers service instance)
		} catch (error) {
			console.error("Error loading AI providers for ModelSuggestor:", error);
			new Notice("Failed to load AI providers for model suggestion. Model selection via '@' might not work.");
		}
	}

	// 当用户输入特定字符 (例如 "@") 时触发 (Triggered when the user types a specific character, e.g., "@")
	onTrigger(
		cursor: EditorPosition, // 当前光标位置 (Current cursor position)
		editor: Editor, // 当前编辑器实例 (Current editor instance)
		_file: TFile | null, // 当前打开的文件 (Currently open file, may be null)
	): EditorSuggestTriggerInfo | null { // 返回触发信息或 null (Returns trigger info or null)
		const line = editor.getLine(cursor.line); // 获取当前行内容 (Get current line content)
		const sub = line.substring(0, cursor.ch); // 获取光标前的子字符串 (Get substring before the cursor)
		const match = sub.match(/@([\w\s]*)$/); // 检查 "@" 符号后跟任意单词字符或空格 (Check for "@" symbol followed by any word characters or spaces)

		if (match) {
			return {
				start: { line: cursor.line, ch: match.index! }, // 建议开始的位置 (Start position for the suggestion)
				end: cursor, // 建议结束的位置 (End position for the suggestion)
				query: match[1], // "@" 后面的查询字符串 (Query string after "@")
			};
		}
		return null; // 没有匹配则不触发建议 (No match, so don't trigger suggestions)
	}

	// 获取建议列表 (Get the list of suggestions)
	async getSuggestions(
		context: EditorSuggestContext, // 编辑器建议上下文 (Editor suggest context)
	): Promise<IAIProvider[]> { // 返回一个 IAIProvider 数组的 Promise (Returns a Promise of an array of IAIProvider)
		if (!this.aiProvidersService) {
			// 如果 AI Provider 服务未加载，则不显示建议 (If AI Provider service is not loaded, show no suggestions)
			// A notice is already shown in loadProviders
			return [];
		}

		const providers = this.aiProvidersService.providers; // 获取所有可用的 AI Provider (Get all available AI Providers)
		const query = context.query.toLowerCase(); // 获取用户输入的查询条件并转为小写 (Get user's query and convert to lowercase)

		// 根据查询过滤模型 (Filter models based on the query)
		// 检查 provider 名称或其下的 model 名称是否包含查询字符串 (Check if provider name or its model name includes the query string)
		return providers.filter(
			(provider) =>
				provider.name.toLowerCase().includes(query) ||
				(provider.model && provider.model.toLowerCase().includes(query)),
		);
	}

	// 渲染每个建议项 (Render each suggestion item)
	renderSuggestion(suggestion: IAIProvider, el: HTMLElement): void {
		// 设置建议项的显示文本 (Set the display text for the suggestion item)
		// 格式: "Provider Name (model name)" 或 "Provider Name (Default)" 如果没有 model 名称
		// Format: "Provider Name (model name)" or "Provider Name (Default)" if no model name
		el.setText(`${suggestion.name} (${suggestion.model || "Default"})`);
	}

	// 当用户选择一个建议项时调用 (Called when the user selects a suggestion item)
	selectSuggestion(suggestion: IAIProvider, evt: MouseEvent | KeyboardEvent): void {
		// 将选择的 Provider ID 存储到插件的临时变量中 (Store the selected Provider ID in the plugin's temporary variable)
		this.plugin.setTemporaryProviderId(suggestion.id); // 使用 setter 方法 (Use setter method)
		// 提示用户已选择模型 (Notify the user that a model has been selected)
		new Notice(`Model selected: ${suggestion.name}`);
		// 文本替换由 onTrigger 返回的 triggerInfo 处理 (Text replacement is handled by triggerInfo returned from onTrigger)
		this.close(); // 显式关闭建议器 (Explicitly close the suggester)
	}
}
