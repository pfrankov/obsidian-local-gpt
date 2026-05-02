import type { FileReference } from "../interfaces";
import { COMMAND_PREFIX, MENTION_PREFIX } from "./actionPaletteTypes";
import {
	isCharacterWhitespace,
	isCompleteMention as isCompleteMentionText,
} from "./actionPaletteText";
import {
	filterAvailableCommands,
	filterAvailableFiles,
} from "./actionPaletteOptions";
import type { ActionPaletteControllerOptions } from "./actionPaletteController";
import type { ActionPaletteState } from "./actionPaletteState";

interface TriggerContext {
	state: ActionPaletteState;
	options: ActionPaletteControllerOptions;
	getFiles(): FileReference[];
	hideDropdown(): void;
	activateCommandDropdown(commandName: string): boolean;
}

export function checkForMentionTrigger(context: TriggerContext) {
	if (!context.options.getFiles()) return;

	const beforeCursor = context.state.textContent.substring(
		0,
		context.state.cursorPosition,
	);
	const mentionIndex = beforeCursor.lastIndexOf(MENTION_PREFIX);
	if (mentionIndex === -1) {
		context.hideDropdown();
		return;
	}

	const characterBeforeMention =
		mentionIndex > 0 ? beforeCursor[mentionIndex - 1] : " ";
	if (mentionIndex > 0 && !isCharacterWhitespace(characterBeforeMention)) {
		context.hideDropdown();
		return;
	}

	const textAfterMention = beforeCursor.substring(mentionIndex + 1);
	const possibleMention = MENTION_PREFIX + textAfterMention;
	if (
		isCompleteMentionText(
			possibleMention,
			context.getFiles(),
			context.state.selectedFiles,
		)
	) {
		context.hideDropdown();
		return;
	}

	context.state.mentionStartIndex = mentionIndex;
	context.state.filteredItems = filterAvailableFiles(
		textAfterMention,
		context.getFiles(),
		context.state.selectedFiles,
	);
	showDropdownItems(context, "file");
}

export function checkForCommandTrigger(context: TriggerContext) {
	const commandContext = getCommandContext(context);
	if (!commandContext) {
		if (context.state.activeDropdown !== "file") context.hideDropdown();
		return;
	}

	context.state.commandStartIndex = commandContext.commandIndex;
	if (context.activateCommandDropdown(commandContext.commandName)) {
		return;
	}

	if (
		["provider", "model", "creativity", "system"].includes(
			context.state.activeDropdown,
		)
	) {
		context.hideDropdown();
	}

	context.state.filteredItems = filterAvailableCommands(
		commandContext.textAfterCommand,
	);
	showDropdownItems(context, "command");
}

function getCommandContext(context: TriggerContext) {
	const beforeCursor = context.state.textContent.substring(
		0,
		context.state.cursorPosition,
	);
	const commandIndex = beforeCursor.lastIndexOf(COMMAND_PREFIX);
	if (commandIndex === -1) return null;

	const characterBeforeCommand =
		commandIndex > 0 ? beforeCursor[commandIndex - 1] : " ";
	if (commandIndex > 0 && !isCharacterWhitespace(characterBeforeCommand)) {
		return null;
	}

	const textAfterCommand = beforeCursor.substring(commandIndex + 1);
	const firstTokenMatch = textAfterCommand.match(/([^\s/]+)/);
	const commandName = (
		firstTokenMatch ? firstTokenMatch[1] : ""
	).toLowerCase();
	return { commandIndex, commandName, textAfterCommand };
}

function showDropdownItems(context: TriggerContext, kind: "file" | "command") {
	if (context.state.filteredItems.length > 0) {
		context.state.activeDropdown = kind;
		context.state.selectedIndex = 0;
		return;
	}
	context.hideDropdown();
}
