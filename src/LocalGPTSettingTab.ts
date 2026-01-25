import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Platform,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import { DEFAULT_SETTINGS } from "defaultSettings";
import LocalGPT from "./main";
import { CommunityActionRef, LocalGPTAction } from "./interfaces";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import { I18n } from "./i18n";
import Sortable from "sortablejs";
import { isSeparatorAction, moveAction } from "./actionUtils";
import { detectDominantLanguage } from "./languageDetection";
import {
	CommunityAction,
	CommunityActionsService,
	buildCommunityActionKey,
	buildCommunityActionSignature,
} from "./CommunityActionsService";

const SEPARATOR = "✂️";

const normalizeLanguageCode = (value?: string | null): string => {
	if (!value) {
		return "en";
	}
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return "en";
	}
	return trimmed.split(/[-_]/)[0] || "en";
};

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

		const sharingFieldLabels = {
			name: "Name: ",
			system: "System: ",
			prompt: "Prompt: ",
			replace: "Replace: ",
			language: "Language: ",
		} as const;
		const sharingFieldOrder: Array<keyof typeof sharingFieldLabels> = [
			"name",
			"system",
			"prompt",
			"replace",
			"language",
		];
		const sharingEntries = sharingFieldOrder.map(
			(key) => [key, sharingFieldLabels[key]] as const,
		);
		const quickAddHandlers: Partial<
			Record<
				keyof typeof sharingFieldLabels,
				(value: string, action: LocalGPTAction) => void
			>
		> = {
			name: (value, action) => {
				action.name = value;
			},
			system: (value, action) => {
				action.system = value;
			},
			prompt: (value, action) => {
				action.prompt = value;
			},
			replace: (value, action) => {
				action.replace = value.trim().toLowerCase() === "true";
			},
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

								dropCommunityLinkIfModified(actionToEdit);

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
						.onClick(() => openCommunityActionsModal());
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

		const buildSharingString = (action: LocalGPTAction) => {
			const detectedLanguage = detectDominantLanguage(
				[action.name, action.system, action.prompt]
					.filter((value): value is string => Boolean(value))
					.join("\n"),
			);
			const resolvedLanguage = normalizeLanguageCode(
				detectedLanguage === "unknown"
					? defaultCommunityActionsLanguage
					: detectedLanguage,
			);
			const replaceValue = action.replace
				? `${sharingFieldLabels.replace}${action.replace}`
				: "";

			return [
				action.name && `${sharingFieldLabels.name}${action.name}`,
				action.system && `${sharingFieldLabels.system}${action.system}`,
				action.prompt && `${sharingFieldLabels.prompt}${action.prompt}`,
				replaceValue,
				`${sharingFieldLabels.language}${resolvedLanguage}`,
			]
				.filter(Boolean)
				.join(` ${SEPARATOR}\n`);
		};

		const buildActionDescription = (action: LocalGPTAction) => {
			const systemTitle = escapeTitle(action.system);
			const promptTitle = escapeTitle(action.prompt);
			const communityDescription = action.community?.description?.trim();
			if (communityDescription) {
				const escaped = escapeTitle(communityDescription);
				return `<div class="local-gpt-action-community-description" title="${escaped}">${escaped}</div>`;
			}

			return [
				action.system
					? `<div title="${systemTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingFieldLabels.system}</b>${action.system}</div>`
					: "",
				action.prompt
					? `<div title="${promptTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingFieldLabels.prompt}</b>${action.prompt}
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
			if (action.community && actionRow.nameEl) {
				const nameEl = actionRow.nameEl;
				const nameText = nameEl.textContent ?? "";
				nameEl.empty();
				nameEl.createSpan({
					cls: "local-gpt-action-name-label",
					text: nameText,
				});
				nameEl.createSpan({
					cls: "local-gpt-community-actions-status local-gpt-action-community-status local-gpt-is-installed",
					text: I18n.t("settings.communityActionsBadge"),
				});
			}

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

		const setupActionsSortable = () => {
			if (this.plugin.settings.actions.length <= 1) {
				return;
			}
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
		};

		setupActionsSortable();

		const openCommunityActionsModal = () => {
			const modal = new Modal(this.app);
			modal.modalEl.addClass("local-gpt-community-actions-modal");
			modal.titleEl.setText(I18n.t("settings.communityActions"));
			const modalContent = modal.contentEl;

			const communityActionsRenderId = Date.now();
			this.communityActionsRenderId = communityActionsRenderId;

			const communityActionsSection = modalContent.createDiv(
				"local-gpt-community-actions",
			);
			const communityActionsDescription =
				communityActionsSection.createDiv("setting-item-description");
			communityActionsDescription.innerHTML = I18n.t(
				"settings.communityActionsDesc",
			);

			const communityActionsHint = communityActionsSection.createDiv(
				"local-gpt-community-actions-hint",
			);
			communityActionsHint.setText(
				I18n.t("settings.communityActionsAutoUpdate"),
			);

			const communityActionsStatus = communityActionsSection.createDiv(
				"local-gpt-community-actions-status-line",
			);
			communityActionsStatus.setText(
				this.communityActionsStatusMessage || "",
			);
			communityActionsStatus.toggleClass(
				"local-gpt-is-hidden",
				!this.communityActionsStatusMessage,
			);

			this.communityActionsLanguage = normalizeLanguageCode(
				this.communityActionsLanguage ||
					defaultCommunityActionsLanguage,
			);

			let communityActions: CommunityAction[] = [];
			let communityActionsLoaded = false;
			let languageDropdown: DropdownComponent | null = null;
			let refreshButton: ButtonComponent | null = null;
			let communityActionsSearchQuery = "";

			const communityActionsList = communityActionsSection.createDiv(
				"local-gpt-community-actions-list",
			);

			const renderCommunityActionsMessage = (
				message: string,
				className: string,
			) => {
				communityActionsList.empty();
				const messageEl = communityActionsList.createDiv(className);
				messageEl.setText(message);
			};

			const normalizeActionName = (name: string) =>
				name.trim().toLowerCase();

			const normalizeSearchValue = (value: string) =>
				value.toLowerCase().replace(/\s+/g, " ").trim();

			const fuzzyMatch = (target: string, query: string): boolean => {
				if (!query) {
					return true;
				}
				let ti = 0;
				for (const qc of query) {
					ti = target.indexOf(qc, ti);
					if (ti === -1) {
						return false;
					}
					ti++;
				}
				return true;
			};

			type CommunityActionsLookup = {
				byId: Map<string, LocalGPTAction>;
				byKey: Map<string, LocalGPTAction>;
				byName: Map<string, LocalGPTAction>;
			};

			const buildCommunityActionsLookup = (
				actions: LocalGPTAction[],
			): CommunityActionsLookup => {
				const byId = new Map<string, LocalGPTAction>();
				const byKey = new Map<string, LocalGPTAction>();
				const byName = new Map<string, LocalGPTAction>();

				actions.forEach((action) => {
					byName.set(normalizeActionName(action.name), action);
					if (action.community?.id) {
						byId.set(action.community.id, action);
					}
					if (action.community?.language && action.community?.name) {
						byKey.set(
							buildCommunityActionKey(
								action.community.language,
								action.community.name,
							),
							action,
						);
					}
				});

				return { byId, byKey, byName };
			};

			const findCommunityActionLink = (
				action: CommunityAction,
				lookup: CommunityActionsLookup,
			) =>
				lookup.byId.get(action.id) ||
				lookup.byKey.get(
					buildCommunityActionKey(action.language, action.name),
				);

			type CommunityActionState =
				| { type: "available" }
				| { type: "installed"; localAction: LocalGPTAction }
				| { type: "modified"; localAction: LocalGPTAction }
				| { type: "conflict"; localAction: LocalGPTAction };

			type CommunityActionMatch = {
				action: CommunityAction;
				rank: number;
				index: number;
			};

			const getCommunityActionSearchRank = (
				action: CommunityAction,
				query: string,
			): number | null => {
				const fields = [
					action.name,
					action.description,
					action.prompt,
					action.system,
				];
				for (let i = 0; i < fields.length; i++) {
					const value = fields[i];
					if (!value) {
						continue;
					}
					const normalized = normalizeSearchValue(value);
					if (normalized && fuzzyMatch(normalized, query)) {
						return i;
					}
				}
				return null;
			};

			const resolveCommunityActionState = (
				action: CommunityAction,
				lookup: CommunityActionsLookup,
			): CommunityActionState => {
				const linkedAction = findCommunityActionLink(action, lookup);
				if (linkedAction) {
					const localSignature =
						buildCommunityActionSignature(linkedAction);
					const storedHash = linkedAction.community?.hash;
					if (storedHash && localSignature !== storedHash) {
						return { type: "modified", localAction: linkedAction };
					}
					return { type: "installed", localAction: linkedAction };
				}

				const nameMatch = lookup.byName.get(
					normalizeActionName(action.name),
				);
				if (nameMatch) {
					return { type: "conflict", localAction: nameMatch };
				}

				return { type: "available" };
			};

			const buildCommunityActionRef = (
				action: CommunityAction,
			): CommunityActionRef => ({
				id: action.id,
				language: action.language,
				name: action.name,
				hash: buildCommunityActionSignature(action),
				updatedAt: action.updatedAt ?? action.createdAt,
				description: action.description?.trim() || undefined,
			});

			const setCommunityActionsStatusMessage = (message: string) => {
				this.communityActionsStatusMessage = message;
				if (!message) {
					communityActionsStatus.setText("");
					communityActionsStatus.addClass("local-gpt-is-hidden");
					return;
				}
				communityActionsStatus.setText(message);
				communityActionsStatus.removeClass("local-gpt-is-hidden");
			};

			const addPreviewLine = (
				preview: HTMLElement,
				label: string,
				value?: string,
			) => {
				if (!value) {
					return;
				}
				const line = preview.createDiv(
					"local-gpt-community-actions-preview-line",
				);
				line.createSpan({
					text: `${label}: `,
					cls: "local-gpt-community-actions-preview-label",
				});
				line.createSpan({ text: value });
			};

			let refreshCommunityActionsList = () => {
				renderCommunityActionsMessage(
					I18n.t("settings.communityActionsLoading"),
					"local-gpt-community-actions-loading",
				);
			};

			const installCommunityAction = async (
				action: CommunityAction,
				existingAction?: LocalGPTAction,
			) => {
				const localAction: LocalGPTAction = existingAction
					? { ...existingAction }
					: {
							name: action.name,
							prompt: "",
						};

				localAction.name = action.name;
				localAction.prompt = action.prompt ?? "";
				localAction.replace = action.replace ?? false;
				if (action.system) {
					localAction.system = action.system;
				} else {
					delete localAction.system;
				}
				localAction.community = buildCommunityActionRef(action);
				captureScrollPosition(containerEl);
				await this.addNewAction(localAction);
				refreshCommunityActionsList();
				this.pendingScroll = {
					action: localAction,
					align: "center",
					target: "row",
				};
				this.display();
			};

			const getCommunityActionStatusPill = (
				state: CommunityActionState,
			): {
				label: string;
				variant: "installed" | "modified" | "conflict";
			} | null => {
				if (state.type === "installed") {
					return {
						label: I18n.t("settings.communityActionsInstalled"),
						variant: "installed",
					};
				}
				if (state.type === "modified") {
					return {
						label: I18n.t("settings.communityActionsModified"),
						variant: "modified",
					};
				}
				if (state.type === "conflict") {
					return {
						label: I18n.t("settings.communityActionsInList"),
						variant: "conflict",
					};
				}
				return null;
			};

			const getCommunityActionNote = (state: CommunityActionState) => {
				if (state.type === "modified") {
					return I18n.t("settings.communityActionsModifiedNote");
				}
				if (state.type === "conflict") {
					return I18n.t("settings.communityActionsConflictNote");
				}
				return null;
			};

			const configureCommunityActionButton = (
				button: ButtonComponent,
				action: CommunityAction,
				state: CommunityActionState,
			) => {
				if (state.type === "installed") {
					button
						.setButtonText(
							I18n.t("settings.communityActionsInstalled"),
						)
						.setDisabled(true);
					button.buttonEl.addClass(
						"local-gpt-community-actions-installed-button",
					);
					return;
				}

				if (state.type === "modified") {
					button
						.setButtonText(
							I18n.t("settings.communityActionsUpdate"),
						)
						.setClass("mod-warning")
						.onClick(async () =>
							installCommunityAction(action, state.localAction),
						);
					return;
				}

				if (state.type === "conflict") {
					button
						.setButtonText(
							I18n.t("settings.communityActionsReplace"),
						)
						.setClass("mod-warning")
						.onClick(async () =>
							installCommunityAction(action, state.localAction),
						);
					return;
				}

				button
					.setCta()
					.setButtonText(I18n.t("settings.communityActionsInstall"))
					.onClick(async () => installCommunityAction(action));
				button.buttonEl.addClass(
					"local-gpt-community-actions-install-button",
				);
				const icon = button.buttonEl.createSpan(
					"local-gpt-community-actions-install-icon",
				);
				setIcon(icon, "plus");
				button.buttonEl.prepend(icon);
			};

			const renderCommunityActionRow = (
				action: CommunityAction,
				state: CommunityActionState,
			) => {
				const actionRow = communityActionsList.createDiv(
					"local-gpt-community-actions-row",
				);
				if (state.type === "installed") {
					actionRow.addClass("local-gpt-is-installed");
				}
				const infoEl = actionRow.createDiv(
					"local-gpt-community-actions-info",
				);

				const content = infoEl.createDiv(
					"local-gpt-community-actions-content",
				);
				const header = content.createDiv(
					"local-gpt-community-actions-header",
				);
				header.createSpan({
					text: action.name,
					cls: "local-gpt-community-actions-title",
				});

				const statusPill = getCommunityActionStatusPill(state);
				if (statusPill) {
					const pill = header.createSpan(
						"local-gpt-community-actions-status",
					);
					pill.setText(statusPill.label);
					pill.addClass(`local-gpt-is-${statusPill.variant}`);
				}

				const score = header.createSpan(
					"local-gpt-community-actions-score",
				);
				score.setText(String(action.score));
				score.setAttr(
					"aria-label",
					`${I18n.t("settings.communityActionsScoreLabel")} ${action.score}`,
				);

				const metaRow = content.createDiv(
					"local-gpt-community-actions-meta",
				);
				if (action.author) {
					const author = metaRow.createSpan(
						"local-gpt-community-actions-meta-item",
					);
					author.setText(
						I18n.t("settings.communityActionsByAuthor", {
							author: `@${action.author}`,
						}),
					);
					author.addClass("local-gpt-community-actions-author");
				}
				if (action.replace) {
					const replaceTag = metaRow.createSpan(
						"local-gpt-community-actions-meta-pill",
					);
					replaceTag.setText(
						I18n.t("settings.communityActionsReplaceTag"),
					);
				}

				const footer = content.createDiv(
					"local-gpt-community-actions-footer",
				);
				const preview = footer.createDiv(
					"local-gpt-community-actions-preview",
				);
				const description = action.description?.trim();
				if (description) {
					const descriptionLine = preview.createDiv(
						"local-gpt-community-actions-description",
					);
					descriptionLine.setText(description);
					descriptionLine.setAttr("title", description);
				} else {
					addPreviewLine(
						preview,
						I18n.t("settings.systemPrompt"),
						action.system,
					);
					addPreviewLine(
						preview,
						I18n.t("settings.prompt"),
						action.prompt,
					);
				}

				const noteText = getCommunityActionNote(state);
				if (noteText) {
					const note = content.createDiv(
						"local-gpt-community-actions-note",
					);
					note.setText(noteText);
				}

				const actions = footer.createDiv(
					"local-gpt-community-actions-actions",
				);
				const controlEl = actions.createDiv(
					"local-gpt-community-actions-control",
				);
				const button = new ButtonComponent(controlEl);
				configureCommunityActionButton(button, action, state);
			};

			const renderCommunityActionsList = (actions: CommunityAction[]) => {
				if (!communityActionsLoaded) {
					renderCommunityActionsMessage(
						I18n.t("settings.communityActionsLoading"),
						"local-gpt-community-actions-loading",
					);
					return;
				}

				const selectedLanguage = normalizeLanguageCode(
					this.communityActionsLanguage ||
						defaultCommunityActionsLanguage,
				);
				const languageFiltered = actions.filter(
					(action) =>
						normalizeLanguageCode(action.language) ===
						selectedLanguage,
				);
				if (!languageFiltered.length) {
					renderCommunityActionsMessage(
						I18n.t("settings.communityActionsEmpty"),
						"local-gpt-community-actions-empty",
					);
					return;
				}

				const query = normalizeSearchValue(communityActionsSearchQuery);
				let filtered = languageFiltered;
				if (query) {
					const matches = languageFiltered
						.map((action, index) => {
							const rank = getCommunityActionSearchRank(
								action,
								query,
							);
							if (rank === null) {
								return null;
							}
							return { action, rank, index };
						})
						.filter((match): match is CommunityActionMatch =>
							Boolean(match),
						)
						.sort((a, b) => {
							if (a.rank !== b.rank) {
								return a.rank - b.rank;
							}
							return a.index - b.index;
						});
					if (!matches.length) {
						renderCommunityActionsMessage(
							I18n.t("settings.communityActionsSearchEmpty"),
							"local-gpt-community-actions-empty",
						);
						return;
					}
					filtered = matches.map((match) => match.action);
				}

				communityActionsList.empty();
				const lookup = buildCommunityActionsLookup(
					this.plugin.settings.actions,
				);
				filtered.forEach((action) =>
					renderCommunityActionRow(
						action,
						resolveCommunityActionState(action, lookup),
					),
				);
			};

			refreshCommunityActionsList = () =>
				renderCommunityActionsList(communityActions);

			const updateCommunityActionsLanguageOptions = (
				actions: CommunityAction[],
			) => {
				if (!languageDropdown) {
					return;
				}

				const languages = new Set<string>(
					actions.map((action) =>
						normalizeLanguageCode(action.language),
					),
				);
				if (this.communityActionsLanguage) {
					languages.add(
						normalizeLanguageCode(this.communityActionsLanguage),
					);
				}
				languages.add(defaultCommunityActionsLanguage);

				const options = Array.from(languages).sort((a, b) =>
					a.localeCompare(b),
				);
				languageDropdown.selectEl.options.length = 0;
				options.forEach((language) => {
					languageDropdown?.addOption(language, language);
				});
				languageDropdown.setValue(
					normalizeLanguageCode(
						this.communityActionsLanguage ||
							defaultCommunityActionsLanguage,
					),
				);
			};

			const syncCommunityActions = async (
				actions: CommunityAction[],
			): Promise<{ updated: number; skipped: number }> => {
				const lookup = buildCommunityActionsLookup(
					this.plugin.settings.actions,
				);
				let updated = 0;
				let skipped = 0;

				const applyCommunityActionUpdate = (
					localAction: LocalGPTAction,
					action: CommunityAction,
				) => {
					localAction.prompt = action.prompt ?? "";
					localAction.replace = action.replace ?? false;
					if (action.system) {
						localAction.system = action.system;
					} else {
						delete localAction.system;
					}
					localAction.community = buildCommunityActionRef(action);
				};

				const isCommunityActionModified = (
					localAction: LocalGPTAction,
					localSignature: string,
				) => {
					const storedHash = localAction.community?.hash;
					return Boolean(storedHash && localSignature !== storedHash);
				};

				const shouldUpdateCommunityAction = (
					localAction: LocalGPTAction,
					localSignature: string,
					remoteSignature: string,
					action: CommunityAction,
				) =>
					localSignature !== remoteSignature ||
					localAction.community?.hash !== remoteSignature ||
					localAction.community?.id !== action.id ||
					localAction.community?.description?.trim() !==
						(action.description?.trim() || undefined);

				const tryAdoptCommunityAction = (
					action: CommunityAction,
					lookup: CommunityActionsLookup,
				) => {
					const nameMatch = lookup.byName.get(
						normalizeActionName(action.name),
					);
					if (!nameMatch) {
						return { updated: 0, skipped: 0 };
					}
					const localSignature =
						buildCommunityActionSignature(nameMatch);
					const remoteSignature =
						buildCommunityActionSignature(action);
					if (localSignature !== remoteSignature) {
						return { updated: 0, skipped: 0 };
					}
					nameMatch.community = buildCommunityActionRef(action);
					return { updated: 1, skipped: 0 };
				};

				const syncCommunityAction = (
					action: CommunityAction,
					lookup: CommunityActionsLookup,
				) => {
					const localAction = findCommunityActionLink(action, lookup);
					if (!localAction) {
						return tryAdoptCommunityAction(action, lookup);
					}

					const localSignature =
						buildCommunityActionSignature(localAction);
					const remoteSignature =
						buildCommunityActionSignature(action);
					if (
						isCommunityActionModified(localAction, localSignature)
					) {
						return { updated: 0, skipped: 1 };
					}
					if (
						!shouldUpdateCommunityAction(
							localAction,
							localSignature,
							remoteSignature,
							action,
						)
					) {
						return { updated: 0, skipped: 0 };
					}
					applyCommunityActionUpdate(localAction, action);
					return { updated: 1, skipped: 0 };
				};

				actions.forEach((action) => {
					const result = syncCommunityAction(action, lookup);
					updated += result.updated;
					skipped += result.skipped;
				});

				if (updated > 0) {
					await this.plugin.saveSettings();
				}

				return { updated, skipped };
			};

			const buildCommunityActionsSyncMessage = (result: {
				updated: number;
				skipped: number;
			}) => {
				if (result.updated > 0 && result.skipped > 0) {
					return I18n.t("settings.communityActionsSyncSummary", {
						updated: String(result.updated),
						skipped: String(result.skipped),
					});
				}
				if (result.updated > 0) {
					return I18n.t("settings.communityActionsUpdated", {
						count: String(result.updated),
					});
				}
				if (result.skipped > 0) {
					return I18n.t("settings.communityActionsSkipped", {
						count: String(result.skipped),
					});
				}
				return "";
			};

			const finishCommunityActionsLoad = (actions: CommunityAction[]) => {
				communityActionsLoaded = true;
				updateCommunityActionsLanguageOptions(actions);
				renderCommunityActionsList(actions);
			};

			const handleCommunityActions = async (
				actions: CommunityAction[],
			): Promise<boolean> => {
				if (
					this.communityActionsRenderId !== communityActionsRenderId
				) {
					return true;
				}
				communityActions = actions;
				const syncResult = await syncCommunityActions(actions);
				const syncMessage =
					buildCommunityActionsSyncMessage(syncResult);
				setCommunityActionsStatusMessage(syncMessage);
				if (syncResult.updated > 0) {
					this.display();
					return true;
				}
				finishCommunityActionsLoad(actions);
				return false;
			};

			const handleCommunityActionsError = (error: unknown) => {
				if (
					this.communityActionsRenderId !== communityActionsRenderId
				) {
					return;
				}
				console.error("Failed to load community actions", error);
				communityActionsLoaded = true;
				setCommunityActionsStatusMessage("");
				renderCommunityActionsMessage(
					I18n.t("settings.communityActionsError"),
					"local-gpt-community-actions-error",
				);
			};

			const loadCommunityActions = async (forceRefresh = false) => {
				communityActionsLoaded = false;
				renderCommunityActionsMessage(
					I18n.t("settings.communityActionsLoading"),
					"local-gpt-community-actions-loading",
				);
				refreshButton?.setDisabled(true);

				try {
					const actions =
						await CommunityActionsService.getCommunityActions({
							forceRefresh,
						});
					await handleCommunityActions(actions);
				} catch (error) {
					handleCommunityActionsError(error);
				} finally {
					refreshButton?.setDisabled(false);
				}
			};

			const languageSetting = new Setting(communityActionsSection)
				.setName(I18n.t("settings.communityActionsLanguage"))
				.setDesc(I18n.t("settings.communityActionsLanguageDesc"))
				.addDropdown((dropdown) => {
					languageDropdown = dropdown;
					const initialLanguage = normalizeLanguageCode(
						this.communityActionsLanguage ||
							defaultCommunityActionsLanguage,
					);
					dropdown.addOption(initialLanguage, initialLanguage);
					dropdown.setValue(initialLanguage);
					dropdown.onChange((value) => {
						this.communityActionsLanguage =
							normalizeLanguageCode(value);
						renderCommunityActionsList(communityActions);
					});
				})
				.addButton((button) => {
					refreshButton = button;
					button
						.setButtonText(
							I18n.t("settings.communityActionsRefresh"),
						)
						.onClick(async () => {
							CommunityActionsService.clearCache();
							await loadCommunityActions(true);
						});
				});
			communityActionsSection.insertBefore(
				languageSetting.settingEl,
				communityActionsList,
			);

			const searchSetting = new Setting(communityActionsSection)
				.setName(I18n.t("settings.communityActionsSearch"))
				.setDesc("")
				.setClass("local-gpt-community-actions-search")
				.addText((text) => {
					text.setPlaceholder(
						I18n.t("settings.communityActionsSearchPlaceholder"),
					);
					text.onChange((value) => {
						communityActionsSearchQuery = value;
						renderCommunityActionsList(communityActions);
					});
				});
			communityActionsSection.insertBefore(
				searchSetting.settingEl,
				communityActionsList,
			);

			modal.onClose = () => {
				this.communityActionsRenderId = 0;
				modal.contentEl.empty();
			};

			modal.open();
			loadCommunityActions();
		};

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
							this.plugin.settings.actions =
								DEFAULT_SETTINGS.actions.map((action) => ({
									...action,
								}));
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
