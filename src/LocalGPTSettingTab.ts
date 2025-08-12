import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction } from "./interfaces";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import { I18n } from "./i18n";

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
				.setName(I18n.t("settings.mainProvider"))
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
				.setName(I18n.t("settings.embeddingProvider"))
				.setDesc(I18n.t("settings.embeddingProviderDesc"))
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
				.setName(I18n.t("settings.visionProvider"))
				.setClass("ai-providers-select")
				.setDesc(I18n.t("settings.visionProviderDesc"))
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
				.setName(I18n.t("settings.creativity"))
				.setDesc("")
				.addDropdown((dropdown) => {
					dropdown
						.addOption("", I18n.t("settings.creativityNone"))
						.addOptions({
							low: I18n.t("settings.creativityLow"),
							medium: I18n.t("settings.creativityMedium"),
							high: I18n.t("settings.creativityHigh"),
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

		containerEl.createEl("h3", { text: I18n.t("settings.actions") });

		if (!this.editEnabled) {
			const quickAdd = new Setting(containerEl)
				.setName(I18n.t("settings.quickAdd"))
				.setDesc("")
				.addText((text) => {
					text.inputEl.style.minWidth = "100%";
					text.setPlaceholder(I18n.t("settings.quickAddPlaceholder"));
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

			quickAdd.descEl.innerHTML = I18n.t("settings.quickAddDesc");

			new Setting(containerEl)
				.setName(I18n.t("settings.addNewManually"))
				.addButton((button) =>
					button.setIcon("plus").onClick(async () => {
						this.editEnabled = true;
						this.editExistingAction = undefined;
						this.display();
					}),
				);
		} else {
			new Setting(containerEl)
				.setName(I18n.t("settings.actionName"))
				.addText((text) => {
					editingAction?.name && text.setValue(editingAction.name);
					text.inputEl.style.minWidth = "100%";
					text.setPlaceholder(
						I18n.t("settings.actionNamePlaceholder"),
					);
					text.onChange(async (value) => {
						editingAction.name = value;
					});
				});

			new Setting(containerEl)
				.setName(I18n.t("settings.systemPrompt"))
				.setDesc(I18n.t("settings.systemPromptDesc"))
				.addTextArea((text) => {
					editingAction?.system &&
						text.setValue(editingAction.system);
					text.inputEl.style.minWidth = "100%";
					text.inputEl.style.minHeight = "6em";
					text.inputEl.style.resize = "vertical";
					text.setPlaceholder(
						I18n.t("settings.systemPromptPlaceholder"),
					);
					text.onChange(async (value) => {
						editingAction.system = value;
					});
				});

			const promptSetting = new Setting(containerEl)
				.setName(I18n.t("settings.prompt"))
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

			promptSetting.descEl.innerHTML = I18n.t("settings.promptDesc");

			new Setting(containerEl)
				.setName(I18n.t("settings.replaceSelected"))
				.setDesc(I18n.t("settings.replaceSelectedDesc"))
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
					button
						.setButtonText(I18n.t("settings.remove"))
						.onClick(async () => {
							if (!button.buttonEl.hasClass("mod-warning")) {
								button.setClass("mod-warning");
								return;
							}

							this.plugin.settings.actions =
								this.plugin.settings.actions.filter(
									(innerAction) =>
										innerAction !== editingAction,
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
					button
						.setButtonText(I18n.t("settings.close"))
						.onClick(async () => {
							this.editEnabled = false;
							this.editExistingAction = undefined;
							this.display();
						});
				})
				.addButton((button) =>
					button
						.setCta()
						.setButtonText(I18n.t("settings.save"))
						.onClick(async () => {
							if (!editingAction.name) {
								new Notice(
									I18n.t("notices.actionNameRequired"),
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
										I18n.t("notices.actionNameExists", {
											name: editingAction.name,
										}),
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
										I18n.t("notices.actionNameExists", {
											name: editingAction.name,
										}),
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

		containerEl.createEl("h4", { text: I18n.t("settings.actionsList") });

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
							new Notice(I18n.t("notices.copied"));
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
					.setButtonText(
						this.changingOrder
							? I18n.t("settings.done")
							: I18n.t("settings.changeOrder"),
					)
					.onClick(async () => {
						this.changingOrder = !this.changingOrder;
						this.display();
					});
			});
		}

		containerEl.createEl("h4", { text: I18n.t("settings.dangerZone") });
		new Setting(containerEl)
			.setName(I18n.t("settings.resetActions"))
			.setDesc(I18n.t("settings.resetActionsDesc"))
			.addButton((button) =>
				button
					.setClass("mod-warning")
					.setButtonText(I18n.t("settings.reset"))
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
			new Notice(
				I18n.t("notices.actionRewritten", { name: editingAction.name }),
			);
		} else {
			this.plugin.settings.actions = [
				editingAction,
				...this.plugin.settings.actions,
			];
			new Notice(
				I18n.t("notices.actionAdded", { name: editingAction.name }),
			);
		}
		await this.plugin.saveSettings();
	}
}
