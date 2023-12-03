import {Editor, Notice, Plugin, requestUrl, Menu} from "obsidian";
import {LocalGPTSettingTab} from "LocalGPTSettingTab";
import {DEFAULT_SETTINGS} from "defaultSettings";
import {spinnerPlugin} from "spinnerPlugin";
import {LocalGPTSettings, OllamaRequestBody} from "./interfaces";

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
			id: 'local-gpt-context-menu',
			name: 'Show context menu',
			editorCallback: (editor: Editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm;

				const selection = editor.getSelection();
				const text = selection || editor.getValue();
				const cursorPositionFrom = editor.getCursor("from");
				const cursorPositionTo = editor.getCursor("to");

				const contextMenu = new Menu();

				this.settings.actions.forEach((action) => {
					const requestBody: OllamaRequestBody = {
						prompt: action.prompt + "\n\n" + text,
						model: action.model || this.settings.defaultModel,
						options: {
							temperature: action.temperature || 0.2,
						},
						stream: false
					};

					if (action.system) {
						requestBody.system = action.system;
					}


					contextMenu.addItem((item) => {
						item.setTitle(action.name)
							.onClick(() => {
								const spinner = editorView.plugin(spinnerPlugin) || undefined;
								const hideSpinner = spinner?.show(editor.posToOffset(cursorPositionTo))
								this.app.workspace.updateOptions();

								requestUrl({
									method: "POST",
									url: `${this.settings.ollamaUrl}/api/generate`,
									body: JSON.stringify(requestBody)
								})
									.then(({json}) => {
										hideSpinner && hideSpinner();
										this.app.workspace.updateOptions();

										if (action.replace) {
											editor.replaceRange(
												json.response.trim(),
												cursorPositionFrom,
												cursorPositionTo
											);
										} else {
											editor.replaceRange(
												['\n', json.response.trim().replace(text, '').trim(), '\n'].join(''),
												{
													ch: 0,
													line: cursorPositionTo.line + 1
												}
											);
										}
									})
									.catch((error) => {
										new Notice(`Error while generating text: ${error.message}`);
										hideSpinner && hideSpinner();
										this.app.workspace.updateOptions();
									});
							})
					});
				});


				const fromRect = editorView.coordsAtPos(editor.posToOffset(cursorPositionFrom));
				const toRect = editorView.coordsAtPos(editor.posToOffset(cursorPositionTo));
				contextMenu.showAtPosition({x: fromRect.left, y: toRect.top + (editorView.defaultLineHeight || 0)});
			},
		});
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
