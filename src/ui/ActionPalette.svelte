<script lang="ts">
	import { onMount, createEventDispatcher, tick } from "svelte";
	import { I18n } from "../i18n";
	import {
		addToPromptHistory,
		getPromptHistoryEntry,
		getPromptHistoryLength,
	} from "./actionPaletteHistory";
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

	type DropdownItem =
		| FileReference
		| CommandReference
		| ProviderReference
		| ModelReference
		| CreativityReference
		| SystemPromptReference;
	type DropdownKind =
		| "none"
		| "file"
		| "command"
		| "provider"
		| "model"
		| "creativity"
		| "system";
	type SelectionHandler = (
		item: DropdownItem,
	) => void | Promise<void> | undefined;
	type PaletteEvents = {
		submit: ActionPaletteSubmitEvent;
		cancel: void;
	};

	// Constants
	const MAX_DROPDOWN_RESULTS = 15;
	const FILE_MENTION_REGEX = /@([^@]+?\.[a-zA-Z0-9]+)(?=\s|$|@)/g;
	const MENTION_PREFIX = "@";
	const SPACE_AFTER_MENTION = " ";
	const COMMAND_REGEX = /\/([^\/\s]+)(?=\s|$|\/)/g;
	const COMMAND_PREFIX = "/";
	const SPACE_AFTER_COMMAND = " ";

	// Exported props
	export let placeholder: string = I18n.t(
		"commands.actionPalette.placeholder",
	);
	export let value = "";
	export let providerLabel = "";
	export let providerId: string | undefined = undefined;
	export let getFiles: GetFilesCallback | undefined = undefined;
	export let getProviders: GetProvidersCallback | undefined = undefined;
	export let onProviderChange: OnProviderChangeCallback | undefined =
		undefined;
	export let getModels: GetModelsCallback | undefined = undefined;
	export let onModelChange: OnModelChangeCallback | undefined = undefined;
	export let onCreativityChange:
		| OnCreativityChangeCallback
		| undefined = undefined;
	export let getSystemPrompts:
		| GetSystemPromptsCallback
		| undefined = undefined;

	// Event dispatcher
	const dispatch = createEventDispatcher<PaletteEvents>();

	// DOM element references
	let contentElement: HTMLDivElement | null = null;
	let dropdownElement: HTMLDivElement | null = null;
	let commandDropdownElement: HTMLDivElement | null = null;
	let providerDropdownElement: HTMLDivElement | null = null;
	let modelDropdownElement: HTMLDivElement | null = null;
	let creativityDropdownElement: HTMLDivElement | null = null;
	let systemDropdownElement: HTMLDivElement | null = null;

	// Dropdown state
	let activeDropdown: DropdownKind = "none";

	// Unified filtered items
	let filteredItems: DropdownItem[] = [];
	let fileItems: FileReference[] = [];
	let commandItems: CommandReference[] = [];
	let providerItems: ProviderReference[] = [];
	let modelItems: ModelReference[] = [];
	let creativityItems: CreativityReference[] = [];
	let systemItems: SystemPromptReference[] = [];

	$: fileItems =
		activeDropdown === "file"
			? (filteredItems as FileReference[])
			: [];
	$: commandItems =
		activeDropdown === "command"
			? (filteredItems as CommandReference[])
			: [];
	$: providerItems =
		activeDropdown === "provider"
			? (filteredItems as ProviderReference[])
			: [];
	$: modelItems =
		activeDropdown === "model"
			? (filteredItems as ModelReference[])
			: [];
	$: creativityItems =
		activeDropdown === "creativity"
			? (filteredItems as CreativityReference[])
			: [];
	$: systemItems =
		activeDropdown === "system"
			? (filteredItems as SystemPromptReference[])
			: [];

	// Cache all items
	let allProviders: ProviderReference[] = [];
	let allModels: ModelReference[] = [];
	let allCreativities: CreativityReference[] = [];
	let allSystemPrompts: SystemPromptReference[] = [];

	function updateFilteredDropdownItems(matches: DropdownItem[]) {
		filteredItems = matches;
		if (matches.length === 0) {
			selectedIndex = -1;
			return;
		}
		if (selectedIndex < 0 || selectedIndex >= matches.length) {
			selectedIndex = 0;
		}
	}

	type DropdownController = {
		kind: DropdownKind;
		show: () => void | Promise<void>;
		refresh: () => void;
	};

	const dropdownControllers: Record<
		"provider" | "model" | "creativity" | "system",
		DropdownController
	> = {
		provider: {
			kind: "provider",
			show: () => showProviderDropdown(),
			refresh: () => applyProviderFilter(),
		},
		model: {
			kind: "model",
			show: () => showModelDropdown(),
			refresh: () => applyModelFilter(),
		},
		creativity: {
			kind: "creativity",
			show: () => showCreativityDropdown(),
			refresh: () => applyCreativityFilter(),
		},
		system: {
			kind: "system",
			show: () => showSystemDropdown(),
			refresh: () => applySystemFilter(),
		},
	};

	let selectedIndex = -1;
	let badgeHighlight = false;
	let selectedSystemPromptValue: string | undefined = undefined;
	let historyIndex = getPromptHistoryLength();
	let draftBeforeHistory = value;

	// File and content state
	let selectedFiles: string[] = [];
	let textContent = "";
	let cursorPosition = 0;
	let mentionStartIndex = -1;
	let commandStartIndex = -1;

	// Text parsing state
	let textTokens: TextToken[] = [];

	let providerName = providerLabel.split(" · ")[0] || "";
	let modelName = (providerLabel.split(" · ")[1] || "").trim();
	let creativityBadge = (providerLabel.split(" · ")[2] || "").trim();
	let systemPromptBadge = "";
	const SYSTEM_PREVIEW_LENGTH = 80;

	function getCreativityOptions(): CreativityReference[] {
		return [
			{ id: "", name: I18n.t("settings.creativityNone") },
			{ id: "low", name: I18n.t("settings.creativityLow") },
			{ id: "medium", name: I18n.t("settings.creativityMedium") },
			{ id: "high", name: I18n.t("settings.creativityHigh") },
		];
	}

	function findMatchingFile(
		fileName: string,
		availableFiles: FileReference[],
	): FileReference | undefined {
		const normalizedFileName = fileName.toLowerCase();
		return availableFiles.find((file) => {
			const fullFileName = `${file.basename}.${file.extension}`;
			return fullFileName.toLowerCase() === normalizedFileName;
		});
	}

	function extractMentionsFromText(text: string) {
		if (!getFiles) {
			return { mentions: [], newSelectedFiles: [] };
		}

		const availableFiles = getFiles();
		const mentions: string[] = [];
		const newSelectedFiles: string[] = [];
		const mentionMatches = Array.from(text.matchAll(FILE_MENTION_REGEX));

		for (const match of mentionMatches) {
			const fileName = (match[1] || "").trim();
			const matchedFile = findMatchingFile(fileName, availableFiles);

			if (matchedFile && !selectedFiles.includes(matchedFile.path)) {
				newSelectedFiles.push(matchedFile.path);
			}

			mentions.push(match[0]);
		}

		return { mentions, newSelectedFiles };
	}

	function getAvailableCommands(): CommandReference[] {
		return [
			{
				name: "provider",
				description: I18n.t("commands.actionPalette.changeProvider"),
			},
			{
				name: "model",
				description: I18n.t("commands.actionPalette.changeModel"),
			},
			{
				name: "creativity",
				description: I18n.t("commands.actionPalette.changeCreativity"),
			},
			{
				name: "system",
				description: I18n.t(
					"commands.actionPalette.changeSystemPrompt",
				),
			},
		];
	}

	async function fetchAvailableProviders(): Promise<ProviderReference[]> {
		if (!getProviders) return [];

		try {
			return await getProviders();
		} catch (error) {
			console.error("Error fetching providers:", error);
			return [];
		}
	}

	async function fetchAvailableModels(): Promise<ModelReference[]> {
		if (!getModels || !providerId) return [];

		try {
			return await getModels(providerId);
		} catch (error) {
			console.error("Error fetching models:", error);
			return [];
		}
	}

	function parseTextToTokens(text: string): TextToken[] {
		const tokens: TextToken[] = [];

		// Handle file mentions if getFiles is available
		if (getFiles) {
			const availableFiles = getFiles();
			const { newSelectedFiles } = extractMentionsFromText(text);

			// Update selected files with newly discovered ones
			if (newSelectedFiles.length > 0) {
				selectedFiles = [...selectedFiles, ...newSelectedFiles];
			}
		}

		// Get all matches (both file mentions and commands)
		const mentionMatches = getFiles
			? (Array.from(text.matchAll(FILE_MENTION_REGEX)) as RegExpMatchArray[])
			: [];
		const commandMatches = Array.from(
			text.matchAll(COMMAND_REGEX),
		) as RegExpMatchArray[];

		// Combine all matches and sort by position
		const allMatches = [
			...mentionMatches.map((match) => ({ type: "file", match })),
			...commandMatches.map((match) => ({ type: "command", match })),
		].sort((a, b) => (a.match.index ?? 0) - (b.match.index ?? 0));

		let lastIndex = 0;

		for (const { type, match } of allMatches) {
			const matchStart = match.index ?? 0;
			const matchEnd = matchStart + match[0].length;

			// Add text before this match
			if (matchStart > lastIndex) {
				tokens.push({
					type: "text",
					content: text.substring(lastIndex, matchStart),
					start: lastIndex,
					end: matchStart,
				});
			}

			if (type === "file" && getFiles) {
				const fileName = (match[1] || "").trim();
				const availableFiles = getFiles();
				const matchedFile = findMatchingFile(fileName, availableFiles);

				if (matchedFile) {
					// Valid file mention
					tokens.push({
						type: "file",
						content: match[0],
						start: matchStart,
						end: matchEnd,
						filePath: matchedFile.path,
					});
				} else {
					// Invalid file mention - treat as text
					tokens.push({
						type: "text",
						content: match[0],
						start: matchStart,
						end: matchEnd,
					});
				}
			} else if (type === "command") {
				const commandName = (match[1] || "").trim();
				const availableCommands = getAvailableCommands();
				const matchedCommand = availableCommands.find(
					(cmd) => cmd.name === commandName,
				);

				if (matchedCommand) {
					// Valid command
					tokens.push({
						type: "command",
						content: match[0],
						start: matchStart,
						end: matchEnd,
						commandName: matchedCommand.name,
					});
				} else {
					// Invalid command - treat as text
					tokens.push({
						type: "text",
						content: match[0],
						start: matchStart,
						end: matchEnd,
					});
				}
			}

			lastIndex = matchEnd;
		}

		// Add remaining text
		if (lastIndex < text.length) {
			tokens.push({
				type: "text",
				content: text.substring(lastIndex),
				start: lastIndex,
				end: text.length,
			});
		}

		return tokens;
	}

	function getCurrentCursorPosition(): number {
		if (!contentElement) return 0;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return 0;

		const range = selection.getRangeAt(0);
		let position = 0;
		const walker = document.createTreeWalker(
			contentElement,
			NodeFilter.SHOW_TEXT,
			null,
		);

		let textNode;
		while ((textNode = walker.nextNode())) {
			if (textNode === range.startContainer) {
				return position + range.startOffset;
			}
			position += textNode.textContent?.length || 0;
		}

		return position;
	}

	function setCursorPosition(position: number) {
		if (!contentElement) return;

		const selection = window.getSelection();
		const range = document.createRange();

		let currentPosition = 0;
		const walker = document.createTreeWalker(
			contentElement,
			NodeFilter.SHOW_TEXT,
			null,
		);

		let textNode;
		while ((textNode = walker.nextNode())) {
			const nodeLength = textNode.textContent?.length || 0;
			if (currentPosition + nodeLength >= position) {
				const offset = position - currentPosition;
				range.setStart(textNode, offset);
				range.setEnd(textNode, offset);
				selection?.removeAllRanges();
				selection?.addRange(range);
				return;
			}
			currentPosition += nodeLength;
		}
	}

	function escapeHtmlContent(text: string) {
		const temporaryElement = document.createElement("div");
		temporaryElement.textContent = text;
		return temporaryElement.innerHTML;
	}

	function renderTokensAsHtml() {
		return textTokens
			.map((token) => {
				if (token.type === "file") {
					return `<span class="file-mention" data-path="${
						token.filePath
					}">${escapeHtmlContent(token.content)}</span>`;
				}
				if (token.type === "command") {
					return `<span class="command-mention" data-command="${
						token.commandName
					}">${escapeHtmlContent(token.content)}</span>`;
				}
				return escapeHtmlContent(token.content);
			})
			.join("");
	}

	function updateContentDisplay() {
		if (!contentElement) return;

		const currentCursor = getCurrentCursorPosition();
		contentElement.innerHTML = renderTokensAsHtml();

		// Restore cursor position after update
		tick().then(() => {
			setCursorPosition(currentCursor);
		});
	}

	function setProviderBadgeLabel(pName: string, mName: string) {
		providerName = pName;
		modelName = mName;
		const base = [providerName, modelName].filter(Boolean).join(" · ");
		const extras = [creativityBadge, systemPromptBadge]
			.filter(Boolean)
			.join(" · ");
		providerLabel = extras ? `${base} · ${extras}` : base;
	}

	function highlightBadgeTemporarily() {
		badgeHighlight = true;
		setTimeout(() => {
			badgeHighlight = false;
		}, 900);
	}

	function applyHistoryEntry(text: string) {
		textContent = text;
		cursorPosition = textContent.length;
		selectedFiles = [];
		textTokens = parseTextToTokens(textContent);
		hideDropdown();
		updateContentDisplay();
		tick().then(() => {
			setCursorPosition(textContent.length);
		});
	}

	onMount(() => {
		// Auto-focus the content element
		queueMicrotask(() => {
			contentElement?.focus();
			if (value) {
				textContent = value;
				textTokens = parseTextToTokens(textContent);
				updateContentDisplay();
			}
		});
	});

	function handleDropdownNavigation(event: KeyboardEvent) {
		if (activeDropdown === "none" || filteredItems.length === 0)
			return false;

		function moveSelection(delta: number) {
			selectedIndex = Math.min(
				Math.max(selectedIndex + delta, -1),
				filteredItems.length - 1,
			);
			scrollSelectedIntoView(
				getDropdownElementForActiveType(),
				selectedIndex,
			);
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				moveSelection(1);
				return true;

			case "ArrowUp":
				event.preventDefault();
				moveSelection(-1);
				return true;

			case "Enter":
				if (event.shiftKey) return false;
			case "Tab":
				event.preventDefault();
				if (selectedIndex >= 0 && filteredItems[selectedIndex]) {
					handleSelection(filteredItems[selectedIndex]);
				}
				return true;

			case "Escape":
				event.preventDefault();
				hideDropdown();
				return true;

			default:
				return false;
		}
	}

	function getDropdownElementForActiveType(): HTMLDivElement | null {
		switch (activeDropdown) {
			case "file":
				return dropdownElement;
			case "command":
				return commandDropdownElement;
			case "provider":
				return providerDropdownElement;
			case "model":
				return modelDropdownElement;
			case "creativity":
				return creativityDropdownElement;
			case "system":
				return systemDropdownElement;
			default:
				return null;
		}
	}

	function handleGeneralNavigation(event: KeyboardEvent) {
		switch (event.key) {
			case "Enter":
				if (event.shiftKey) return;
				event.preventDefault();
				submitAction();
				break;

			case "Escape":
				event.preventDefault();
				dispatch("cancel");
				break;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (handleDropdownNavigation(event)) {
			return;
		}

		if (handleHistoryNavigation(event)) {
			return;
		}

		handleGeneralNavigation(event);
	}

	function handleHistoryNavigation(event: KeyboardEvent) {
		const isHistoryKey =
			event.key === "ArrowUp" || event.key === "ArrowDown";
		if (!isHistoryKey || activeDropdown !== "none") {
			return false;
		}

		const currentPosition = getCurrentCursorPosition();
		cursorPosition = currentPosition;

		if (
			event.key === "ArrowUp" &&
			!isCursorOnFirstLine(currentPosition)
		) {
			return false;
		}

		if (
			event.key === "ArrowDown" &&
			!isCursorOnLastLine(currentPosition)
		) {
			return false;
		}

		const historyLength = getPromptHistoryLength();
		if (historyLength === 0) return false;

		if (historyIndex === historyLength) {
			draftBeforeHistory = textContent;
		}

		if (event.key === "ArrowUp") {
			if (historyIndex > 0) {
				historyIndex -= 1;
			}
		} else if (event.key === "ArrowDown") {
			if (historyIndex < historyLength) {
				historyIndex += 1;
			}
		}

		const entry =
			historyIndex >= 0 && historyIndex < historyLength
				? getPromptHistoryEntry(historyIndex)
				: draftBeforeHistory;
		event.preventDefault();
		applyHistoryEntry(entry || "");
		return true;
	}

	function isCursorOnFirstLine(position: number) {
		const index = Math.max(position - 1, 0);
		return textContent.lastIndexOf("\n", index) === -1;
	}

	function isCursorOnLastLine(position: number) {
		return textContent.indexOf("\n", position) === -1;
	}

	function handleInput(
		event: InputEvent & { currentTarget: HTMLDivElement; target: HTMLDivElement },
	) {
		const target = event.target;
		const newTextContent = target.textContent || "";

		// Update content state
		textContent = newTextContent;
		cursorPosition = getCurrentCursorPosition();
		historyIndex = getPromptHistoryLength();
		draftBeforeHistory = textContent;

		// Rebuild token structure
		textTokens = parseTextToTokens(textContent);

		// Check for file mentions and show dropdown if needed
		checkForMentionTrigger();

		// Check for command triggers and show dropdown if needed
		checkForCommandTrigger();

		// If provider dropdown is open, update its filter based on text after /provider
		if (activeDropdown === "provider") {
			applyProviderFilter();
		}

		// If model dropdown is open, update its filter based on text after /model
		if (activeDropdown === "model") {
			applyModelFilter();
		}

		// Update display if content has changed
		const newHtmlContent = renderTokensAsHtml();
		if (target.innerHTML !== newHtmlContent) {
			updateContentDisplay();
		}
	}

	function isCharacterWhitespace(character: string) {
		return /\s/.test(character);
	}

	function isCompleteMention(mentionText: string) {
		if (!getFiles) return false;

		return selectedFiles.some((filePath) => {
			const file = getFiles()?.find((f) => f.path === filePath);
			if (!file) return false;

			const fullFileName = `${file.basename}.${file.extension}`;
			return mentionText === `${MENTION_PREFIX}${fullFileName}`;
		});
	}

	function isCompleteCommand(commandText: string) {
		const availableCommands = getAvailableCommands();
		return availableCommands.some(
			(cmd) => commandText === `${COMMAND_PREFIX}${cmd.name}`,
		);
	}

	function getCommandQuery(commandName: string): string {
		const beforeCursor = textContent.substring(0, cursorPosition);
		const token = `${COMMAND_PREFIX}${commandName}`;
		const foundIndex = beforeCursor.lastIndexOf(token);
		if (foundIndex === -1) return "";
		const charBefore = foundIndex > 0 ? beforeCursor[foundIndex - 1] : " ";
		if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return "";
		const afterNameIndex = foundIndex + token.length;
		const afterName = textContent.substring(afterNameIndex);
		const hasSpace = afterName.startsWith(SPACE_AFTER_COMMAND);
		const queryStart = hasSpace
			? afterNameIndex + SPACE_AFTER_COMMAND.length
			: afterNameIndex;
		return textContent.substring(queryStart, cursorPosition).trim().toLowerCase();
	}

	function filterAvailableCommands(query: string): CommandReference[] {
		const availableCommands = getAvailableCommands();
		const normalizedQuery = query.toLowerCase();

		return availableCommands
			.filter((command) => {
				return (
					command.name.toLowerCase().includes(normalizedQuery) ||
					command.description.toLowerCase().includes(normalizedQuery)
				);
			})
			.slice(0, MAX_DROPDOWN_RESULTS);
	}

	function filterAvailableFiles(query: string): FileReference[] {
		if (!getFiles) return [];

		const availableFiles = getFiles();
		const normalizedQuery = query.toLowerCase();

		return availableFiles
			.filter((file) => {
				const fullFileName = `${file.basename}.${file.extension}`;
				const isQueryMatch =
					file.basename.toLowerCase().includes(normalizedQuery) ||
					fullFileName.toLowerCase().includes(normalizedQuery);
				const isNotAlreadySelected = !selectedFiles.includes(file.path);

				return isQueryMatch && isNotAlreadySelected;
			})
			.slice(0, MAX_DROPDOWN_RESULTS);
	}

	function checkForMentionTrigger() {
		if (!getFiles) return;

		const beforeCursor = textContent.substring(0, cursorPosition);
		const mentionIndex = beforeCursor.lastIndexOf(MENTION_PREFIX);

		if (mentionIndex === -1) {
			hideDropdown();
			return;
		}

		// Ensure @ is at start or preceded by whitespace
		const characterBeforeMention =
			mentionIndex > 0 ? beforeCursor[mentionIndex - 1] : " ";
		if (
			mentionIndex > 0 &&
			!isCharacterWhitespace(characterBeforeMention)
		) {
			hideDropdown();
			return;
		}

		const textAfterMention = beforeCursor.substring(mentionIndex + 1);
		const possibleMention = MENTION_PREFIX + textAfterMention;

		// Don't show dropdown for complete mentions
		if (isCompleteMention(possibleMention)) {
			hideDropdown();
			return;
		}

		mentionStartIndex = mentionIndex;
		filteredItems = filterAvailableFiles(textAfterMention);

		if (filteredItems.length > 0) {
			activeDropdown = "file";
			selectedIndex = 0;
		} else {
			hideDropdown();
		}
	}

	function hideDropdown() {
		activeDropdown = "none";
		filteredItems = [];
		selectedIndex = -1;
		mentionStartIndex = -1;
		commandStartIndex = -1;
		allProviders = [];
		allModels = [];
		allCreativities = [];
		allSystemPrompts = [];
	}

	function scrollSelectedIntoView(
		container: HTMLElement | null,
		index: number,
	) {
		if (!container || index < 0) return;
		const selectedItem = container.children[index];
		if (!selectedItem) return;
		const dropdownRect = container.getBoundingClientRect();
		const itemRect = selectedItem.getBoundingClientRect();
		const isItemVisible =
			itemRect.top >= dropdownRect.top &&
			itemRect.bottom <= dropdownRect.bottom;
		if (!isItemVisible) {
			selectedItem.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			});
		}
	}

	function insertFileAtCursor(file: FileReference) {
		if (mentionStartIndex === -1) return;

		// Add to selected files if not already present
		if (!selectedFiles.includes(file.path)) {
			selectedFiles = [...selectedFiles, file.path];
		}

		// Build new text with file mention
		const fullFileName = `${file.basename}.${file.extension}`;
		const beforeMention = textContent.substring(0, mentionStartIndex);
		const afterCursor = textContent.substring(cursorPosition);
		const newText =
			beforeMention +
			MENTION_PREFIX +
			fullFileName +
			SPACE_AFTER_MENTION +
			afterCursor;

		// Update content state
		textContent = newText;
		textTokens = parseTextToTokens(textContent);

		hideDropdown();

		// Update display and cursor position
		if (contentElement) {
			updateContentDisplay();
			tick().then(() => {
				const newCursorPosition =
					beforeMention.length + fullFileName.length + 2; // +2 for @ and space
				setCursorPosition(newCursorPosition);
			});
		}
	}

	function checkForCommandTrigger() {
		const beforeCursor = textContent.substring(0, cursorPosition);
		const commandIndex = beforeCursor.lastIndexOf(COMMAND_PREFIX);

		if (commandIndex === -1) {
			// No command trigger near cursor: ensure all command-related dropdowns are closed
			if (activeDropdown !== "file") {
				hideDropdown();
			}
			return;
		}

		// Ensure / is at start or preceded by whitespace
		const characterBeforeCommand =
			commandIndex > 0 ? beforeCursor[commandIndex - 1] : " ";
		if (
			commandIndex > 0 &&
			!isCharacterWhitespace(characterBeforeCommand)
		) {
			// '/' is part of a word, not a command: close dropdowns
			if (activeDropdown !== "file") {
				hideDropdown();
			}
			return;
		}

		const textAfterCommand = beforeCursor.substring(commandIndex + 1);
		const firstTokenMatch = textAfterCommand.match(/([^\s\/]+)/);
		const typedName = firstTokenMatch ? firstTokenMatch[1] : "";
		const commandName = typedName.toLowerCase();

		commandStartIndex = commandIndex;

		const dropdownController =
			dropdownControllers[
				commandName as keyof typeof dropdownControllers
			];

		if (dropdownController) {
			if (activeDropdown !== dropdownController.kind) {
				void dropdownController.show();
			} else {
				dropdownController.refresh();
			}
			return;
		}

		// Otherwise, no exact command match: close provider/model dropdowns
		if (
			["provider", "model", "creativity", "system"].includes(
				activeDropdown,
			)
		) {
			hideDropdown();
		}

		// Show command picker for partial commands (including bare '/')
		filteredItems = filterAvailableCommands(textAfterCommand);
		if (filteredItems.length > 0) {
			activeDropdown = "command";
			selectedIndex = 0;
		} else {
			hideDropdown();
		}
	}

	function insertCommandAtCursor(command: CommandReference) {
		if (commandStartIndex === -1) return;

		const dropdownController =
			dropdownControllers[
				command.name as keyof typeof dropdownControllers
			];
		if (dropdownController) {
			insertCommand(command.name);
			void dropdownController.show();
			return;
		}

		// For other commands (if any), insert and then remove the command token
		insertCommand(command.name);
		const commandLength =
			COMMAND_PREFIX.length +
			command.name.length +
			SPACE_AFTER_COMMAND.length;
		removeCommandFromText(commandStartIndex, commandLength);
	}

	function insertCommand(commandName: string) {
		if (commandStartIndex === -1) return;

		const beforeCommand = textContent.substring(0, commandStartIndex);
		const afterCursor = textContent.substring(cursorPosition);

		const newText =
			beforeCommand +
			COMMAND_PREFIX +
			commandName +
			SPACE_AFTER_COMMAND +
			afterCursor;

		textContent = newText;
		textTokens = parseTextToTokens(textContent);
		hideDropdown();

		if (contentElement) {
			updateContentDisplay();
			tick().then(() => {
				const newCursorPosition =
					beforeCommand.length + commandName.length + 2; // +2 for / and space
				setCursorPosition(newCursorPosition);
			});
		}
	}

	const selectionHandlers: Record<DropdownKind, SelectionHandler> = {
		none: () => undefined,
		file: (item) => insertFileAtCursor(item as FileReference),
		command: (item) => insertCommandAtCursor(item as CommandReference),
		provider: (item) => selectProvider(item as ProviderReference),
		model: (item) => selectModel(item as ModelReference),
		creativity: (item) => selectCreativity(item as CreativityReference),
		system: (item) => selectSystemPrompt(item as SystemPromptReference),
	};

	function handleSelection(item: DropdownItem) {
		void selectionHandlers[activeDropdown]?.(item);
	}

	async function selectProvider(provider: ProviderReference) {
		try {
			if (onProviderChange) {
				await onProviderChange(provider.id);
			}

			// Update provider label (shows provider and model) and highlight it
			setProviderBadgeLabel(provider.providerName, provider.name);
			providerId = provider.id;
			providerName = provider.providerName;
			highlightBadgeTemporarily();

			// Remove the /provider command and any typed query after it (mouse or keyboard)
			removeCommandAndQuery("provider");

			// Hide dropdown
			hideDropdown();
		} catch (error) {
			console.error("Error selecting provider:", error);
			hideDropdown();
		}
	}

	async function selectModel(model: ModelReference) {
		try {
			if (onModelChange) {
				await onModelChange(model.name);
			}

			setProviderBadgeLabel(providerName, model.name);
			highlightBadgeTemporarily();

			removeCommandAndQuery("model");
			hideDropdown();
		} catch (error) {
			console.error("Error selecting model:", error);
			hideDropdown();
		}
	}

	function applyCreativityFilter() {
		if (!allCreativities || allCreativities.length === 0) return;
		const q = getCommandQuery("creativity");
		const matches = allCreativities
			.filter((c) => fuzzyMatch(c.name, q))
			.slice(0, MAX_DROPDOWN_RESULTS);
		updateFilteredDropdownItems(matches);
		if (q) {
			// Try to auto-select when exact match ignoring case and emojis
			const norm = (s: string) => s.toLowerCase();
			const exact = matches.find((c) => norm(c.name) === norm(q));
			if (exact) {
				void selectCreativity(exact);
			}
		}
	}

	async function showCreativityDropdown() {
		try {
			allCreativities = getCreativityOptions();
			applyCreativityFilter();
			if (filteredItems.length > 0) {
				activeDropdown = "creativity";
				selectedIndex = 0;
			}
		} catch (error) {
			console.error("Error showing creativity dropdown:", error);
		}
	}

	async function selectCreativity(option: CreativityReference) {
		try {
			if (onCreativityChange) {
				await onCreativityChange(option.id);
			}
			creativityBadge = option.name;
			setProviderBadgeLabel(providerName, modelName);
			highlightBadgeTemporarily();
			removeCommandAndQuery("creativity");
			hideDropdown();
		} catch (error) {
			console.error("Error selecting creativity:", error);
			hideDropdown();
		}
	}

	function applySystemFilter() {
		if (!allSystemPrompts || allSystemPrompts.length === 0) return;
		const q = getCommandQuery("system");
		const normalizedQuery = q.toLowerCase();
		const matches = allSystemPrompts
			.filter((s) =>
				normalizedQuery
					? s.name.toLowerCase().includes(normalizedQuery)
					: true,
			)
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, MAX_DROPDOWN_RESULTS);
		updateFilteredDropdownItems(matches);
		if (q) {
			const norm = (s: string) => s.toLowerCase();
			const exact = matches.find((s) => norm(s.name) === norm(q));
			if (exact) {
				void selectSystemPrompt(exact);
			}
		}
	}

	async function showSystemDropdown() {
		if (!getSystemPrompts) return;
		try {
			allSystemPrompts = getSystemPrompts();
			applySystemFilter();
			if (filteredItems.length > 0) {
				activeDropdown = "system";
				selectedIndex = 0;
			}
		} catch (error) {
			console.error("Error showing system dropdown:", error);
		}
	}

	async function selectSystemPrompt(option: SystemPromptReference) {
		try {
			selectedSystemPromptValue = option.system;
			systemPromptBadge = option.name;
			setProviderBadgeLabel(providerName, modelName);
			highlightBadgeTemporarily();
			removeCommandAndQuery("system");
			hideDropdown();
		} catch (error) {
			console.error("Error selecting system prompt:", error);
			hideDropdown();
		}
	}

	function formatSystemPreview(text: string) {
		const singleLine = text.replace(/\r?\n/g, " ");
		if (singleLine.length <= SYSTEM_PREVIEW_LENGTH) return singleLine;
		return `${singleLine.slice(0, SYSTEM_PREVIEW_LENGTH - 1)}…`;
	}

	function fuzzyMatch(target: string, query: string): boolean {
		if (!query) return true;
		let ti = 0;
		const t = target.toLowerCase();
		for (const qc of query) {
			ti = t.indexOf(qc, ti);
			if (ti === -1) return false;
			ti++;
		}
		return true;
	}

	function applyProviderFilter() {
		if (!allProviders || allProviders.length === 0) return;
		const q = getCommandQuery("provider");
		const matches = allProviders
			.filter(
				(p) => fuzzyMatch(p.name, q) || fuzzyMatch(p.providerName, q),
			)
			.slice(0, MAX_DROPDOWN_RESULTS);
		updateFilteredDropdownItems(matches);
		// Auto-select when there is a single exact name match (paste convenience)
		if (
			q &&
			matches.length === 1 &&
			matches[0].name.toLowerCase() === q
		) {
			void selectProvider(matches[0]);
		}
	}

	function removeCommandAndQuery(commandName: string) {
		const token = `${COMMAND_PREFIX}${commandName}`;
		const foundIndex = textContent.lastIndexOf(token);
		if (foundIndex === -1) return;
		const charBefore = foundIndex > 0 ? textContent[foundIndex - 1] : " ";
		if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return;

		let removalStart = foundIndex;
		let idx = foundIndex + token.length;
		if (textContent[idx] === SPACE_AFTER_COMMAND) {
			idx += SPACE_AFTER_COMMAND.length;
		}
		while (idx < textContent.length) {
			const ch = textContent[idx];
			if (isCharacterWhitespace(ch) || ch === "/" || ch === "@") break;
			idx++;
		}
		const removalEnd = idx;
		const before = textContent.substring(0, removalStart);
		const after = textContent.substring(removalEnd);
		textContent = before + after;
		textTokens = parseTextToTokens(textContent);
		if (contentElement) {
			updateContentDisplay();
			tick().then(() => {
				setCursorPosition(before.length);
			});
		}
	}

	async function showProviderDropdown() {
		if (!getProviders) return;

		try {
			const providers = await fetchAvailableProviders();
			allProviders = providers;
			applyProviderFilter();

			if (filteredItems.length > 0) {
				activeDropdown = "provider";
				selectedIndex = 0;
			} else {
				// No providers available
				console.warn("No providers available");
			}
		} catch (error) {
			console.error("Error showing provider dropdown:", error);
		}
	}

	function applyModelFilter() {
		if (!allModels || allModels.length === 0) return;
		const q = getCommandQuery("model");
		const matches = allModels
			.filter((m) => fuzzyMatch(m.name, q))
			.slice(0, MAX_DROPDOWN_RESULTS);
		updateFilteredDropdownItems(matches);
		if (
			q &&
			matches.length === 1 &&
			matches[0].name.toLowerCase() === q
		) {
			void selectModel(matches[0]);
		}
	}

	async function showModelDropdown() {
		if (!getModels || !providerId) return;

		try {
			const models = await fetchAvailableModels();
			allModels = models;
			applyModelFilter();

			if (filteredItems.length > 0) {
				activeDropdown = "model";
				selectedIndex = 0;
			} else {
				console.warn("No models available");
			}
		} catch (error) {
			console.error("Error showing model dropdown:", error);
		}
	}

	function handleContentClick(event: MouseEvent) {
		const target = event.target as HTMLElement;

		// Handle clicks on file mentions to remove them
		if (target.classList.contains("file-mention")) {
			const filePath = target.dataset.path;
			if (filePath) {
				removeFileReference(filePath);
			}
		}
	}

	function createFileRemovalPattern(file: FileReference) {
		const fullFileName = `${file.basename}.${file.extension}`;
		const escapedFileName = fullFileName.replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&",
		);
		return new RegExp(`${MENTION_PREFIX}${escapedFileName}\\s?`, "g");
	}

	function removeCommandFromText(
		commandStartIndex: number,
		commandLength: number,
	) {
		if (commandStartIndex === -1) return;

		const beforeCommand = textContent.substring(0, commandStartIndex);
		const afterCommand = textContent.substring(
			commandStartIndex + commandLength,
		);

		// Update content state
		textContent = beforeCommand + afterCommand;
		textTokens = parseTextToTokens(textContent);

		// Update display and cursor position
		if (contentElement) {
			updateContentDisplay();
			tick().then(() => {
				setCursorPosition(beforeCommand.length);
			});
		}
	}

	function removeFileReference(filePath: string) {
		selectedFiles = selectedFiles.filter((path) => path !== filePath);

		// Remove the @filename.extension mention from text content
		const file = getFiles?.()?.find((f) => f.path === filePath);
		if (file) {
			const removalPattern = createFileRemovalPattern(file);
			textContent = textContent.replace(removalPattern, "");
			textTokens = parseTextToTokens(textContent);
			updateContentDisplay();
		}
	}

	function submitAction() {
		addToPromptHistory(textContent);
		historyIndex = getPromptHistoryLength();
		draftBeforeHistory = textContent;
		dispatch("submit", {
			text: textContent,
			selectedFiles,
			systemPrompt: selectedSystemPromptValue,
		});
	}

	// Handle backspace/delete to clean up broken file mentions
	function handleKeyup(event: KeyboardEvent) {
		if (event.key === "Backspace" || event.key === "Delete") {
			// Extract currently mentioned files from tokens
			const currentlyMentionedFiles = textTokens
				.filter((token) => token.type === "file" && token.filePath)
				.map((token) => token.filePath!);

			// Remove any selected files that are no longer mentioned
			const filesToRemove = selectedFiles.filter(
				(filePath) => !currentlyMentionedFiles.includes(filePath),
			);

			if (filesToRemove.length > 0) {
				selectedFiles = selectedFiles.filter((path) =>
					currentlyMentionedFiles.includes(path),
				);
			}
		}
	}
