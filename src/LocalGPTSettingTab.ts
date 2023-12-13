import { App, Notice, PluginSettingTab, requestUrl, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction, Providers } from "./interfaces";

const SEPARATOR = "✂️";

export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;
	editEnabled: boolean = false;
	isNew: boolean = false;
	modelsOptions: any = {};

	constructor(app: App, plugin: LocalGPT) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const aiProvider = new Setting(containerEl)
			.setName("AI provider")
			.setDesc("")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						[Providers.OLLAMA]: "Ollama",
						[Providers.OPENAI_COMPATIBLE]:
							"OpenAI compatible server",
					})
					.setValue(String(this.plugin.settings.selectedProvider))
					.onChange(async (value) => {
						this.plugin.settings.selectedProvider = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		aiProvider.descEl.innerHTML = `If you would like to use other providers, please let me know <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/1">in the discussions</a>`;

		if (this.plugin.settings.selectedProvider === Providers.OLLAMA) {
			new Setting(containerEl)
				.setName("Ollama URL")
				.setDesc("Default is http://localhost:11434")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(
							this.plugin.settings.providers.ollama.ollamaUrl,
						)
						.onChange(async (value) => {
							this.plugin.settings.providers.ollama.ollamaUrl =
								value;
							await this.plugin.saveSettings();
						}),
				);

			const ollamaDefaultModel = new Setting(containerEl)
				.setName("Default model")
				.setDesc("Name of the default Ollama model to use for prompts");
			if (this.plugin.settings.providers.ollama.ollamaUrl) {
				requestUrl(
					`${this.plugin.settings.providers.ollama.ollamaUrl}/api/tags`,
				)
					.then(({ json }) => {
						if (!json.models || json.models.length === 0) {
							return Promise.reject();
						}
						this.modelsOptions = json.models.reduce(
							(acc: any, el: any) => {
								const name = el.name.replace(":latest", "");
								acc[name] = name;
								return acc;
							},
							{},
						);

						ollamaDefaultModel
							.addDropdown((dropdown) =>
								dropdown
									.addOptions(this.modelsOptions)
									.setValue(
										String(
											this.plugin.settings.providers
												.ollama.defaultModel,
										),
									)
									.onChange(async (value) => {
										this.plugin.settings.providers.ollama.defaultModel =
											value;
										await this.plugin.saveSettings();
									}),
							)
							.addButton((button) =>
								button
									.setIcon("refresh-cw")
									.onClick(async () => {
										this.display();
									}),
							);
					})
					.catch(() => {
						ollamaDefaultModel.descEl.innerHTML = `Get the models from <a href="https://ollama.ai/library">Ollama library</a> or check that Ollama URL is correct.`;
						ollamaDefaultModel.addButton((button) =>
							button.setIcon("refresh-cw").onClick(async () => {
								this.display();
							}),
						);
					});
			}
		}
		if (
			this.plugin.settings.selectedProvider ===
			Providers.OPENAI_COMPATIBLE
		) {
			const openAICompatible = new Setting(containerEl)
				.setName("OpenAI compatible server URL")
				.setDesc("")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:8080")
						.setValue(
							this.plugin.settings.providers.openaiCompatible.url,
						)
						.onChange(async (value) => {
							this.plugin.settings.providers.openaiCompatible.url =
								value;
							await this.plugin.saveSettings();
						}),
				);
			openAICompatible.descEl.innerHTML = `
				There are several options to run local OpenAI-like server:
				<ul>
					<li><a href="https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md">llama.cpp</a></li>
					<li><a href="https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server">llama-cpp-python</a></li>
					<li><a href="https://localai.io/model-compatibility/llama-cpp/#setup">LocalAI</a></li>
				</ul>
				After all installation and configuration make sure that you're using compatible model.<br/>
				For llama.cpp it is necessary to use models in ChatML format (e.g. <a href="https://huggingface.co/TheBloke/Orca-2-7B-GGUF/blob/main/orca-2-7b.Q4_K_M.gguf">Orca 2</a>)
			`;
		}

		const editingAction: LocalGPTAction = {
			name: "",
			prompt: "",
			model: "",
			temperature: undefined,
			system: "",
			replace: false,
		};

		const sharingActionsMapping = {
			name: "Name: ",
			system: "System: ",
			prompt: "Prompt: ",
			replace: "Replace: ",
			model: "Model: ",
		};

		containerEl.createEl("h3", { text: "Actions" });

		if (!this.editEnabled) {
			new Setting(containerEl)
				.setName("Add new manually")
				.addButton((button) =>
					button.setIcon("plus").onClick(async () => {
						this.editEnabled = true;
						this.isNew = true;
						this.display();
					}),
				);
			const quickAdd = new Setting(containerEl)
				.setName("Quick add")
				.setDesc("")
				.addText((text) => {
					text.inputEl.style.minWidth = "100%";
					text.setPlaceholder("Paste action");
					text.onChange(async (value) => {
						const quickAddAction: LocalGPTAction = value
							.split(SEPARATOR)
							.map((part) => part.trim())
							.reduce((acc, part) => {
								const foundMatchKey = Object.keys(
									sharingActionsMapping,
								).find((key) => {
									return part.startsWith(
										sharingActionsMapping[
											key as keyof typeof sharingActionsMapping
										],
									);
								});

								if (foundMatchKey) {
									// @ts-ignore
									acc[foundMatchKey] = part.substring(
										sharingActionsMapping[
											foundMatchKey as keyof typeof sharingActionsMapping
										].length,
										part.length,
									);
								}

								return acc;
							}, {} as LocalGPTAction);

						if (
							quickAddAction.name &&
							(quickAddAction.system || quickAddAction.prompt)
						) {
							await this.addNewAction(quickAddAction);
							text.setValue("");
							this.display();
						}
					});
				});

			quickAdd.descEl.innerHTML = `You can share the best sets prompts or get one <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/2">from the community</a>.<br/><strong>Important:</strong> if you already have an action with the same name it will be overwritten.`;
		} else {
			new Setting(containerEl).setName("Action name").addText((text) => {
				text.setPlaceholder("Summarize selection");
				text.onChange(async (value) => {
					editingAction.name = value;
				});
			});

			new Setting(containerEl)
				.setName("System prompt")
				.setDesc("Optional")
				.addTextArea((text) => {
					text.setPlaceholder("You are a helpful assistant.");
					text.onChange(async (value) => {
						editingAction.system = value;
					});
				});

			new Setting(containerEl).setName("Prompt").addTextArea((text) => {
				text.setPlaceholder("");
				text.onChange(async (value) => {
					editingAction.prompt = value;
				});
			});

			if (this.plugin.settings.selectedProvider === Providers.OLLAMA) {
				new Setting(containerEl)
					.setName("Model")
					.setDesc("Optional")
					.addDropdown((dropdown) =>
						dropdown
							.addOption("", "Default model")
							.addOptions(this.modelsOptions)
							.onChange(async (value) => {
								editingAction.model = value;
							}),
					);
			}

			new Setting(containerEl)
				.setName("Replace selected text")
				.setDesc(
					"If checked, the highlighted text will be replaced with a response from the model.",
				)
				.addToggle((component) => {
					component.onChange(async (value) => {
						editingAction.replace = value;
					});
				});

			new Setting(containerEl)
				.setName("Save action")
				.addButton((button) => {
					button.setButtonText("Close").onClick(async () => {
						this.editEnabled = false;
						this.isNew = false;
						this.display();
					});
				})
				.addButton((button) =>
					button
						.setCta()
						.setButtonText("Save")
						.onClick(async () => {
							if (!editingAction.name) {
								new Notice(
									"Please enter a name for the action.",
								);
								return;
							}

							if (
								this.plugin.settings.actions.find(
									(action) =>
										action.name === editingAction.name,
								)
							) {
								new Notice(
									`An action with the name "${editingAction.name}" already exists.`,
								);
								return;
							}

							if (
								!editingAction.prompt &&
								!editingAction.system
							) {
								new Notice(
									"Please enter a prompt for the action.",
								);
								return;
							}

							await this.addNewAction(editingAction);
							this.editEnabled = false;
							this.isNew = false;
							this.display();
						}),
				);
		}

		containerEl.createEl("h4", { text: "Actions list" });

		let defaultModel = "";
		if (this.plugin.settings.selectedProvider === Providers.OLLAMA) {
			defaultModel = this.plugin.settings.providers.ollama.defaultModel;
		}

		this.plugin.settings.actions.forEach((action) => {
			const sharingString = [
				action.name && `${sharingActionsMapping.name}${action.name}`,
				action.system &&
					`${sharingActionsMapping.system}${action.system}`,
				action.prompt &&
					`${sharingActionsMapping.prompt}${action.prompt}`,
				action.replace &&
					`${sharingActionsMapping.replace}${action.replace}`,
				this.plugin.settings.selectedProvider === Providers.OLLAMA &&
					(action.model || defaultModel) &&
					`${sharingActionsMapping.model}${
						action.model || defaultModel
					}`,
			]
				.filter(Boolean)
				.join(` ${SEPARATOR}\n`);

			const actionLine = new Setting(containerEl)
				.setName(action.name)
				.setDesc("")
				.addButton((button) =>
					button.setIcon("copy").onClick(async () => {
						navigator.clipboard.writeText(sharingString);
						new Notice("Copied");
					}),
				)
				.addButton((button) =>
					button.setButtonText("Remove").onClick(async () => {
						if (!button.buttonEl.hasClass("mod-warning")) {
							button.setClass("mod-warning");
							return;
						}

						this.plugin.settings.actions =
							this.plugin.settings.actions.filter(
								(innerAction) =>
									innerAction.name !== action.name,
							);
						await this.plugin.saveSettings();
						this.display();
					}),
				);
			actionLine.descEl.innerHTML = [
				action.system &&
					`<b>${sharingActionsMapping.system}</b>${action.system}`,
				action.prompt &&
					`<b>${sharingActionsMapping.prompt}</b>${action.prompt}`,
				this.plugin.settings.selectedProvider === Providers.OLLAMA &&
					action.model &&
					`<b>${sharingActionsMapping.model}</b>${action.model}`,
			]
				.filter(Boolean)
				.join("<br/>\n");
		});

		containerEl.createEl("h4", { text: "Danger zone" });
		new Setting(containerEl)
			.setName("Reset actions")
			.setDesc(
				"🚨 Reset all actions to the default. This cannot be undone and will delete all your custom actions.",
			)
			.addButton((button) =>
				button
					.setClass("mod-warning")
					.setButtonText("Reset")
					.onClick(async () => {
						button.setDisabled(true);
						button.buttonEl.setAttribute("disabled", "true");
						button.buttonEl.classList.remove("mod-warning");
						this.plugin.settings.actions = DEFAULT_SETTINGS.actions;
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	async addNewAction(editingAction: LocalGPTAction) {
		const alreadyExistingActionIndex =
			this.plugin.settings.actions.findIndex(
				(action) => action.name === editingAction.name,
			);

		if (alreadyExistingActionIndex >= 0) {
			this.plugin.settings.actions[alreadyExistingActionIndex] =
				editingAction;
			new Notice(`Rewritten "${editingAction.name}" action`);
		} else {
			this.plugin.settings.actions = [
				editingAction,
				...this.plugin.settings.actions,
			];
			new Notice(`Added "${editingAction.name}" action`);
		}
		await this.plugin.saveSettings();
	}
}
