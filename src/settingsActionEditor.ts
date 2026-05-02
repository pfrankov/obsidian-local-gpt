import { Notice, Setting } from "obsidian";
import type LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import { ensureActionId } from "./actionUtils";

interface RenderActionEditorOptions {
	container: HTMLElement;
	plugin: LocalGPT;
	actionToEdit: LocalGPTAction;
	isExistingAction: boolean;
	closeActionEditor: (scrollAction?: LocalGPTAction) => void;
	addNewAction: (action: LocalGPTAction) => Promise<void>;
	dropCommunityLinkIfModified: (action: LocalGPTAction) => void;
}

export function renderActionEditor({
	container,
	plugin,
	actionToEdit,
	isExistingAction,
	closeActionEditor,
	addNewAction,
	dropCommunityLinkIfModified,
}: RenderActionEditorOptions) {
	new Setting(container)
		.setName(I18n.t("settings.actionName"))
		.addText((text) => {
			text.inputEl.classList.add("local-gpt-action-input");
			actionToEdit?.name && text.setValue(actionToEdit.name);
			text.setPlaceholder(I18n.t("settings.actionNamePlaceholder"));
			text.onChange(async (value) => {
				actionToEdit.name = value;
			});
		});

	new Setting(container)
		.setName(I18n.t("settings.systemPrompt"))
		.setDesc(I18n.t("settings.systemPromptDesc"))
		.addTextArea((text) => {
			text.inputEl.classList.add("local-gpt-action-textarea");
			actionToEdit?.system && text.setValue(actionToEdit.system);
			text.setPlaceholder(I18n.t("settings.systemPromptPlaceholder"));
			text.onChange(async (value) => {
				actionToEdit.system = value;
			});
		});

	const promptSetting = new Setting(container)
		.setName(I18n.t("settings.prompt"))
		.setDesc("")
		.addTextArea((text) => {
			text.inputEl.classList.add("local-gpt-action-textarea");
			actionToEdit?.prompt && text.setValue(actionToEdit.prompt);
			text.setPlaceholder("");
			text.onChange(async (value) => {
				actionToEdit.prompt = value;
			});
		});

	promptSetting.descEl.innerHTML = I18n.t("settings.promptDesc");

	new Setting(container)
		.setName(I18n.t("settings.replaceSelected"))
		.setDesc(I18n.t("settings.replaceSelectedDesc"))
		.addToggle((component) => {
			actionToEdit?.replace && component.setValue(actionToEdit.replace);
			component.onChange(async (value) => {
				actionToEdit.replace = value;
			});
		});

	const actionButtonsRow = new Setting(container).setName("");

	if (isExistingAction) {
		actionButtonsRow.addButton((button) => {
			button.setClass("local-gpt-action-remove");
			button
				.setButtonText(I18n.t("settings.remove"))
				.onClick(async () => {
					if (!button.buttonEl.hasClass("mod-warning")) {
						button.setClass("mod-warning");
						return;
					}

					plugin.settings.actions = plugin.settings.actions.filter(
						(innerAction) => innerAction !== actionToEdit,
					);
					await plugin.saveSettings();
					closeActionEditor();
				});
		});
	}

	actionButtonsRow
		.addButton((button) => {
			button.setButtonText(I18n.t("settings.close")).onClick(async () => {
				closeActionEditor(isExistingAction ? actionToEdit : undefined);
			});
		})
		.addButton((button) =>
			button
				.setCta()
				.setButtonText(I18n.t("settings.save"))
				.onClick(async () => {
					if (!actionToEdit.name) {
						new Notice(I18n.t("notices.actionNameRequired"));
						return;
					}
					const actionToSave = ensureActionId(actionToEdit);

					if (!isExistingAction) {
						if (
							plugin.settings.actions.find(
								(action) => action.name === actionToSave.name,
							)
						) {
							new Notice(
								I18n.t("notices.actionNameExists", {
									name: actionToSave.name,
								}),
							);
							return;
						}

						await addNewAction(actionToSave);
					} else {
						if (
							plugin.settings.actions.filter(
								(action) => action.name === actionToSave.name,
							).length > 1
						) {
							new Notice(
								I18n.t("notices.actionNameExists", {
									name: actionToSave.name,
								}),
							);
							return;
						}

						dropCommunityLinkIfModified(actionToSave);

						const index = plugin.settings.actions.findIndex(
							(innerAction) => innerAction === actionToEdit,
						);

						if (index >= 0) {
							plugin.settings.actions[index] = actionToSave;
						}
					}

					await plugin.saveSettings();
					closeActionEditor(actionToSave);
				}),
		);
}
