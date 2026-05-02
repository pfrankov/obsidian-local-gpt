import { Notice, Platform, Setting, setIcon } from "obsidian";
import Sortable from "sortablejs";
import type LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import { isSeparatorAction, moveAction } from "./actionUtils";
import { buildActionDescription, buildSharingString } from "./settingsTabUtils";
import {
	getScrollableParent,
	smoothScrollToTarget,
	triggerHighlight,
	type ScrollAlign,
} from "./settingsScroll";
import { renderActionEditor as renderActionEditorForm } from "./settingsActionEditor";

interface PendingActionScroll {
	action: LocalGPTAction;
	align: ScrollAlign;
	target: "form" | "row";
}

interface RenderActionsListOptions {
	containerEl: HTMLElement;
	plugin: LocalGPT;
	editExistingAction?: LocalGPTAction;
	defaultCommunityActionsLanguage: string;
	getPendingScroll: () => PendingActionScroll | undefined;
	setPendingScroll: (pendingScroll?: PendingActionScroll) => void;
	restoreScrollPosition: (anchor: HTMLElement) => void;
	closeActionEditor: (scrollAction?: LocalGPTAction) => void;
	addNewAction: (action: LocalGPTAction) => Promise<void>;
	dropCommunityLinkIfModified: (action: LocalGPTAction) => void;
	startEditingAction: (action: LocalGPTAction) => void;
	display: () => Promise<void> | void;
}

export function renderActionsList(options: RenderActionsListOptions) {
	options.containerEl.createEl("h4", {
		text: I18n.t("settings.actionsList"),
	});

	const actionsContainer = options.containerEl.createDiv(
		"local-gpt-actions-container",
	);
	const isMobile = Platform.isMobile || Platform.isMobileApp;

	const updateOrder = async (fromIndex: number, toIndex: number) => {
		const updatedActions = moveAction(
			options.plugin.settings.actions,
			fromIndex,
			toIndex,
		);
		if (updatedActions === options.plugin.settings.actions) {
			return;
		}
		options.plugin.settings.actions = updatedActions;
		await options.plugin.saveSettings();
	};

	const editFormScrollOffset = 30;

	const applyPendingScroll = (
		action: LocalGPTAction,
		target: HTMLElement,
		targetType: "form" | "row",
		offset = 0,
		highlightTarget?: HTMLElement,
	) => {
		const pendingScroll = options.getPendingScroll();
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
		options.setPendingScroll(undefined);
	};

	const addMobileMoveButtons = (row: Setting, actionIndex: number) => {
		if (!isMobile) return;

		row.addExtraButton((button) => {
			button
				.setIcon("chevron-up")
				.setTooltip(I18n.t("settings.moveUp"))
				.onClick(async () => {
					await updateOrder(actionIndex, actionIndex - 1);
					options.display();
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
					options.display();
				});
			if (actionIndex === options.plugin.settings.actions.length - 1) {
				button.setDisabled(true);
			}
		});
	};

	const renderSeparatorActionRow = (
		action: LocalGPTAction,
		actionIndex: number,
	) => {
		const actionRow = new Setting(actionsContainer).setName("").setDesc("");

		actionRow.settingEl.addClass("local-gpt-action-row");
		actionRow.settingEl.addClass("local-gpt-action-separator");
		actionRow.settingEl.setAttribute(
			"aria-label",
			I18n.t("settings.separator"),
		);

		const handle = actionRow.settingEl.createDiv("local-gpt-drag-handle");
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

					options.plugin.settings.actions =
						options.plugin.settings.actions.filter(
							(innerAction) => innerAction !== action,
						);
					await options.plugin.saveSettings();
					options.display();
				}),
		);
	};

	const renderActionRow = (action: LocalGPTAction, actionIndex: number) => {
		const isEditingRow = options.editExistingAction === action;
		const actionRow = new Setting(actionsContainer);

		actionRow.settingEl.addClass("local-gpt-action-row");

		if (isEditingRow) {
			actionRow.controlEl.remove();
			actionRow.infoEl.empty();
			renderActionEditorForm({
				container: actionRow.infoEl,
				plugin: options.plugin,
				actionToEdit: action,
				isExistingAction: true,
				closeActionEditor: options.closeActionEditor,
				addNewAction: options.addNewAction,
				dropCommunityLinkIfModified:
					options.dropCommunityLinkIfModified,
			});
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

		const handle = actionRow.settingEl.createDiv("local-gpt-drag-handle");
		setIcon(handle, "grip-vertical");
		actionRow.settingEl.prepend(handle);

		addMobileMoveButtons(actionRow, actionIndex);

		const sharingString = buildSharingString(
			action,
			options.defaultCommunityActionsLanguage,
		);

		actionRow
			.addButton((button) =>
				button.setIcon("copy").onClick(async () => {
					navigator.clipboard.writeText(sharingString);
					new Notice(I18n.t("notices.copied"));
				}),
			)
			.addButton((button) =>
				button.setButtonText("Edit").onClick(async () => {
					options.startEditingAction(action);
				}),
			);

		actionRow.descEl.innerHTML = buildActionDescription(action);

		applyPendingScroll(action, actionRow.settingEl, "row");
	};

	options.plugin.settings.actions.forEach((action, actionIndex) => {
		if (isSeparatorAction(action)) {
			renderSeparatorActionRow(action, actionIndex);
			return;
		}

		renderActionRow(action, actionIndex);
	});

	options.restoreScrollPosition(actionsContainer);
	options.setPendingScroll(undefined);

	setupActionsSortable(actionsContainer, updateOrder, options.plugin);
}