</script>

<div class="local-gpt-action-palette-shell">
	<div
		bind:this={contentElement}
		class="local-gpt-action-palette"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-label={placeholder}
		on:keydown={handleKeydown}
		on:input={handleInput}
		on:keyup={handleKeyup}
		on:click={handleContentClick}
		data-placeholder={placeholder}
		spellcheck="false"
	></div>
	{#if activeDropdown !== "none" && filteredItems.length > 0}
		<div
			bind:this={dropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'file' ? 'block' : 'none'}"
		>
			{#each fileItems as item, index}
				{#if activeDropdown === "file"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<span class="local-gpt-file-name"
							>{item.basename}.{item.extension}</span
						>
						<span class="local-gpt-file-path">{item.path}</span>
					</div>
				{/if}
			{/each}
		</div>

		<div
			bind:this={commandDropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'command' ? 'block' : 'none'}"
		>
			{#each commandItems as item, index}
				{#if activeDropdown === "command"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<span class="local-gpt-command-name">/{item.name}</span>
						<span class="local-gpt-command-description"
							>{item.description}</span
						>
					</div>
				{/if}
			{/each}
		</div>

		<div
			bind:this={providerDropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'provider' ? 'block' : 'none'}"
		>
			{#each providerItems as item, index}
				{#if activeDropdown === "provider"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<div class="local-gpt-provider-header">
							<span class="local-gpt-provider-name"
								>{item.providerName}</span
							>
							{#if item.providerUrl}
								<span class="local-gpt-provider-url"
									>{item.providerUrl}</span
								>
							{/if}
						</div>
						<span class="local-gpt-provider-model">{item.name}</span
						>
					</div>
				{/if}
			{/each}
		</div>

		<div
			bind:this={modelDropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'model' ? 'block' : 'none'}"
		>
			{#each modelItems as item, index}
				{#if activeDropdown === "model"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<span class="local-gpt-model-name">{item.name}</span>
					</div>
				{/if}
			{/each}
		</div>

		<div
			bind:this={creativityDropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'creativity'
				? 'block'
				: 'none'}"
		>
			{#each creativityItems as item, index}
				{#if activeDropdown === "creativity"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<span class="local-gpt-creativity-name"
							>{item.name}</span
						>
					</div>
				{/if}
			{/each}
		</div>

		<div
			bind:this={systemDropdownElement}
			class="local-gpt-dropdown"
			style="display: {activeDropdown === 'system' ? 'block' : 'none'}"
		>
			{#each systemItems as item, index}
				{#if activeDropdown === "system"}
					<div
						class="local-gpt-dropdown-item {index === selectedIndex
							? 'local-gpt-selected'
							: ''}"
						role="option"
						tabindex="0"
						aria-selected={index === selectedIndex}
						on:click={() => handleSelection(item)}
						on:keydown={(event) =>
							event.key === "Enter" && handleSelection(item)}
					>
						<span class="local-gpt-system-name">{item.name}</span>
						<span class="local-gpt-system-detail"
							>{formatSystemPreview(item.system)}</span
						>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	{#if providerLabel}
		<div class="local-gpt-provider-badge" aria-hidden="true">
			<div
				class={badgeHighlight
					? "local-gpt-provider-badge-label local-gpt-badge-highlight"
					: "local-gpt-provider-badge-label"}
			>
				{providerLabel}
			</div>
		</div>
	{/if}
</div>
