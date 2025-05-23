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
	settings: LocalGPTSettings; // 插件设置
	abortControllers: AbortController[] = []; // 用于管理异步操作的中止控制器数组
	updatingInterval: number; // 更新检查的定时器 ID
	private statusBarItem: HTMLElement; // 状态栏元素
	private currentPercentage: number = 0; // 当前进度百分比（用于动画）
	private targetPercentage: number = 0; // 目标进度百分比
	private animationFrameId: number | null = null; // 动画帧 ID
	private totalProgressSteps: number = 0; // 总进度步数
	private completedProgressSteps: number = 0; // 已完成的进度步数

	editorSuggest?: ModelSuggestor; // 用于存储 "@" 模型建议器的实例
	actionSuggest?: ActionSuggestor; // 用于存储 "::" 动作建议器的实例

	// 插件加载时的生命周期方法
	async onload() {
		// 初始化 AI 服务
		initAI(this.app, this, async () => {
			await this.loadSettings(); // 加载设置
			// 添加设置页面标签
			this.addSettingTab(new LocalGPTSettingTab(this.app, this));
			this.reload(); // 重新加载插件配置

			// 等待工作区准备就绪后初始化
			this.app.workspace.onLayoutReady(async () => {
				// 初始化文件缓存
				// @ts-ignore
				await fileCache.init(this.app.appId);

				// 延迟5秒后检查更新
				window.setTimeout(() => {
					this.checkUpdates();
				}, 5000);
			});

			// 注册编辑器扩展插件（旋转加载动画）
			this.registerEditorExtension(spinnerPlugin);
			this.initializeStatusBar(); // 初始化状态栏

			// 注册模型建议器 (用于 "@" 触发)
			this.editorSuggest = new ModelSuggestor(this);
			this.registerEditorSuggest(this.editorSuggest);
			// 注册动作建议器 (用于 "::" 触发)
			this.actionSuggest = new ActionSuggestor(this);
			this.registerEditorSuggest(this.actionSuggest);
		});
	}

	// 初始化状态栏
	private initializeStatusBar() {
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("local-gpt-status");
		this.statusBarItem.hide();
	}

	// 处理 AI 生成的文本
	// 移除思考标签 <think>...</think> 并格式化输出
	processText(text: string, selectedText: string) {
		if (!text.trim()) {
			return "";
		}

		// 移除 <think>...</think> 标签及其内容
		const cleanText = removeThinkingTags(text).trim();

		// 返回格式化后的文本，去除原始选中文本
		return ["\n", cleanText.replace(selectedText, "").trim(), "\n"].join(
			"",
		);
	}

	// 添加命令面板命令
	private addCommands() {
		// 添加右键上下文菜单命令
		this.addCommand({
			id: "context-menu",
			name: "Show context menu",
			editorCallback: (editor: Editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm;

				const cursorPositionFrom = editor.getCursor("from");
				const cursorPositionTo = editor.getCursor("to");

				const contextMenu = new Menu();

				// 将所有动作添加到上下文菜单
				this.settings.actions.forEach((action) => {
					contextMenu.addItem((item) => {
						item.setTitle(action.name).onClick(
							this.runAction.bind(this, action, editor),
						);
					});
				});

				// 获取光标位置并显示菜单
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

		// 为每个动作添加快速访问命令
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

	// 执行指定的 AI 动作
	async runAction(action: LocalGPTAction, editor: Editor) {
		// @ts-expect-error, not typed
		const editorView = editor.cm;

		// 获取选中的文本，如果没有选中则使用整个文档
		const selection = editor.getSelection();
		let selectedText = selection || editor.getValue();
		const cursorPositionFrom = editor.getCursor("from");
		const cursorPositionTo = editor.getCursor("to");

		// 创建中止控制器，允许用户通过 ESC 键取消操作
		const abortController = new AbortController();
		this.abortControllers.push(abortController);

		// 显示加载动画
		const spinner = editorView.plugin(spinnerPlugin) || undefined;
		const hideSpinner = spinner?.show(editor.posToOffset(cursorPositionTo));
		this.app.workspace.updateOptions();

		// 实时更新处理进度的回调函数
		const onUpdate = (updatedString: string) => {
			spinner.processText(updatedString, (text: string) =>
				this.processText(text, selectedText),
			);
			this.app.workspace.updateOptions();
		};

		// 提取并处理文本中的图片链接
		const regexp = /!\[\[(.+?\.(?:png|jpe?g))]]/gi;
		const fileNames = Array.from(
			selectedText.matchAll(regexp),
			(match) => match[1],
		);

		selectedText = selectedText.replace(regexp, "");

		// 将图片转换为 Base64 编码
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

		// 日志记录
		logger.time("Processing Embeddings");

		logger.timeEnd("Processing Embeddings");
		logger.debug("Selected text", selectedText);

		// 等待 AI 服务初始化完成
		const aiRequestWaiter = await waitForAI();

		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;

		// 增强上下文：从链接的文件中获取相关内容
		const context = await this.enhanceWithContext(
			selectedText,
			aiProviders,
			aiProviders.providers.find(
				(provider: IAIProvider) =>
					provider.id === this.settings.aiProviders.embedding,
			),
			abortController,
		);

		// 选择要使用的 AI Provider
		let provider = aiProviders.providers.find(
			// 使用全局配置的主AI Provider (Use the globally configured main AI provider)
			(p: IAIProvider) => p.id === this.settings.aiProviders.main,
		);
		let modelDisplayName: string = ""; // 用于存储模型显示名称 (To store the model display name)

		// 设置模型显示名称
		if (provider) {
			modelDisplayName = `${provider.name}${
				provider.model ? ` (${provider.model})` : ""
			}`;
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
			new Notice(
				"No AI provider found. Please configure a provider in settings.",
			);
			throw new Error("No AI provider found");
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
			const ttft = firstChunkTime
				? Math.round(firstChunkTime - requestStartTime)
				: "N/A"; // 首字延迟 (Time to first token)

			// 计算 tokens 相关指标（暂时使用模拟数据）
			const totalTokens = "177"; // 总 tokens
			const inputTokens = "16"; // 输入 tokens
			const outputTokens = "155"; // 输出 tokens
			const tokensPerSecond =
				totalTime > 0 ? Math.round(155000 / totalTime) : "N/A"; // tokens/秒
			// --- End of Total Time and Performance Metrics Calculation ---

			// 移除思考标签并整理文本 (Remove thinking tags and trim the text)
			const cleanedFullText = removeThinkingTags(fullText).trim();

			// 构建最终输出文本，模型名称单独一行
			const now = new Date();
			const timeStr = now.toLocaleString("zh-CN", {
				timeZone: "Asia/Shanghai",
				hour12: false,
			});
			let finalText = `[${
				modelDisplayName || "AI"
			}] ${timeStr}:\n${cleanedFullText}`;

			// --- 格式化并附加性能指标 (Format and Append Performance Metrics) ---
			// 使用新的性能指标格式
			const performanceMetrics = `\n\n[Tokens: ${totalTokens} ↑${inputTokens} ↓${outputTokens} ${tokensPerSecond}tokens/s | 首字延迟: ${ttft} ms | 总耗时: ${totalTime} ms]:`;
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
				editor.replaceRange(
					isLastLine ? "\n" + textToInsert : textToInsert,
					{
						ch: 0,
						line: cursorPositionTo.line + 1,
					},
				);
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

	// 使用相关文档内容增强上下文
	// 通过向量存储和语义搜索找到相关内容
	async enhanceWithContext(
		selectedText: string,
		aiProviders: IAIProvidersService,
		aiProvider: IAIProvider | undefined,
		abortController: AbortController,
	): Promise<string> {
		// 获取当前活动文件
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return "";
		}
		if (!aiProvider) {
			return "";
		}

		// 获取选中文本中提到的链接文件
		const linkedFiles = getLinkedFiles(
			selectedText,
			this.app.vault,
			this.app.metadataCache,
			activeFile.path,
		);

		// 如果没有链接文件，返回空字符串
		if (linkedFiles.length === 0) {
			return "";
		}

		try {
			// 检查是否已取消操作
			if (abortController?.signal.aborted) {
				return "";
			}

			// 初始化进度条
			this.initializeProgress();

			// 处理链接的文档
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

			// 创建向量存储以进行语义搜索
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

			// 查询向量存储获取相关上下文
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

	// 插件卸载时的清理工作
	onunload() {
		document.removeEventListener("keydown", this.escapeHandler); // 移除键盘监听
		window.clearInterval(this.updatingInterval); // 清除更新检查定时器
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId); // 取消动画帧
		}
	}

	// 加载插件设置并执行必要的数据迁移
	async loadSettings() {
		const loadedData: LocalGPTSettings = await this.loadData();
		let needToSave = false;

		// 数据迁移：处理旧版本设置格式
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

	// 检查插件更新
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

			// 如果有新版本可用，显示通知
			if (response.tag_name !== this.manifest.version) {
				new Notice(`⬆️ Local GPT: a new version is available`);
			}
		} catch (error) {
			console.error("Error checking for updates:", error);
		}
	}

	// ESC 键处理器：取消所有正在进行的 AI 请求
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

	// 重新加载插件配置
	reload() {
		this.onunload(); // 先执行清理
		this.addCommands(); // 重新添加命令
		this.abortControllers = [];
		this.updatingInterval = window.setInterval(
			this.checkUpdates.bind(this),
			10800000,
		); // 每3小时检查更新
		document.addEventListener("keydown", this.escapeHandler);
	}

	// 保存设置并重新加载插件
	async saveSettings() {
		await this.saveData(this.settings);
		this.reload();
	}

	// 初始化进度条显示
	private initializeProgress() {
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
		this.statusBarItem.show();
		this.updateStatusBar();
	}

	// 添加总进度步数
	private addTotalProgressSteps(steps: number) {
		this.totalProgressSteps += steps;
		this.updateProgressBar();
	}

	// 更新已完成的步数
	private updateCompletedSteps(steps: number) {
		this.completedProgressSteps += steps;
		this.updateProgressBar();
	}

	// 更新进度条百分比
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

	// 更新状态栏文本
	private updateStatusBar() {
		this.statusBarItem.setAttr(
			"data-text",
			this.currentPercentage
				? `✨ Enhancing ${this.currentPercentage}%`
				: "✨ Enhancing",
		);
		this.statusBarItem.setText(` `);
	}

	// 动画显示百分比变化
	private animatePercentage() {
		const startTime = performance.now();
		const duration = 300; // 动画持续时间300ms

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

	// 隐藏状态栏并重置进度
	private hideStatusBar() {
		this.statusBarItem.hide();
		this.totalProgressSteps = 0;
		this.completedProgressSteps = 0;
		this.currentPercentage = 0;
		this.targetPercentage = 0;
	}
}

// 用于 "::" 触发的动作建议器 (Action Suggestor for "::" trigger)
class ActionSuggestor extends EditorSuggest<LocalGPTAction> {
	private plugin: LocalGPT; // LocalGPT 插件实例引用 (Reference to the LocalGPT plugin instance)

	constructor(plugin: LocalGPT) {
		super(plugin.app); // 将 App 实例传递给 EditorSuggest 构造函数 (Pass App instance to EditorSuggest constructor)
		this.plugin = plugin; // 初始化动作建议器，传入 LocalGPT 插件实例
		// 构造函数，初始化父类 EditorSuggest 并设置插件实例 (Constructor, initializes parent EditorSuggest and sets plugin instance)
	}

	// 当用户输入特定字符序列 (例如 "：") 时触发 (Triggered when the user types a specific character sequence, e.g., "：")
	onTrigger(
		cursor: EditorPosition, // 当前光标位置 (Current cursor position)
		editor: Editor, // 当前编辑器实例 (Current editor instance)
		_file: TFile | null, // 当前打开的文件 (Currently open file, may be null)
	): EditorSuggestTriggerInfo | null {
		// 返回触发信息或 null (Returns trigger info or null)
		const line = editor.getLine(cursor.line); // 获取当前行内容 (Get current line content)
		const sub = line.substring(0, cursor.ch); // 获取光标前的子字符串 (Get substring before the cursor)

		// 检查是否输入了中文冒号 "：" (Check if Chinese colon "：" is typed)
		const match = sub.match(/：([^：]*)$/); // 匹配中文冒号及其后面的文本
		if (match) {
			return {
				start: { line: cursor.line, ch: match.index! }, // 建议开始的位置 (Start position for the suggestion)
				end: cursor, // 建议结束的位置 (End position for the suggestion)
				query: match[1] || "", // "：" 后面的查询字符串，用于过滤功能 (Query string after "：" for filtering)
			};
		}
		return null; // 没有匹配则不触发建议 (No match, so don't trigger suggestions)
	}

	// 获取建议列表 (Get the list of suggestions)
	getSuggestions(
		context: EditorSuggestContext, // 编辑器建议上下文 (Editor suggest context)
	): LocalGPTAction[] {
		// 返回一个 LocalGPTAction 数组 (Returns an array of LocalGPTAction)
		const allActions = this.plugin.settings.actions;
		const query = context.query.toLowerCase();

		// 如果有查询字符串，进行模糊匹配过滤 (If there's a query string, filter by fuzzy matching)
		if (query) {
			return allActions.filter((action) =>
				action.name.toLowerCase().includes(query),
			);
		}

		// 否则返回所有动作 (Otherwise return all actions)
		return allActions;
	}

	// 渲染每个建议项 (Render each suggestion item)
	renderSuggestion(action: LocalGPTAction, el: HTMLElement): void {
		// 设置建议项的显示文本为动作名称 (Set the display text for the suggestion item to the action name)
		el.setText(action.name);
	}

	// 当用户选择一个建议项时调用 (Called when the user selects a suggestion item)
	selectSuggestion(
		action: LocalGPTAction,
		evt: MouseEvent | KeyboardEvent,
	): void {
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
class ModelSuggestor extends EditorSuggest<IAIProvider> {
	private plugin: LocalGPT; // LocalGPT 插件实例引用 (Reference to the LocalGPT plugin instance)
	private aiProvidersService: IAIProvidersService | null = null; // AI Providers 服务实例 (AI Providers service instance)

	constructor(plugin: LocalGPT) {
		super(plugin.app); // 将 App 实例传递给 EditorSuggest 构造函数 (Pass App instance to EditorSuggest constructor)
		this.plugin = plugin; // 初始化模型建议器，传入 LocalGPT 插件实例
		// 构造函数，初始化父类 EditorSuggest 并设置插件实例 (Constructor, initializes parent EditorSuggest and sets plugin instance)
		this.loadProviders(); // 异步加载 AI Providers (Asynchronously load AI Providers)
	}

	// 异步加载 AI Providers 服务 (Asynchronously loads the AI Providers service)
	private async loadProviders() {
		try {
			const aiRequestWaiter = await waitForAI(); // 等待 AI 服务初始化 (Wait for AI service initialization)
			this.aiProvidersService = await aiRequestWaiter.promise; // 获取 AI Providers 服务实例 (Get the AI Providers service instance)
		} catch (error) {
			console.error(
				"Error loading AI providers for ModelSuggestor:",
				error,
			);
			new Notice(
				"Failed to load AI providers for model suggestion. Model selection via '@' might not work.",
			);
		}
	}

	// 当用户输入特定字符 (例如 "@") 时触发 (Triggered when the user types a specific character, e.g., "@")
	onTrigger(
		cursor: EditorPosition, // 当前光标位置 (Current cursor position)
		editor: Editor, // 当前编辑器实例 (Current editor instance)
		_file: TFile | null, // 当前打开的文件 (Currently open file, may be null)
	): EditorSuggestTriggerInfo | null {
		// 返回触发信息或 null (Returns trigger info or null)
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
	getSuggestions(
		context: EditorSuggestContext, // 编辑器建议上下文 (Editor suggest context)
	): IAIProvider[] {
		// 返回一个 IAIProvider 数组 (Returns an array of IAIProvider)
		if (!this.aiProvidersService) {
			// 如果 AI Provider 服务未加载，则不显示建议 (If AI Provider service is not loaded, show no suggestions)
			// A notice is already shown in loadProviders
			return [];
		}

		const providers = this.aiProvidersService.providers; // 获取所有可用的 AI Provider (Get all available AI Providers)
		const query = context.query.toLowerCase(); // 获取用户输入的查询条件并转为小写 (Get user's query and convert to lowercase)

		// 将 providers 分为主模型和视觉模型两组
		const mainModels: IAIProvider[] = [];
		const visionModels: IAIProvider[] = [];

		providers.forEach((provider) => {
			// 判断是否为视觉模型
			// 使用类型断言和可选链来安全访问 capabilities
			const providerWithCapabilities = provider as any;
			const isVision =
				providerWithCapabilities.capabilities?.vision ||
				provider.name.toLowerCase().includes("vision") ||
				provider.model?.toLowerCase().includes("vision") ||
				provider.model?.toLowerCase().includes("gpt-4") ||
				provider.model?.toLowerCase().includes("claude");

			// 根据查询过滤
			const matchesQuery =
				!query ||
				provider.name.toLowerCase().includes(query) ||
				(provider.model &&
					provider.model.toLowerCase().includes(query));

			if (matchesQuery) {
				if (isVision) {
					visionModels.push(provider);
				} else {
					mainModels.push(provider);
				}
			}
		});

		// 创建分组标记
		const mainHeader = {
			id: "__main_header__",
			name: "━━━━━ 主模型 ━━━━━",
			model: "",
			isHeader: true,
		} as any;

		const visionHeader = {
			id: "__vision_header__",
			name: "━━━━━ 视觉模型 ━━━━━",
			model: "",
			isHeader: true,
		} as any;

		// 组合结果：主模型标题 + 主模型列表 + 视觉模型标题 + 视觉模型列表
		const result: IAIProvider[] = [];

		if (mainModels.length > 0 || visionModels.length > 0) {
			if (mainModels.length > 0) {
				result.push(mainHeader);
				result.push(...mainModels);
			}

			if (visionModels.length > 0) {
				if (mainModels.length > 0) {
					// 添加分隔线
					const separator = {
						id: "__separator__",
						name: "─────────────────────",
						model: "",
						isHeader: true,
					} as any;
					result.push(separator);
				}
				result.push(visionHeader);
				result.push(...visionModels);
			}
		}

		return result;
	}

	// 渲染每个建议项 (Render each suggestion item)
	renderSuggestion(suggestion: IAIProvider, el: HTMLElement): void {
		// 检查是否为标题行
		// @ts-ignore
		if (suggestion.isHeader) {
			el.addClass("model-header");
			el.setText(suggestion.name);
			// 添加样式使标题不可选择
			el.style.pointerEvents = "none";
			el.style.opacity = "0.7";
			el.style.fontWeight = "bold";
			el.style.fontSize = "0.9em";
			return;
		}

		// 设置建议项的显示文本 (Set the display text for the suggestion item)
		// 格式: "Provider Name (model name)" 或 "Provider Name (Default)" 如果没有 model 名称
		// Format: "Provider Name (model name)" or "Provider Name (Default)" if no model name
		const displayText = `${suggestion.name} (${
			suggestion.model || "Default"
		})`;
		el.setText(displayText);

		// 为当前选中的模型添加标记
		const currentMainId = this.plugin.settings.aiProviders.main;
		const currentVisionId = this.plugin.settings.aiProviders.vision;

		if (
			suggestion.id === currentMainId ||
			suggestion.id === currentVisionId
		) {
			el.setText(displayText + " ✓");
			el.style.fontWeight = "bold";
		}
	}

	// 当用户选择一个建议项时调用 (Called when the user selects a suggestion item)
	selectSuggestion(
		suggestion: IAIProvider,
		evt: MouseEvent | KeyboardEvent,
	): void {
		// 忽略标题行的选择
		// @ts-ignore
		if (suggestion.isHeader) {
			return;
		}

		// 获取当前编辑器
		const editor = this.plugin.app.workspace.activeEditor?.editor;
		if (!editor) {
			new Notice("无法找到活动编辑器");
			this.close();
			return;
		}

		// 获取触发信息用于替换文本
		if (this.context) {
			// 构建替换文本：@模型名称
			const modelName = suggestion.model || suggestion.name;
			const replacementText = `@${modelName} `;

			// 替换编辑器中的文本
			editor.replaceRange(
				replacementText,
				this.context.start,
				this.context.end,
			);
		}

		// 判断是否为视觉模型（根据名称或能力判断）
		// 使用类型断言和可选链来安全访问 capabilities
		const suggestionWithCapabilities = suggestion as any;
		const isVisionModel =
			suggestionWithCapabilities.capabilities?.vision ||
			suggestion.name.toLowerCase().includes("vision") ||
			suggestion.model?.toLowerCase().includes("vision") ||
			suggestion.model?.toLowerCase().includes("gpt-4") ||
			suggestion.model?.toLowerCase().includes("claude");

		// 更新对应的全局配置
		if (isVisionModel) {
			// 更新视觉模型配置
			this.plugin.settings.aiProviders.vision = suggestion.id;
			new Notice(`已切换视觉模型为: ${suggestion.name}`);
		} else {
			// 更新主模型配置
			this.plugin.settings.aiProviders.main = suggestion.id;
			new Notice(`已切换主模型为: ${suggestion.name}`);
		}

		// 保存设置
		this.plugin.saveSettings();
		this.close(); // 关闭建议器
	}
}
