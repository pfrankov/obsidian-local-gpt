import {App, Notice, PluginSettingTab, requestUrl, Setting} from "obsidian";
import {DEFAULT_SETTINGS} from "defaultSettings";
import LocalGPT from "./main";
import {LocalGPTAction, Providers} from "./interfaces";

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
		const {containerEl} = this;

		containerEl.empty();

		const aiProvider = new Setting(containerEl)
			.setName('AI provider')
			.setDesc('')
			.addDropdown(dropdown =>
				dropdown.addOptions({
						[Providers.OLLAMA]: 'Ollama',
					})
					.setValue(String(this.plugin.settings.selectedProvider))
					.onChange(async (value) => {
						this.plugin.settings.selectedProvider = value;
						await this.plugin.saveSettings();
						this.display()
					})
			)

		aiProvider.descEl.innerHTML = `If you would like to use other providers, please let me know <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/1">in the discussions</a>`

		if (this.plugin.settings.selectedProvider === Providers.OLLAMA) {
			new Setting(containerEl)
				.setName("Ollama URL")
				.setDesc("Default is http://localhost:11434")
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(this.plugin.settings.providers.ollama.ollamaUrl)
						.onChange(async (value) => {
							this.plugin.settings.providers.ollama.ollamaUrl = value;
							await this.plugin.saveSettings();
						})
				);

			const ollamaDefaultModel = new Setting(containerEl)
				.setName("Default model")
				.setDesc("Name of the default Ollama model to use for prompts")
			if (this.plugin.settings.providers.ollama.ollamaUrl) {
				requestUrl(`${this.plugin.settings.providers.ollama.ollamaUrl}/api/tags`)
					.then(({json}) => {
						if (!json.models || json.models.length === 0) {
							return Promise.reject();
						}
						this.modelsOptions = json.models.reduce((acc: any, el:any) => {
							const name = el.name.replace(":latest", "");
							acc[name] = name;
							return acc;
						}, {})

						ollamaDefaultModel
							.addDropdown(dropdown =>
								dropdown.addOptions(this.modelsOptions)
									.setValue(String(this.plugin.settings.providers.ollama.defaultModel))
									.onChange(async (value) => {
										this.plugin.settings.providers.ollama.defaultModel = value;
										await this.plugin.saveSettings();
									})

							)
							.addButton((button) =>
								button.setIcon('refresh-cw').onClick(async () => {
									this.display()
								})
							)
					})
					.catch(() => {
						ollamaDefaultModel.descEl.innerHTML = `Get the models from <a href="https://ollama.ai/library">Ollama library</a> or check that Ollama URL is correct.`
						ollamaDefaultModel.addButton((button) =>
								button.setIcon('refresh-cw').onClick(async () => {
									this.display()
								})
							)
					})
			}
		}


		const editingAction: LocalGPTAction = {
			name: "",
			prompt: "",
			model: "",
			temperature: undefined,
			system: "",
			replace: false
		};

		containerEl.createEl("h3", {text: "Actions"});

		if (!this.editEnabled) {
			new Setting(containerEl)
				.setName('Add new')
				.addButton((button) =>
					button.setIcon('plus').onClick(async () => {
						this.editEnabled = true;
						this.isNew = true;
						this.display()
					})
				);
		} else {
			new Setting(containerEl).setName("Action name").addText((text) => {
				text.setPlaceholder("Summarize selection");
				text.onChange(async (value) => {
					editingAction.name = value;
				});
			});


			new Setting(containerEl)
				.setName("System prompt")
				.setDesc('Optional')
				.addTextArea((text) => {
					text.setPlaceholder(
						"You are a helpful assistant."
					);
					text.onChange(async (value) => {
						editingAction.system = value;
					});
				});

			new Setting(containerEl)
				.setName("Prompt")
				.addTextArea((text) => {
					text.setPlaceholder(
						""
					);
					text.onChange(async (value) => {
						editingAction.prompt = value;
					});
				});

			if (this.plugin.settings.selectedProvider === Providers.OLLAMA) {
				new Setting(containerEl)
					.setName("Model")
					.setDesc('Optional')
					.addDropdown(dropdown =>
						dropdown
							.addOption('', 'Default model')
							.addOptions(this.modelsOptions)
							.onChange(async (value) => {
								editingAction.model = value;
							})

					)
			}

			new Setting(containerEl)
				.setName("Replace selected text")
				.setDesc('If checked, the highlighted text will be replaced with a response from the model.')
				.addToggle((component) => {
					component.onChange(async (value) => {
						editingAction.replace = value;
					});
				});

			new Setting(containerEl)
				.setName("Save action")
				.addButton((button) =>
					button.setCta()
						.setButtonText("Save")
						.onClick(async () => {
							if (!editingAction.name) {
								new Notice("Please enter a name for the action.");
								return;
							}

							if (
								this.plugin.settings.actions.find(
									(action) => action.name === editingAction.name
								)
							) {
								new Notice(
									`An action with the name "${editingAction.name}" already exists.`
								);
								return;
							}

							if (!editingAction.prompt && !editingAction.system) {
								new Notice("Please enter a prompt for the action.");
								return;
							}


							this.plugin.settings.actions = [editingAction, ...this.plugin.settings.actions];
							await this.plugin.saveSettings();
							this.editEnabled = false;
							this.isNew = false;
							this.display();
						})
				);
		}


		containerEl.createEl("h4", {text: "Actions List"});

		this.plugin.settings.actions.forEach((action) => {
			new Setting(containerEl)
				.setName(action.name)
				.setDesc([
					action.system && `System: ${action.system}`,
					action.prompt && `${action.prompt}`,
					action.model && `Model: ${action.model}`
				].filter(x => x).join(' ✂️ '))
				.addButton((button) =>
					button.setButtonText("Remove").onClick(async () => {
						this.plugin.settings.actions =
							this.plugin.settings.actions.filter(
								(action) => action.name !== action.name
							);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		});

		containerEl.createEl("h4", {text: "Danger zone"});
		new Setting(containerEl)
			.setName("Reset actions")
			.setDesc(
				"🚨 Reset all actions to the default. This cannot be undone and will delete all your custom actions."
			)
			.addButton((button) =>
				button.setClass('mod-warning')
					.setButtonText("Reset")
					.onClick(async () => {
						button.setDisabled(true);
						button.buttonEl.setAttribute('disabled', 'true');
						button.buttonEl.classList.remove('mod-warning');
						this.plugin.settings.actions = DEFAULT_SETTINGS.actions;
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
