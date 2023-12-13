import { Editor, Notice, Plugin, Menu } from "obsidian";
import { LocalGPTSettingTab } from "LocalGPTSettingTab";
import { DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin } from "spinnerPlugin";
import { LocalGPTSettings, AIProvider, Providers } from "./interfaces";
import { OllamaAIProvider } from "./providers/ollama";
import { OpenAICompatibleAIProvider } from "./providers/openai-compatible";

export default class LocalGPT extends Plugin {
	settings: LocalGPTSettings;

	async onload() {
		await this.loadSettings();
		this.reload();

		this.registerEditorExtension(spinnerPlugin);
		this.addSettingTab(new LocalGPTSettingTab(this.app, this));
	}

	private addCommands() {
		this.addCommand({
			id: "context-menu",
			name: "Show context menu",
			editorCallback: (editor: Editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm;

				const selection = editor.getSelection();
				const text = selection || editor.getValue();
				const cursorPositionFrom = editor.getCursor("from");
				const cursorPositionTo = editor.getCursor("to");

				const contextMenu = new Menu();

				let aiProvider: AIProvider;
				switch (this.settings.selectedProvider) {
					case Providers.OPENAI_COMPATIBLE: {
						aiProvider = new OpenAICompatibleAIProvider({
							url: this.settings.providers.openaiCompatible.url,
						});
						break;
					}
					case Providers.OLLAMA:
					default: {
						aiProvider = new OllamaAIProvider({
							defaultModel:
								this.settings.providers.ollama.defaultModel,
							ollamaUrl: this.settings.providers.ollama.ollamaUrl,
						});
					}
				}

				this.settings.actions.forEach((action) => {
					contextMenu.addItem((item) => {
						item.setTitle(action.name).onClick(() => {
							const spinner =
								editorView.plugin(spinnerPlugin) || undefined;
							const hideSpinner = spinner?.show(
								editor.posToOffset(cursorPositionTo),
							);
							this.app.workspace.updateOptions();

							aiProvider
								.process(text, action)
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
										editor.replaceRange(
											[
												"\n",
												data
													.trim()
													.replace(text, "")
													.trim(),
												"\n",
											].join(""),
											{
												ch: 0,
												line: cursorPositionTo.line + 1,
											},
										);
									}
								})
								.catch((error) => {
									new Notice(
										`Error while generating text: ${error.message}`,
									);
									hideSpinner && hideSpinner();
									this.app.workspace.updateOptions();
								});
						});
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
	}

	onunload() {}

	async loadSettings() {
		const loadedData: LocalGPTSettings = await this.loadData();
		let needToSave = false;

		if ((loadedData && !loadedData._version) || loadedData._version < 1) {
			needToSave = true;

			loadedData.providers = DEFAULT_SETTINGS.providers;
			// @ts-ignore
			loadedData.providers.ollama.ollamaUrl = loadedData.ollamaUrl;
			// @ts-ignore
			delete loadedData.ollamaUrl;
			// @ts-ignore
			loadedData.providers.ollama.defaultModel = loadedData.defaultModel;
			// @ts-ignore
			delete loadedData.defaultModel;
			loadedData.selectedProvider = DEFAULT_SETTINGS.selectedProvider;
			loadedData._version = 2;
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

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		if (needToSave) {
			await this.saveData(this.settings);
		}
	}

	reload() {
		this.onunload();
		this.addCommands();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.reload();
	}
}
