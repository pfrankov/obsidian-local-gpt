import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import {DEFAULT_SETTINGS} from "defaultSettings";
import LocalGPT from "./main";
import {LocalGPTAction} from "./interfaces";

export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;
	editEnabled: boolean = false;
	isNew: boolean = false;

	constructor(app: App, plugin: LocalGPT) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Ollama URL")
			.setDesc("Default is http://localhost:11434")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:11434")
					.setValue(this.plugin.settings.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("Name of the default Ollama model to use for prompts")
			.addText((text) =>
				text
					.setPlaceholder("llama2")
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value;
						await this.plugin.saveSettings();
					})
			);

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

			new Setting(containerEl)
				.setName("Model")
				.setDesc('Optional')
				.addText((text) => {
					text.setPlaceholder(this.plugin.settings.defaultModel);
					text.onChange(async (value) => {
						editingAction.model = value;
					});
				});

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
