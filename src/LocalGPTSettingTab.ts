import {
	App,
	Notice,
	Platform,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction } from "./interfaces";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import { I18n } from "./i18n";
import Sortable from "sortablejs";
import { isSeparatorAction, moveAction } from "./actionUtils";

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
	// Controls visibility of the Advanced settings section
	private isAdvancedMode = false;
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
				.setClass("ai-providers-select")
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
							await this.addSeparator();
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

		const actionsContainer = containerEl.createDiv(
			"local-gpt-actions-container",
		);

		const isMobile = Platform.isMobile || Platform.isMobileApp;

		const updateOrder = async (fromIndex: number, toIndex: number) => {
			const updatedActions = moveAction(
				this.plugin.settings.actions,
				fromIndex,
				toIndex,
			);
			if (updatedActions === this.plugin.settings.actions) {
				return;
			}
			this.plugin.settings.actions = updatedActions;
			await this.plugin.saveSettings();
		};

		const addMobileMoveButtons = (row: Setting, actionIndex: number) => {
			if (!isMobile) return;

			row.addExtraButton((button) => {
				button
					.setIcon("chevron-up")
					.setTooltip(I18n.t("settings.moveUp"))
					.onClick(async () => {
						await updateOrder(actionIndex, actionIndex - 1);
						this.display();
					});
				if (actionIndex === 0) {
					button.setDisabled(true);
				}
			});

			row.addExtraButton((button) => {
				button
					.setIcon("chevron-down")
					.setTooltip(I18n.t("settings.moveDown"))
					.onClick(async () => {
						await updateOrder(actionIndex, actionIndex + 1);
						this.display();
					});
				if (actionIndex === this.plugin.settings.actions.length - 1) {
					button.setDisabled(true);
				}
			});
		};

		this.plugin.settings.actions.forEach((action, actionIndex) => {
			const isSeparator = isSeparatorAction(action);
			const actionRow = new Setting(actionsContainer)
				.setName(isSeparator ? "" : action.name)
				.setDesc("");

			actionRow.settingEl.addClass("local-gpt-action-row");
			if (isSeparator) {
				actionRow.settingEl.addClass("local-gpt-action-separator");
				actionRow.settingEl.setAttribute(
					"aria-label",
					I18n.t("settings.separator"),
				);
			}

			const handle = actionRow.settingEl.createDiv(
				"local-gpt-drag-handle",
			);
			setIcon(handle, "grip-vertical");
			actionRow.settingEl.prepend(handle);

			addMobileMoveButtons(actionRow, actionIndex);

			if (isSeparator) {
				actionRow.infoEl.empty();
				actionRow.infoEl.createDiv("local-gpt-action-separator-line");
				actionRow.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip(I18n.t("settings.remove"))
						.onClick(async () => {
							if (!button.buttonEl.hasClass("mod-warning")) {
								button.setClass("mod-warning");
								return;
							}

							this.plugin.settings.actions =
								this.plugin.settings.actions.filter(
									(innerAction) => innerAction !== action,
								);
							await this.plugin.saveSettings();
							this.display();
						}),
				);
				return;
			}

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

			actionRow
				.addButton((button) =>
					button.setIcon("copy").onClick(async () => {
						navigator.clipboard.writeText(sharingString);
						new Notice(I18n.t("notices.copied"));
					}),
				)
				.addButton((button) =>
					button.setButtonText("Edit").onClick(async () => {
						this.editEnabled = true;
						this.editExistingAction = action;
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
		});

		if (this.plugin.settings.actions.length > 1) {
			// Manual edge auto-scroll helpers
			const getScrollableParent = (el: HTMLElement): HTMLElement => {
				let node: HTMLElement | null = el.parentElement;
				while (node) {
					const style = getComputedStyle(node);
					const overflowY = style.overflowY;
					if (
						node.scrollHeight > node.clientHeight &&
						(overflowY === "auto" || overflowY === "scroll")
					) {
						return node;
					}
					node = node.parentElement;
				}
				return (document.scrollingElement ||
					document.documentElement) as HTMLElement;
			};

			let autoScrollFrame: number | null = null;
			let autoScrollDelta = 0;
			let scrollEl: HTMLElement | null = null;

			const stepScroll = () => {
				if (!scrollEl) return;
				if (autoScrollDelta !== 0) {
					scrollEl.scrollTop += autoScrollDelta;
					autoScrollFrame = requestAnimationFrame(stepScroll);
				} else {
					autoScrollFrame = null;
				}
			};

			const handleEdgeScroll = (evt: any) => {
				if (!scrollEl) return;
				const clientY = evt?.clientY ?? evt?.touches?.[0]?.clientY ?? 0;
				const rect = scrollEl.getBoundingClientRect();
				const threshold = 48; // px from top/bottom edge
				const maxStep = 18; // px per frame

				if (clientY < rect.top + threshold) {
					const dist = rect.top + threshold - clientY;
					autoScrollDelta = -Math.min(maxStep, Math.ceil(dist / 4));
				} else if (clientY > rect.bottom - threshold) {
					const dist = clientY - (rect.bottom - threshold);
					autoScrollDelta = Math.min(maxStep, Math.ceil(dist / 4));
				} else {
					autoScrollDelta = 0;
				}

				if (autoScrollDelta !== 0 && autoScrollFrame === null) {
					autoScrollFrame = requestAnimationFrame(stepScroll);
				}
			};

			const addEdgeScrollListeners = () => {
				if (!scrollEl) return;
				scrollEl.addEventListener("dragover", handleEdgeScroll);
				scrollEl.addEventListener("pointermove", handleEdgeScroll, {
					passive: true,
				});
				scrollEl.addEventListener("touchmove", handleEdgeScroll, {
					passive: true,
				});
			};

			const removeEdgeScrollListeners = () => {
				if (!scrollEl) return;
				scrollEl.removeEventListener("dragover", handleEdgeScroll);
				scrollEl.removeEventListener(
					"pointermove",
					handleEdgeScroll as any,
				);
				scrollEl.removeEventListener(
					"touchmove",
					handleEdgeScroll as any,
				);
			};

			Sortable.create(actionsContainer, {
				animation: 150,
				// Allow dragging by the handle only
				draggable: ".setting-item",
				handle: ".local-gpt-drag-handle",
				// We provide manual edge autoscroll for reliability in Obsidian's settings modal
				ghostClass: "local-gpt-sortable-ghost",
				chosenClass: "local-gpt-sortable-chosen",
				dragClass: "local-gpt-sortable-drag",
				onStart: (evt: any) => {
					// Prepare autoscroll on drag start
					scrollEl = getScrollableParent(actionsContainer);
					addEdgeScrollListeners();
				},
				onEnd: async (evt: any) => {
					// Cleanup autoscroll
					removeEdgeScrollListeners();
					if (autoScrollFrame !== null) {
						cancelAnimationFrame(autoScrollFrame);
						autoScrollFrame = null;
					}
					autoScrollDelta = 0;
					scrollEl = null;
					// Add a transient class to play a drop animation
					const droppedEl: HTMLElement | undefined = evt?.item;
					if (droppedEl) {
						droppedEl.classList.add("local-gpt-drop-animate");
						droppedEl.addEventListener(
							"animationend",
							() =>
								droppedEl.classList.remove(
									"local-gpt-drop-animate",
								),
							{ once: true },
						);

						// Nudge immediate siblings without affecting layout
						const prevEl =
							droppedEl.previousElementSibling as HTMLElement | null;
						const nextEl =
							droppedEl.nextElementSibling as HTMLElement | null;
						if (
							prevEl &&
							prevEl.classList.contains("setting-item")
						) {
							prevEl.classList.add(
								"local-gpt-drop-neighbor-prev",
							);
							prevEl.addEventListener(
								"animationend",
								() =>
									prevEl.classList.remove(
										"local-gpt-drop-neighbor-prev",
									),
								{ once: true },
							);
						}
						if (
							nextEl &&
							nextEl.classList.contains("setting-item")
						) {
							nextEl.classList.add(
								"local-gpt-drop-neighbor-next",
							);
							nextEl.addEventListener(
								"animationend",
								() =>
									nextEl.classList.remove(
										"local-gpt-drop-neighbor-next",
									),
								{ once: true },
							);
						}
					}
					if (
						evt.oldIndex !== undefined &&
						evt.newIndex !== undefined &&
						evt.oldIndex !== evt.newIndex
					) {
						await updateOrder(evt.oldIndex, evt.newIndex);
					}
				},
			});
		}

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
				.setClass("ai-providers-select")
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
							this.plugin.settings.actions =
								DEFAULT_SETTINGS.actions;
							await this.plugin.saveSettings();
							this.isConfirmingReset = false;
							this.display();
						}),
				);
		}
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

	async addSeparator() {
		const separatorAction: LocalGPTAction = {
			name: "separator",
			prompt: "",
			separator: true,
		};
		this.plugin.settings.actions = [
			separatorAction,
			...this.plugin.settings.actions,
		];
		await this.plugin.saveSettings();
	}
}
