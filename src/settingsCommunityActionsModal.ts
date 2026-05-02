import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Setting,
} from "obsidian";
import type LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import { CommunityActionsService } from "./CommunityActionsService";
import type { CommunityAction } from "./CommunityActionsService";
import type { CommunityActionMatch } from "./settingsTabUtils";
import {
	buildCommunityActionRef,
	buildCommunityActionsLookup,
	getCommunityActionSearchRank,
	normalizeLanguageCode,
	normalizeSearchValue,
	resolveCommunityActionState,
} from "./settingsTabUtils";
import type { ScrollAlign } from "./settingsScroll";
import { renderCommunityActionRow } from "./settingsCommunityActionRows";
import {
	buildCommunityActionsSyncMessage,
	syncCommunityActions,
} from "./settingsCommunityActionsSync";

interface CommunityActionsPendingScroll {
	action: LocalGPTAction;
	align: ScrollAlign;
	target: "form" | "row";
}

export interface OpenCommunityActionsModalOptions {
	app: App;
	plugin: LocalGPT;
	containerEl: HTMLElement;
	defaultCommunityActionsLanguage: string;
	getLanguage: () => string | undefined;
	setLanguage: (language: string | undefined) => void;
	getStatusMessage: () => string;
	setStatusMessage: (message: string) => void;
	getRenderId: () => number;
	setRenderId: (renderId: number) => void;
	captureScrollPosition: (anchor: HTMLElement) => void;
	setPendingScroll: (pendingScroll?: CommunityActionsPendingScroll) => void;
	addNewAction: (action: LocalGPTAction) => Promise<void>;
	display: () => Promise<void> | void;
}

export function openCommunityActionsModal(
	options: OpenCommunityActionsModalOptions,
) {
	const modal = new Modal(options.app);
	modal.modalEl.addClass("local-gpt-community-actions-modal");
	modal.titleEl.setText(I18n.t("settings.communityActions"));
	const modalContent = modal.contentEl;

	const communityActionsRenderId = Date.now();
	options.setRenderId(communityActionsRenderId);

	const communityActionsSection = modalContent.createDiv(
		"local-gpt-community-actions",
	);
	const communityActionsDescription = communityActionsSection.createDiv(
		"setting-item-description",
	);
	communityActionsDescription.innerHTML = I18n.t(
		"settings.communityActionsDesc",
	);

	const communityActionsHint = communityActionsSection.createDiv(
		"local-gpt-community-actions-hint",
	);
	communityActionsHint.setText(I18n.t("settings.communityActionsAutoUpdate"));

	const communityActionsStatus = communityActionsSection.createDiv(
		"local-gpt-community-actions-status-line",
	);
	communityActionsStatus.setText(options.getStatusMessage() || "");
	communityActionsStatus.toggleClass(
		"local-gpt-is-hidden",
		!options.getStatusMessage(),
	);

	options.setLanguage(
		normalizeLanguageCode(
			options.getLanguage() || options.defaultCommunityActionsLanguage,
		),
	);

	let communityActions: CommunityAction[] = [];
	let communityActionsLoaded = false;
	let languageDropdown: DropdownComponent | null = null;
	let refreshButton: ButtonComponent | null = null;
	let communityActionsSearchQuery = "";

	const communityActionsList = communityActionsSection.createDiv(
		"local-gpt-community-actions-list",
	);

	const getSelectedLanguage = () =>
		normalizeLanguageCode(
			options.getLanguage() || options.defaultCommunityActionsLanguage,
		);

	const renderCommunityActionsMessage = (
		message: string,
		className: string,
	) => {
		communityActionsList.empty();
		const messageEl = communityActionsList.createDiv(className);
		messageEl.setText(message);
	};

	const setCommunityActionsStatusMessage = (message: string) => {
		options.setStatusMessage(message);
		if (!message) {
			communityActionsStatus.setText("");
			communityActionsStatus.addClass("local-gpt-is-hidden");
			return;
		}
		communityActionsStatus.setText(message);
		communityActionsStatus.removeClass("local-gpt-is-hidden");
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
		options.captureScrollPosition(options.containerEl);
		await options.addNewAction(localAction);
		refreshCommunityActionsList();
		options.setPendingScroll({
			action: localAction,
			align: "center",
			target: "row",
		});
		options.display();
	};

	const renderCommunityActionsList = (actions: CommunityAction[]) => {
		if (!communityActionsLoaded) {
			renderCommunityActionsMessage(
				I18n.t("settings.communityActionsLoading"),
				"local-gpt-community-actions-loading",
			);
			return;
		}

		const selectedLanguage = getSelectedLanguage();
		const languageFiltered = actions.filter(
			(action) =>
				normalizeLanguageCode(action.language) === selectedLanguage,
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
					const rank = getCommunityActionSearchRank(action, query);
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
			options.plugin.settings.actions,
		);
		filtered.forEach((action) =>
			renderCommunityActionRow({
				listEl: communityActionsList,
				action,
				state: resolveCommunityActionState(action, lookup),
				installCommunityAction,
			}),
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
			actions.map((action) => normalizeLanguageCode(action.language)),
		);
		if (options.getLanguage()) {
			languages.add(normalizeLanguageCode(options.getLanguage()));
		}
		languages.add(options.defaultCommunityActionsLanguage);

		const languageOptions = Array.from(languages).sort((a, b) =>
			a.localeCompare(b),
		);
		languageDropdown.selectEl.options.length = 0;
		languageOptions.forEach((language) => {
			languageDropdown?.addOption(language, language);
		});
		languageDropdown.setValue(getSelectedLanguage());
	};

	const finishCommunityActionsLoad = (actions: CommunityAction[]) => {
		communityActionsLoaded = true;
		updateCommunityActionsLanguageOptions(actions);
		renderCommunityActionsList(actions);
	};

	const handleCommunityActions = async (
		actions: CommunityAction[],
	): Promise<boolean> => {
		if (options.getRenderId() !== communityActionsRenderId) {
			return true;
		}
		communityActions = actions;
		const syncResult = await syncCommunityActions(options.plugin, actions);
		const syncMessage = buildCommunityActionsSyncMessage(syncResult);
		setCommunityActionsStatusMessage(syncMessage);
		if (syncResult.updated > 0) {
			options.display();
			return true;
		}
		finishCommunityActionsLoad(actions);
		return false;
	};

	const handleCommunityActionsError = (error: unknown) => {
		if (options.getRenderId() !== communityActionsRenderId) {
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
			const actions = await CommunityActionsService.getCommunityActions({
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
			const initialLanguage = getSelectedLanguage();
			dropdown.addOption(initialLanguage, initialLanguage);
			dropdown.setValue(initialLanguage);
			dropdown.onChange((value) => {
				options.setLanguage(normalizeLanguageCode(value));
				renderCommunityActionsList(communityActions);
			});
		})
		.addButton((button) => {
			refreshButton = button;
			button
				.setButtonText(I18n.t("settings.communityActionsRefresh"))
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
		options.setRenderId(0);
		modal.contentEl.empty();
	};

	modal.open();
	loadCommunityActions();
}
