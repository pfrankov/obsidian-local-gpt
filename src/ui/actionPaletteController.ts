import { tick } from "svelte";
import type {
	ActionPaletteSubmitEvent,
	CommandReference,
	CreativityReference,
	FileReference,
	GetFilesCallback,
	GetModelsCallback,
	GetProvidersCallback,
	GetSystemPromptsCallback,
	ModelReference,
	OnCreativityChangeCallback,
	OnModelChangeCallback,
	OnProviderChangeCallback,
	ProviderReference,
	SystemPromptReference,
	TextToken,
} from "../interfaces";
import {
	addToPromptHistory,
	getPromptHistoryLength,
} from "./actionPaletteHistory";
import type { DropdownItem, DropdownKind } from "./actionPaletteTypes";
import {
	getCommandQuery as getCommandQueryFromText,
	parseTextToTokens as parseTextToTokenResult,
	renderTokensAsHtml as renderTokenHtml,
} from "./actionPaletteText";
import {
	getCurrentCursorPosition,
	setCursorPosition,
} from "./actionPaletteDom";
import {
	buildProviderLabel,
	getAvailableCommands,
	getMentionedFilePaths,
} from "./actionPaletteOptions";
import type { ActionPaletteState } from "./actionPaletteState";
import {
	applyInitialSelectedFiles,
	insertCommandAtCursor,
	insertFileAtCursor,
	removeCommandAndQuery as removeCommandQueryFromText,
	removeFileReference,
	updateContentDisplay as updatePaletteContentDisplay,
} from "./actionPaletteEditing";
import {
	applyCreativityFilter as applyCreativityFilterSelection,
	applyModelFilter as applyModelFilterSelection,
	applyProviderFilter as applyProviderFilterSelection,
	applySystemFilter as applySystemFilterSelection,
	selectCreativity as selectCreativityOption,
	selectModel as selectModelOption,
	selectProvider as selectProviderOption,
	selectSystemPrompt as selectSystemPromptOption,
	showCreativityDropdown as showCreativityDropdownSelection,
	showModelDropdown as showModelDropdownSelection,
	showProviderDropdown as showProviderDropdownSelection,
	showSystemDropdown as showSystemDropdownSelection,
} from "./actionPaletteSelections";
import {
	handleDropdownNavigation,
	handleGeneralNavigation,
	handleHistoryNavigation,
} from "./actionPaletteNavigation";
import {
	checkForCommandTrigger,
	checkForMentionTrigger,
} from "./actionPaletteTriggers";

interface DropdownController {
	kind: DropdownKind;
	show: () => void | Promise<void>;
	refresh: () => void;
}

export interface ActionPaletteControllerOptions {
	getValue: () => string;
	getProviderId: () => string | undefined;
	setProviderId: (providerId: string) => void;
	getInitialSelectedFiles: () => string[];
	getSelectedSystemPromptId: () => string | null;
	getFiles: () => GetFilesCallback | undefined;
	getProviders: () => GetProvidersCallback | undefined;
	getModels: () => GetModelsCallback | undefined;
	getSystemPrompts: () => GetSystemPromptsCallback | undefined;
	onProviderChange: () => OnProviderChangeCallback | undefined;
	onModelChange: () => OnModelChangeCallback | undefined;
	onCreativityChange: () => OnCreativityChangeCallback | undefined;
	onSystemPromptChange: () =>
		| ((systemPromptId: string | null) => Promise<void> | void)
		| undefined;
	onSubmit: () => ((event: ActionPaletteSubmitEvent) => void) | undefined;
	onCancel: () => (() => void) | undefined;
	setProviderLabel: (label: string) => void;
	getContentElement: () => HTMLDivElement | null;
	getDropdownElement: (kind: DropdownKind) => HTMLElement | null;
	dispatchSubmit: (payload: ActionPaletteSubmitEvent) => void;
	dispatchCancel: () => void;
	invalidate: () => void;
}

export class ActionPaletteController {
	private readonly dropdownControllers: Record<
		"provider" | "model" | "creativity" | "system",
		DropdownController
	>;

	constructor(
		readonly state: ActionPaletteState,
		readonly options: ActionPaletteControllerOptions,
	) {
		this.dropdownControllers = {
			provider: {
				kind: "provider",
				show: () => showProviderDropdownSelection(this),
				refresh: () => applyProviderFilterSelection(this),
			},
			model: {
				kind: "model",
				show: () => showModelDropdownSelection(this),
				refresh: () => applyModelFilterSelection(this),
			},
			creativity: {
				kind: "creativity",
				show: () => showCreativityDropdownSelection(this),
				refresh: () => applyCreativityFilterSelection(this),
			},
			system: {
				kind: "system",
				show: () => showSystemDropdownSelection(this),
				refresh: () => applySystemFilterSelection(this),
			},
		};
	}

	initializeContent() {
		this.state.initializedContent = true;
		if (this.options.getValue()) {
			this.state.textContent = this.options.getValue();
		}
		applyInitialSelectedFiles(this);
		this.state.textTokens = this.parseTextToTokens(this.state.textContent);
		this.updateContentDisplay();
		void tick().then(() => {
			this.options.getContentElement()?.focus();
			setCursorPosition(
				this.options.getContentElement(),
				this.state.textContent.length,
			);
		});
		this.commit();
	}