function setupActionsSortable(
	actionsContainer: HTMLElement,
	updateOrder: (fromIndex: number, toIndex: number) => Promise<void>,
	plugin: LocalGPT,
) {
	if (plugin.settings.actions.length <= 1) {
		return;
	}
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
		const threshold = 48;
		const maxStep = 18;

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
		scrollEl.removeEventListener("pointermove", handleEdgeScroll as any);
		scrollEl.removeEventListener("touchmove", handleEdgeScroll as any);
	};

	Sortable.create(actionsContainer, {
		animation: 150,
		draggable: ".setting-item",
		handle: ".local-gpt-drag-handle",
		ghostClass: "local-gpt-sortable-ghost",
		chosenClass: "local-gpt-sortable-chosen",
		dragClass: "local-gpt-sortable-drag",
		onStart: () => {
			scrollEl = getScrollableParent(actionsContainer);
			addEdgeScrollListeners();
		},
		onEnd: async (evt: any) => {
			removeEdgeScrollListeners();
			if (autoScrollFrame !== null) {
				cancelAnimationFrame(autoScrollFrame);
				autoScrollFrame = null;
			}
			autoScrollDelta = 0;
			scrollEl = null;
			animateDroppedRow(evt?.item);
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

function animateDroppedRow(droppedEl?: HTMLElement) {
	if (!droppedEl) {
		return;
	}
	droppedEl.classList.add("local-gpt-drop-animate");
	droppedEl.addEventListener(
		"animationend",
		() => droppedEl.classList.remove("local-gpt-drop-animate"),
		{ once: true },
	);

	const prevEl = droppedEl.previousElementSibling as HTMLElement | null;
	const nextEl = droppedEl.nextElementSibling as HTMLElement | null;
	animateDropNeighbor(prevEl, "local-gpt-drop-neighbor-prev");
	animateDropNeighbor(nextEl, "local-gpt-drop-neighbor-next");
}

function animateDropNeighbor(element: HTMLElement | null, className: string) {
	if (!element || !element.classList.contains("setting-item")) {
		return;
	}
	element.classList.add(className);
	element.addEventListener(
		"animationend",
		() => element.classList.remove(className),
		{ once: true },
	);
}
