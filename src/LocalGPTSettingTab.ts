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
	private pendingScroll?: {
		action: LocalGPTAction;
		align: "start" | "center";
		target: "form" | "row";
	};
	private pendingScrollRestore?: {
		top: number;
		height: number;
	};
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

		const isEditingExisting = Boolean(this.editExistingAction);
		const isEditingNew = this.editEnabled && !isEditingExisting;

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

		const renderActionEditor = (
			container: HTMLElement,
			actionToEdit: LocalGPTAction,
			isExistingAction: boolean,
		) => {
			new Setting(container)
				.setName(I18n.t("settings.actionName"))
				.addText((text) => {
					text.inputEl.classList.add("local-gpt-action-input");
					actionToEdit?.name && text.setValue(actionToEdit.name);
					text.setPlaceholder(
						I18n.t("settings.actionNamePlaceholder"),
					);
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
					text.setPlaceholder(
						I18n.t("settings.systemPromptPlaceholder"),
					);
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
					actionToEdit?.replace &&
						component.setValue(actionToEdit.replace);
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

							this.plugin.settings.actions =
								this.plugin.settings.actions.filter(
									(innerAction) =>
										innerAction !== actionToEdit,
								);
							await this.plugin.saveSettings();
							closeActionEditor();
						});
				});
			}

			actionButtonsRow
				.addButton((button) => {
					button
						.setButtonText(I18n.t("settings.close"))
						.onClick(async () => {
							closeActionEditor(
								isExistingAction ? actionToEdit : undefined,
							);
						});
				})
				.addButton((button) =>
					button
						.setCta()
						.setButtonText(I18n.t("settings.save"))
						.onClick(async () => {
							if (!actionToEdit.name) {
								new Notice(
									I18n.t("notices.actionNameRequired"),
								);
								return;
							}

							if (!isExistingAction) {
								if (
									this.plugin.settings.actions.find(
										(action) =>
											action.name === actionToEdit.name,
									)
								) {
									new Notice(
										I18n.t("notices.actionNameExists", {
											name: actionToEdit.name,
										}),
									);
									return;
								}

								await this.addNewAction(actionToEdit);
							} else {
								if (
									this.plugin.settings.actions.filter(
										(action) =>
											action.name === actionToEdit.name,
									).length > 1
								) {
									new Notice(
										I18n.t("notices.actionNameExists", {
											name: actionToEdit.name,
										}),
									);
									return;
								}

								const index =
									this.plugin.settings.actions.findIndex(
										(innerAction) =>
											innerAction === actionToEdit,
									);

								if (index >= 0) {
									this.plugin.settings.actions[index] =
										actionToEdit;
								}
							}

							await this.plugin.saveSettings();
							closeActionEditor(actionToEdit);
						}),
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
							captureScrollPosition(containerEl);
							await this.addSeparator();
							this.display();
						}),
				);
		} else {
			renderActionEditor(containerEl, editingAction, false);
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

		const editFormScrollOffset = 30;

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

		const captureScrollPosition = (anchor: HTMLElement) => {
			const scrollEl = getScrollableParent(anchor);
			this.pendingScrollRestore = {
				top: scrollEl.scrollTop,
				height: scrollEl.scrollHeight,
			};
		};

		const restoreScrollPosition = (anchor: HTMLElement) => {
			const pendingRestore = this.pendingScrollRestore;
			if (!pendingRestore) return;
			const scrollEl = getScrollableParent(anchor);
			const heightDelta = scrollEl.scrollHeight - pendingRestore.height;
			let desiredTop = pendingRestore.top;
			if (pendingRestore.top > 0) {
				desiredTop += heightDelta;
			}
			const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
			scrollEl.scrollTop = Math.min(
				Math.max(desiredTop, 0),
				Math.max(0, maxScroll),
			);
			this.pendingScrollRestore = undefined;
		};

		const smoothScrollToTarget = (
			target: HTMLElement,
			align: "start" | "center",
			offset = 0,
			onComplete?: () => void,
		) => {
			const scrollEl = getScrollableParent(target);
			const parentRect = scrollEl.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			const currentTop = scrollEl.scrollTop;
			const targetTop = targetRect.top - parentRect.top + currentTop;
			let desiredTop = targetTop;

			if (align === "start") {
				desiredTop = targetTop - offset;
			} else {
				const available = parentRect.height - targetRect.height;
				desiredTop = targetTop - Math.max(0, available / 2);
			}

			const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
			const clampedTop = Math.min(
				Math.max(desiredTop, 0),
				Math.max(0, maxScroll),
			);

			const prefersReducedMotion = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;
			const distance = clampedTop - currentTop;
			const minDistance = 1;

			if (prefersReducedMotion || Math.abs(distance) < minDistance) {
				scrollEl.scrollTop = clampedTop;
				onComplete?.();
				return;
			}

			const duration = Math.min(
				600,
				Math.max(240, Math.abs(distance) * 0.5),
			);
			const startTime = performance.now();
			const easeInOut = (t: number) =>
				t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

			const step = (now: number) => {
				const progress = Math.min((now - startTime) / duration, 1);
				const eased = easeInOut(progress);
				scrollEl.scrollTop = currentTop + distance * eased;
				if (progress < 1) {
					requestAnimationFrame(step);
					return;
				}
				onComplete?.();
			};

			requestAnimationFrame(step);
		};

		const triggerHighlight = (element: HTMLElement) => {
			element.classList.remove("local-gpt-action-highlight");
			// Force reflow so the highlight animation restarts on repeat triggers.
			void element.offsetWidth;
			element.classList.add("local-gpt-action-highlight");
			element.addEventListener(
				"animationend",
				() => element.classList.remove("local-gpt-action-highlight"),
				{ once: true },
			);
		};

		const applyPendingScroll = (
			action: LocalGPTAction,
			target: HTMLElement,
			targetType: "form" | "row",
			offset = 0,
			highlightTarget?: HTMLElement,
		) => {
			const pendingScroll = this.pendingScroll;
			if (
				!pendingScroll ||
				pendingScroll.action !== action ||
				pendingScroll.target !== targetType
			) {
				return;
			}

			const scrollOffset = pendingScroll.align === "start" ? offset : 0;
			requestAnimationFrame(() => {
				smoothScrollToTarget(
					target,
					pendingScroll.align,
					scrollOffset,
					() => triggerHighlight(highlightTarget ?? target),
				);
			});
			this.pendingScroll = undefined;
		};

		const buildSharingString = (action: LocalGPTAction) =>
			[
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

		const buildActionDescription = (action: LocalGPTAction) => {
			const systemTitle = escapeTitle(action.system);
			const promptTitle = escapeTitle(action.prompt);

			return [
				action.system
					? `<div title="${systemTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingActionsMapping.system}</b>${action.system}</div>`
					: "",
				action.prompt
					? `<div title="${promptTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingActionsMapping.prompt}</b>${action.prompt}
					</div>`
					: "",
			]
				.filter(Boolean)
				.join("<br/>\n");
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

		const renderSeparatorActionRow = (
			action: LocalGPTAction,
			actionIndex: number,
		) => {
			const actionRow = new Setting(actionsContainer)
				.setName("")
				.setDesc("");

			actionRow.settingEl.addClass("local-gpt-action-row");
			actionRow.settingEl.addClass("local-gpt-action-separator");
			actionRow.settingEl.setAttribute(
				"aria-label",
				I18n.t("settings.separator"),
			);

			const handle = actionRow.settingEl.createDiv(
				"local-gpt-drag-handle",
			);
			setIcon(handle, "grip-vertical");
			actionRow.settingEl.prepend(handle);

			addMobileMoveButtons(actionRow, actionIndex);

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
		};

		const renderActionRow = (
			action: LocalGPTAction,
			actionIndex: number,
		) => {
			const isEditingRow = this.editExistingAction === action;
			const actionRow = new Setting(actionsContainer);

			actionRow.settingEl.addClass("local-gpt-action-row");

			if (isEditingRow) {
				actionRow.controlEl.remove();
				actionRow.infoEl.empty();
				renderActionEditor(actionRow.infoEl, action, true);
				const target =
					actionRow.infoEl.querySelector(".setting-item") ??
					actionRow.infoEl;
				applyPendingScroll(
					action,
					target as HTMLElement,
					"form",
					editFormScrollOffset,
					actionRow.settingEl,
				);
				return;
			}

			actionRow.setName(action.name).setDesc("");

			const handle = actionRow.settingEl.createDiv(
				"local-gpt-drag-handle",
			);
			setIcon(handle, "grip-vertical");
			actionRow.settingEl.prepend(handle);

			addMobileMoveButtons(actionRow, actionIndex);

			const sharingString = buildSharingString(action);

			actionRow
				.addButton((button) =>
					button.setIcon("copy").onClick(async () => {
						navigator.clipboard.writeText(sharingString);
						new Notice(I18n.t("notices.copied"));
					}),
				)
				.addButton((button) =>
					button.setButtonText("Edit").onClick(async () => {
						this.editEnabled = false;
						this.pendingScroll = {
							action,
							align: "start",
							target: "form",
						};
						this.editExistingAction = action;
						this.display();
					}),
				);

			actionRow.descEl.innerHTML = buildActionDescription(action);

			applyPendingScroll(action, actionRow.settingEl, "row");
		};

		this.plugin.settings.actions.forEach((action, actionIndex) => {
			if (isSeparatorAction(action)) {
				renderSeparatorActionRow(action, actionIndex);
				return;
			}

			renderActionRow(action, actionIndex);
		});

		restoreScrollPosition(actionsContainer);

		this.pendingScroll = undefined;

		if (this.plugin.settings.actions.length > 1) {
			// Manual edge auto-scroll helpers
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