	restoreSelectedSystemPrompt() {
		const selectedSystemPromptId = this.options.getSelectedSystemPromptId();
		const getSystemPrompts = this.options.getSystemPrompts();
		if (!selectedSystemPromptId || !getSystemPrompts) {
			this.state.selectedSystemPromptName = "";
			this.state.selectedSystemPromptValue = undefined;
			this.commit();
			return;
		}

		const matchedPrompt = getSystemPrompts().find(
			(prompt) => prompt.id === selectedSystemPromptId,
		);
		if (!matchedPrompt) {
			void this.options.onSystemPromptChange()?.(null);
			this.state.selectedSystemPromptName = "";
			this.state.selectedSystemPromptValue = undefined;
			this.commit();
			return;
		}

		this.state.selectedSystemPromptName = matchedPrompt.name;
		this.state.selectedSystemPromptValue = matchedPrompt.system;
		this.commit();
	}

	handleKeydown(event: KeyboardEvent) {
		if (handleDropdownNavigation(this, event)) return;
		if (handleHistoryNavigation(this, event)) return;
		handleGeneralNavigation(this, event);
		this.commit();
	}

	handleInput(
		event: InputEvent & {
			currentTarget: HTMLDivElement;
			target: HTMLDivElement;
		},
	) {
		const target = event.target;
		this.state.textContent = target.textContent || "";
		this.state.cursorPosition = getCurrentCursorPosition(
			this.options.getContentElement(),
		);
		this.state.historyIndex = getPromptHistoryLength();
		this.state.draftBeforeHistory = this.state.textContent;
		this.state.textTokens = this.parseTextToTokens(this.state.textContent);
		checkForMentionTrigger(this);
		checkForCommandTrigger(this);

		const newHtmlContent = renderTokenHtml(this.state.textTokens);
		if (target.innerHTML !== newHtmlContent) {
			this.updateContentDisplay();
		}
		this.commit();
	}

	handleSelection(item: DropdownItem) {
		switch (this.state.activeDropdown) {
			case "file":
				insertFileAtCursor(this, item as FileReference);
				break;
			case "command":
				insertCommandAtCursor(this, item as CommandReference);
				break;
			case "provider":
				void selectProviderOption(this, item as ProviderReference);
				break;
			case "model":
				void selectModelOption(this, item as ModelReference);
				break;
			case "creativity":
				void selectCreativityOption(this, item as CreativityReference);
				break;
			case "system":
				void selectSystemPromptOption(
					this,
					item as SystemPromptReference,
				);
				break;
		}
		this.commit();
	}

	handleContentClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.classList.contains("file-mention")) return;

		const filePath = target.dataset.path;
		if (filePath) {
			removeFileReference(this, filePath);
		}
		this.commit();
	}

	handleKeyup(event: KeyboardEvent) {
		if (event.key !== "Backspace" && event.key !== "Delete") return;

		const currentlyMentionedFiles = getMentionedFilePaths(
			this.state.textTokens,
		);
		const filesToRemove = this.state.selectedFiles.filter(
			(filePath) => !currentlyMentionedFiles.includes(filePath),
		);

		if (filesToRemove.length > 0) {
			this.state.selectedFiles = this.state.selectedFiles.filter((path) =>
				currentlyMentionedFiles.includes(path),
			);
			this.commit();
		}
	}

	submitAction() {
		addToPromptHistory(this.state.textContent);
		this.state.historyIndex = getPromptHistoryLength();
		this.state.draftBeforeHistory = this.state.textContent;
		const payload = {
			text: this.state.textContent,
			selectedFiles: this.state.selectedFiles,
			systemPrompt: this.state.selectedSystemPromptValue,
		};
		this.options.onSubmit()?.(payload);
		this.options.dispatchSubmit(payload);
		this.commit();
	}

	getFiles() {
		return this.options.getFiles()?.() ?? [];
	}

	parseTextToTokens(text: string): TextToken[] {
		const result = parseTextToTokenResult(
			text,
			this.getFiles(),
			this.state.selectedFiles,
			getAvailableCommands(),
		);
		this.state.selectedFiles = result.selectedFiles;
		return result.tokens;
	}

	activateCommandDropdown(commandName: string) {
		const dropdownController =
			this.dropdownControllers[
				commandName as keyof typeof this.dropdownControllers
			];
		if (!dropdownController) return false;
		if (this.state.activeDropdown !== dropdownController.kind) {
			void dropdownController.show();
			return true;
		}
		dropdownController.refresh();
		return true;
	}

	updateFilteredDropdownItems(matches: DropdownItem[]) {
		this.state.filteredItems = matches;
		if (matches.length === 0) {
			this.state.selectedIndex = -1;
		} else if (
			this.state.selectedIndex < 0 ||
			this.state.selectedIndex >= matches.length
		) {
			this.state.selectedIndex = 0;
		}
		this.commit();
	}

	hideDropdown() {
		this.state.activeDropdown = "none";
		this.state.filteredItems = [];
		this.state.selectedIndex = -1;
		this.state.mentionStartIndex = -1;
		this.state.commandStartIndex = -1;
		this.state.allProviders = [];
		this.state.allModels = [];
		this.state.allCreativities = [];
		this.state.allSystemPrompts = [];
		this.commit();
	}

	removeCommandAndQuery(commandName: string) {
		removeCommandQueryFromText(this, commandName);
	}

	getCommandQuery(commandName: string): string {
		return getCommandQueryFromText(
			commandName,
			this.state.textContent,
			this.state.cursorPosition,
		);
	}

	updateContentDisplay() {
		updatePaletteContentDisplay(this);
	}

	setProviderBadgeLabel(providerName: string, modelName: string) {
		this.state.providerName = providerName;
		this.state.modelName = modelName;
		this.options.setProviderLabel(
			buildProviderLabel(
				this.state.providerName,
				this.state.modelName,
				this.state.creativityBadge,
			),
		);
	}

	highlightBadgeTemporarily() {
		this.state.badgeHighlight = true;
		this.commit();
		setTimeout(() => {
			this.state.badgeHighlight = false;
			this.commit();
		}, 900);
	}

	commit() {
		this.options.invalidate();
	}
}
