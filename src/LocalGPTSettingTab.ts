import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import { I18n } from "./i18n";
import { ensureActionId, ensureActionIds } from "./actionUtils";
import { buildCommunityActionSignature } from "./CommunityActionsService";
import { renderActionEditor as renderActionEditorForm } from "./settingsActionEditor";
import {
	SEPARATOR,
	normalizeLanguageCode,
	quickAddHandlers,
	sharingEntries,
} from "./settingsTabUtils";
import {
	captureScrollPosition as captureScrollSnapshot,
	restoreScrollPosition as restoreScrollSnapshot,
	type PendingScrollRestore,
	type ScrollAlign,
} from "./settingsScroll";
import { openCommunityActionsModal } from "./settingsCommunityActionsModal";
import { renderActionsList } from "./settingsActionsList";

export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;
	editEnabled = false;
	editExistingAction?: LocalGPTAction;
	modelsOptions: Record<string, string> = {};
	// Controls visibility of the Advanced settings section
	private isAdvancedMode = false;
	private pendingScroll?: {
		action: LocalGPTAction;
		align: ScrollAlign;
		target: "form" | "row";
	};
	private pendingScrollRestore?: PendingScrollRestore;
	private communityActionsLanguage?: string;
	private communityActionsStatusMessage = "";
	private communityActionsRenderId = 0;
	// Guard to require a second click before destructive reset
	private isConfirmingReset = false;

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
				.setClass("local-gpt-ai-providers-select")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(providers)
						.setValue(String(this.plugin.settings.aiProviders.main))
						.onChange(async (value) => {
							this.plugin.settings.aiProviders.main = value;
							// Also update Action Palette override to follow new default
							this.plugin.actionPaletteProviderId = value;
							await this.plugin.saveSettings();
							await this.display();
						}),
				);

			new Setting(containerEl)
				.setName(I18n.t("settings.embeddingProvider"))
				.setDesc(I18n.t("settings.embeddingProviderDesc"))
				.setClass("local-gpt-ai-providers-select")
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
				.setClass("local-gpt-ai-providers-select")
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

		const defaultCommunityActionsLanguage = normalizeLanguageCode(
			window.localStorage.getItem("language"),
		);

		const isEditingExisting = Boolean(this.editExistingAction);
		const isEditingNew = this.editEnabled && !isEditingExisting;
		const dropCommunityLinkIfModified = (action: LocalGPTAction) => {
			if (!action.community?.hash) {
				return;
			}
			const localSignature = buildCommunityActionSignature(action);
			if (localSignature !== action.community.hash) {
				delete action.community;
			}
		};

		const closeActionEditor = (scrollAction?: LocalGPTAction) => {
			this.editEnabled = false;
			this.editExistingAction = undefined;
			this.pendingScroll = scrollAction
				? {
						action: scrollAction,
						align: "center",
						target: "row",
					}
				: undefined;
			this.display();
		};

		const captureScrollPosition = (anchor: HTMLElement) => {
			this.pendingScrollRestore = captureScrollSnapshot(anchor);
		};

		const restoreScrollPosition = (anchor: HTMLElement) => {
			this.pendingScrollRestore = restoreScrollSnapshot(
				anchor,
				this.pendingScrollRestore,
			);
		};

		containerEl.createEl("div", { cls: "local-gpt-settings-separator" });

		containerEl.createEl("h3", { text: I18n.t("settings.actions") });

		if (!isEditingNew) {
			const quickAdd = new Setting(containerEl)
				.setName(I18n.t("settings.quickAdd"))
				.setDesc("")
				.addText((text) => {
					text.inputEl.classList.add("local-gpt-action-input");
					text.setPlaceholder(I18n.t("settings.quickAddPlaceholder"));
					text.onChange(async (value) => {
						const parts = value
							.split(SEPARATOR)
							.map((part) => part.trim())
							.filter(Boolean);
						if (!parts.length) {
							return;
						}

						const quickAddAction: LocalGPTAction = {
							name: "",
							prompt: "",
						};

						for (const part of parts) {
							const entry = sharingEntries.find(([, label]) =>
								part.startsWith(label),
							);
							const key = entry?.[0];
							const label = entry?.[1];
							const rawValue = label
								? part.slice(label.length).trim()
								: "";
							if (!key || !rawValue) {
								continue;
							}
							const handler = quickAddHandlers[key];
							if (handler) {
								handler(rawValue, quickAddAction);
							}
						}

						if (quickAddAction.name) {
							await this.addNewAction(quickAddAction);
							text.setValue("");
							this.display();
						}
					});
				});

			quickAdd.descEl.innerHTML = I18n.t("settings.quickAddDesc");

			new Setting(containerEl)
				.setName(I18n.t("settings.communityActions"))
				.setDesc(I18n.t("settings.communityActionsOpenDesc"))
				.addButton((button) => {
					button
						.setButtonText(I18n.t("settings.communityActionsOpen"))
						.setCta()
						.onClick(() =>
							openCommunityActionsModal({
								app: this.app,
								plugin: this.plugin,
								containerEl,
								defaultCommunityActionsLanguage,
								getLanguage: () =>
									this.communityActionsLanguage,
								setLanguage: (language) => {
									this.communityActionsLanguage = language;
								},
								getStatusMessage: () =>
									this.communityActionsStatusMessage,
								setStatusMessage: (message) => {
									this.communityActionsStatusMessage =
										message;
								},
								getRenderId: () =>
									this.communityActionsRenderId,
								setRenderId: (renderId) => {
									this.communityActionsRenderId = renderId;
								},
								captureScrollPosition,
								setPendingScroll: (pendingScroll) => {
									this.pendingScroll = pendingScroll;
								},
								addNewAction: (action) =>
									this.addNewAction(action),
								display: () => this.display(),
							}),
						);
				});

			const addActionsRow = new Setting(containerEl)
				.setName(I18n.t("settings.addNewManually"))
				.setClass("local-gpt-add-actions");

			addActionsRow
				.addButton((button) =>
					button
						.setCta()
						.setButtonText(I18n.t("settings.addAction"))
						.onClick(async () => {
							this.editEnabled = true;
							this.editExistingAction = undefined;
							this.display();
						}),
				)
				.addButton((button) =>
					button
						.setButtonText(I18n.t("settings.addSeparator"))
						.onClick(async () => {
							captureScrollPosition(containerEl);
							await this.addSeparator();
							this.display();
						}),
				);
		} else {
			renderActionEditorForm({
				container: containerEl,
				plugin: this.plugin,
				actionToEdit: editingAction,
				isExistingAction: false,
				closeActionEditor,
				addNewAction: (action) => this.addNewAction(action),
				dropCommunityLinkIfModified,
			});
		}

		renderActionsList({
			containerEl,
			plugin: this.plugin,
			editExistingAction: this.editExistingAction,
			defaultCommunityActionsLanguage,
			getPendingScroll: () => this.pendingScroll,
			setPendingScroll: (pendingScroll) => {
				this.pendingScroll = pendingScroll;
			},
			restoreScrollPosition,
			closeActionEditor,
			addNewAction: (action) => this.addNewAction(action),
			dropCommunityLinkIfModified,
			startEditingAction: (action) => {
				this.editEnabled = false;
				this.pendingScroll = {
					action,
					align: "start",
					target: "form",
				};
				this.editExistingAction = action;
				this.display();
			},
			display: () => this.display(),
		});

		// Advanced settings toggle (similar to AI Providers "For developers")
		new Setting(containerEl)
			.setHeading()
			.setName(I18n.t("settings.advancedSettings"))
			.setDesc(I18n.t("settings.advancedSettingsDesc"))
			.setClass("local-gpt-advanced-toggle")
			.addToggle((toggle) =>
				toggle.setValue(this.isAdvancedMode).onChange((value) => {
					this.isAdvancedMode = value;
					this.display();
				}),
			);

		if (this.isAdvancedMode) {
			// Group: ✨ Enhanced Actions (RAG) — styled container
			const enhancedSection = containerEl.createDiv(
				"local-gpt-advanced-group",
			);
			enhancedSection.createEl("h4", {
				text: I18n.t("settings.enhancedActions"),
			});
			new Setting(enhancedSection)
				.setName(I18n.t("settings.enhancedActionsLabel"))
				.setDesc(I18n.t("settings.enhancedActionsDesc"))
				.setClass("local-gpt-ai-providers-select")
				.addDropdown((dropdown) => {
					// Preset options with non-numeric labels
					dropdown
						.addOptions({
							local: I18n.t("settings.contextLimitLocal"),
							cloud: I18n.t("settings.contextLimitCloud"),
							advanced: I18n.t("settings.contextLimitAdvanced"),
							max: I18n.t("settings.contextLimitMax"),
						})
						.setValue(
							String(
								this.plugin.settings.defaults.contextLimit ||
									"local",
							),
						)
						.onChange(async (value) => {
							this.plugin.settings.defaults.contextLimit = value;
							await this.plugin.saveSettings();
						});
				});

			// Group: Danger zone — reset all actions (moved here as-is) in a styled container
			const dangerSection = containerEl.createDiv(
				"local-gpt-advanced-group",
			);
			dangerSection.createEl("h4", {
				text: I18n.t("settings.dangerZone"),
			});
			new Setting(dangerSection)
				.setName(I18n.t("settings.resetActions"))
				.setDesc(I18n.t("settings.resetActionsDesc"))
				.addButton((button) =>
					button
						.setClass("mod-warning")
						.setButtonText(I18n.t("settings.reset"))
						.onClick(async () => {
							if (!this.isConfirmingReset) {
								this.isConfirmingReset = true;
								button.setButtonText(
									I18n.t("settings.confirmReset"),
								);
								return;
							}

							button.setDisabled(true);
							button.buttonEl.setAttribute("disabled", "true");
							button.buttonEl.classList.remove("mod-warning");
							this.plugin.settings.actions = ensureActionIds(
								DEFAULT_SETTINGS.actions.map((action) => ({
									...action,
								})),
							).actions;
							await this.plugin.saveSettings();
							this.isConfirmingReset = false;
							this.display();
						}),
				);
		}
	}

	async addNewAction(editingAction: LocalGPTAction) {
		const actionWithId = ensureActionId(editingAction);
		const alreadyExistingActionIndex =
			this.plugin.settings.actions.findIndex(
				(action) => action.name === actionWithId.name,
			);

		if (alreadyExistingActionIndex >= 0) {
			this.plugin.settings.actions[alreadyExistingActionIndex] =
				actionWithId;
			new Notice(
				I18n.t("notices.actionRewritten", { name: actionWithId.name }),
			);
		} else {
			this.plugin.settings.actions = [
				actionWithId,
				...this.plugin.settings.actions,
			];
			new Notice(
				I18n.t("notices.actionAdded", { name: actionWithId.name }),
			);
		}
		await this.plugin.saveSettings();
	}

	async addSeparator() {
		const separatorAction: LocalGPTAction = ensureActionId({
			name: "separator",
			prompt: "",
			separator: true,
		});
		this.plugin.settings.actions = [
			separatorAction,
			...this.plugin.settings.actions,
		];
		await this.plugin.saveSettings();
	}
}
