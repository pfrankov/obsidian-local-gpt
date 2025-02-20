import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction } from "./interfaces";
import { waitForAI } from "@obsidian-ai-providers/sdk";

const SEPARATOR = "✂️";

function escapeTitle(title?: string) {
	if (!title) {
		return "";
	}

	return title
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;
	editEnabled = false;
	editExistingAction?: LocalGPTAction;
	modelsOptions: Record<string, string> = {};
	changingOrder = false;

	constructor(app: App, plugin: LocalGPT) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		try {
			const aiProvidersWaiter = await waitForAI();
			const aiProvidersResponse = await aiProvidersWaiter.promise;

			const providers = aiProvidersResponse.providers.reduce(
				(
					acc: Record<string, string>,
					provider: { id: string; name: string; model?: string },
				) => ({
					...acc,
					[provider.id]: provider.model
						? [provider.name, provider.model].join(" ~ ")
						: provider.name,
				}),
				{
					"": "",
				},
			);

			new Setting(containerEl)
				.setHeading()
				.setName("Main AI Provider")
				.setClass("ai-providers-select")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(providers)
						.setValue(String(this.plugin.settings.aiProviders.main))
						.onChange(async (value) => {
							this.plugin.settings.aiProviders.main = value;
							await this.plugin.saveSettings();
							await this.display();
						}),
				);

			new Setting(containerEl)
				.setName("Embedding AI Provider")
				.setDesc("Optional. Used for ✨ Enhanced Actions.")
				.setClass("ai-providers-select")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(providers)
						.setValue(
							String(this.plugin.settings.aiProviders.embedding),
						)
						.onChange(async (value) => {
							this.plugin.settings.aiProviders.embedding = value;
							await this.plugin.saveSettings();
							await this.display();
						}),
				);

			new Setting(containerEl)
				.setName("Vision AI Provider")
				.setClass("ai-providers-select")
				.setDesc("Optional. This is used for images. If not set, the main AI provider will be used.")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(providers)
						.setValue(
							String(this.plugin.settings.aiProviders.vision),
						)
						.onChange(async (value) => {
							this.plugin.settings.aiProviders.vision = value;
							await this.plugin.saveSettings();
							await this.display();
						}),
				);

			new Setting(containerEl)
				.setName("Creativity")
				.setDesc("")
				.addDropdown((dropdown) => {
					dropdown
						.addOption("", "⚪ None")
						.addOptions({
							low: "️💡 Low",
							medium: "🎨 Medium",
							high: "🚀 High",
						})
						.setValue(
							String(this.plugin.settings.defaults.creativity) ||
								"",
						)
						.onChange(async (value) => {
							this.plugin.settings.defaults.creativity = value;
							await this.plugin.saveSettings();
							await this.display();
						});
				});
		} catch (error) {
			console.error(error);
		}

		const editingAction: LocalGPTAction = this.editExistingAction || {
			name: "",
			prompt: "",
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

		containerEl.createEl("div", { cls: "local-gpt-settings-separator" });

		containerEl.createEl("h3", { text: "Actions" });

		if (!this.editEnabled) {
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

						if (quickAddAction.name) {
							await this.addNewAction(quickAddAction);
							text.setValue("");
							this.display();
						}
					});
				});

			quickAdd.descEl.innerHTML = `You can share the best sets prompts or get one <a href="https://github.com/pfrankov/obsidian-local-gpt/discussions/2">from the community</a>.<br/><strong>Important:</strong> if you already have an action with the same name it will be overwritten.`;

			new Setting(containerEl)
				.setName("Add new manually")
				.addButton((button) =>
					button.setIcon("plus").onClick(async () => {
						this.editEnabled = true;
						this.editExistingAction = undefined;
						this.display();
					}),
				);
		} else {
			new Setting(containerEl).setName("Action name").addText((text) => {
				editingAction?.name && text.setValue(editingAction.name);
				text.inputEl.style.minWidth = "100%";
				text.setPlaceholder("Summarize selection");
				text.onChange(async (value) => {
					editingAction.name = value;
				});
			});

			new Setting(containerEl)
				.setName("System prompt")
				.setDesc("Optional")
				.addTextArea((text) => {
					editingAction?.system &&
						text.setValue(editingAction.system);
					text.inputEl.style.minWidth = "100%";
					text.inputEl.style.minHeight = "6em";
					text.inputEl.style.resize = "vertical";
					text.setPlaceholder("You are a helpful assistant.");
					text.onChange(async (value) => {
						editingAction.system = value;
					});
				});

			const promptSetting = new Setting(containerEl)
				.setName("Prompt")
				.setDesc("")
				.addTextArea((text) => {
					editingAction?.prompt &&
						text.setValue(editingAction.prompt);
					text.inputEl.style.minWidth = "100%";
					text.inputEl.style.minHeight = "6em";
					text.inputEl.style.resize = "vertical";
					text.setPlaceholder("");
					text.onChange(async (value) => {
						editingAction.prompt = value;
					});
				});

			promptSetting.descEl.innerHTML = `Please read about<br/><a href="https://github.com/pfrankov/obsidian-local-gpt/blob/master/docs/prompt-templating.md">Prompt templating</a><br/>if you want to customize<br/>your resulting prompts`;

			new Setting(containerEl)
				.setName("Replace selected text")
				.setDesc(
					"If checked, the highlighted text will be replaced with a response from the model.",
				)
				.addToggle((component) => {
					editingAction?.replace &&
						component.setValue(editingAction.replace);
					component.onChange(async (value) => {
						editingAction.replace = value;
					});
				});

			const actionButtonsRow = new Setting(containerEl).setName("");

			if (this.editExistingAction) {
				actionButtonsRow.addButton((button) => {
					button.buttonEl.style.marginRight = "2em";
					button.setButtonText("Remove").onClick(async () => {
						if (!button.buttonEl.hasClass("mod-warning")) {
							button.setClass("mod-warning");
							return;
						}

						this.plugin.settings.actions =
							this.plugin.settings.actions.filter(
								(innerAction) => innerAction !== editingAction,
							);
						await this.plugin.saveSettings();
						this.editExistingAction = undefined;
						this.editEnabled = false;
						this.display();
					});
				});
			}

			actionButtonsRow
				.addButton((button) => {
					button.setButtonText("Close").onClick(async () => {
						this.editEnabled = false;
						this.editExistingAction = undefined;
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

							if (!this.editExistingAction) {
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

								await this.addNewAction(editingAction);
							} else {
								if (
									this.plugin.settings.actions.filter(
										(action) =>
											action.name === editingAction.name,
									).length > 1
								) {
									new Notice(
										`An action with the name "${editingAction.name}" already exists.`,
									);
									return;
								}

								const index =
									this.plugin.settings.actions.findIndex(
										(innerAction) =>
											innerAction === editingAction,
									);

								this.plugin.settings.actions[index] =
									editingAction;
							}

							await this.plugin.saveSettings();

							this.editEnabled = false;
							this.editExistingAction = undefined;
							this.display();
						}),
				);
		}

		containerEl.createEl("h4", { text: "Actions list" });

		this.plugin.settings.actions.forEach((action, actionIndex) => {
			const sharingString = [
				action.name && `${sharingActionsMapping.name}${action.name}`,
				action.system &&
					`${sharingActionsMapping.system}${action.system}`,
				action.prompt &&
					`${sharingActionsMapping.prompt}${action.prompt}`,
				action.replace &&
					`${sharingActionsMapping.replace}${action.replace}`,
			]
				.filter(Boolean)
				.join(` ${SEPARATOR}\n`);

			if (!this.changingOrder) {
				const actionRow = new Setting(containerEl)
					.setName(action.name)
					.setDesc("")
					.addButton((button) =>
						button.setIcon("copy").onClick(async () => {
							navigator.clipboard.writeText(sharingString);
							new Notice("Copied");
						}),
					)
					.addButton((button) =>
						button.setButtonText("Edit").onClick(async () => {
							this.editEnabled = true;
							this.editExistingAction =
								this.plugin.settings.actions.find(
									(innerAction) =>
										innerAction.name == action.name,
								);
							this.display();
						}),
					);

				const systemTitle = escapeTitle(action.system);

				const promptTitle = escapeTitle(action.prompt);

				actionRow.descEl.innerHTML = [
					action.system &&
						`<div title="${systemTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
							<b>${sharingActionsMapping.system}</b>${action.system}</div>`,
					action.prompt &&
						`<div title="${promptTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
							<b>${sharingActionsMapping.prompt}</b>${action.prompt}
						</div>`,
				]
					.filter(Boolean)
					.join("<br/>\n");
			} else {
				const actionRow = new Setting(containerEl)
					.setName(action.name)
					.setDesc("");

				if (actionIndex > 0) {
					actionRow.addButton((button) =>
						button.setIcon("arrow-up").onClick(async () => {
							const prev =
								this.plugin.settings.actions[actionIndex - 1];
							this.plugin.settings.actions[actionIndex - 1] =
								action;
							this.plugin.settings.actions[actionIndex] = prev;
							await this.plugin.saveSettings();
							this.display();
						}),
					);
				}
				if (actionIndex < this.plugin.settings.actions.length - 1) {
					actionRow.addButton((button) =>
						button.setIcon("arrow-down").onClick(async () => {
							const next =
								this.plugin.settings.actions[actionIndex + 1];
							this.plugin.settings.actions[actionIndex + 1] =
								action;
							this.plugin.settings.actions[actionIndex] = next;
							await this.plugin.saveSettings();
							this.display();
						}),
					);
				}
			}
		});

		if (this.plugin.settings.actions.length) {
			new Setting(containerEl).setName("").addButton((button) => {
				this.changingOrder && button.setCta();
				button
					.setButtonText(this.changingOrder ? "Done" : "Change order")
					.onClick(async () => {
						this.changingOrder = !this.changingOrder;
						this.display();
					});
			});
		}

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
