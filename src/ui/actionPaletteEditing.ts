import { tick } from "svelte";
import type { CommandReference, FileReference, TextToken } from "../interfaces";
import {
	COMMAND_PREFIX,
	MENTION_PREFIX,
	SPACE_AFTER_COMMAND,
	SPACE_AFTER_MENTION,
} from "./actionPaletteTypes";
import {
	createFileRemovalPattern,
	getFileMention,
	getFullFileName,
	isCharacterWhitespace,
	renderTokensAsHtml as renderTokenHtml,
} from "./actionPaletteText";
import {
	getCurrentCursorPosition,
	setCursorPosition,
} from "./actionPaletteDom";
import type { ActionPaletteControllerOptions } from "./actionPaletteController";
import type { ActionPaletteState } from "./actionPaletteState";

interface EditingContext {
	state: ActionPaletteState;
	options: ActionPaletteControllerOptions;
	getFiles(): FileReference[];
	parseTextToTokens(text: string): TextToken[];
	hideDropdown(): void;
	updateContentDisplay(): void;
	commit(): void;
}

interface CommandEditingContext extends EditingContext {
	activateCommandDropdown(commandName: string): boolean;
}

export function applyInitialSelectedFiles(context: EditingContext) {
	if (
		!context.options.getFiles() ||
		context.options.getInitialSelectedFiles().length === 0
	) {
		return;
	}

	const availableFiles = context.getFiles();
	const filesToAdd = context.options
		.getInitialSelectedFiles()
		.map((filePath) =>
			availableFiles.find((file) => file.path === filePath),
		)
		.filter((file): file is FileReference => Boolean(file))
		.filter((file) => !context.state.selectedFiles.includes(file.path));

	if (filesToAdd.length === 0) return;

	context.state.selectedFiles = [
		...context.state.selectedFiles,
		...filesToAdd.map((file) => file.path),
	];

	const mentionsToInsert = filesToAdd
		.map(getFileMention)
		.filter((mention) => !context.state.textContent.includes(mention));
	if (mentionsToInsert.length === 0) return;

	const prefix = `${mentionsToInsert.join(SPACE_AFTER_MENTION)}${SPACE_AFTER_MENTION}`;
	context.state.textContent = context.state.textContent
		? `${prefix}${context.state.textContent}`
		: prefix;
}

export function applyHistoryEntry(context: EditingContext, text: string) {
	context.state.textContent = text;
	context.state.cursorPosition = context.state.textContent.length;
	context.state.selectedFiles = [];
	context.state.textTokens = context.parseTextToTokens(
		context.state.textContent,
	);
	context.hideDropdown();
	context.updateContentDisplay();
	void tick().then(() => {
		setCursorPosition(
			context.options.getContentElement(),
			context.state.textContent.length,
		);
	});
	context.commit();
}

export function insertFileAtCursor(
	context: EditingContext,
	file: FileReference,
) {
	if (context.state.mentionStartIndex === -1) return;
	if (!context.state.selectedFiles.includes(file.path)) {
		context.state.selectedFiles = [
			...context.state.selectedFiles,
			file.path,
		];
	}

	const fullFileName = getFullFileName(file);
	const beforeMention = context.state.textContent.substring(
		0,
		context.state.mentionStartIndex,
	);
	const afterCursor = context.state.textContent.substring(
		context.state.cursorPosition,
	);
	context.state.textContent =
		beforeMention +
		MENTION_PREFIX +
		fullFileName +
		SPACE_AFTER_MENTION +
		afterCursor;
	context.state.textTokens = context.parseTextToTokens(
		context.state.textContent,
	);
	context.hideDropdown();
	context.updateContentDisplay();
	void tick().then(() => {
		const newCursorPosition =
			beforeMention.length + fullFileName.length + 2;
		setCursorPosition(
			context.options.getContentElement(),
			newCursorPosition,
		);
	});
}

export function insertCommandAtCursor(
	context: CommandEditingContext,
	command: CommandReference,
) {
	if (context.state.commandStartIndex === -1) return;

	const originalCommandStartIndex = context.state.commandStartIndex;
	insertCommand(context, command.name);
	if (context.activateCommandDropdown(command.name)) {
		return;
	}

	const commandLength =
		COMMAND_PREFIX.length +
		command.name.length +
		SPACE_AFTER_COMMAND.length;
	removeCommandFromText(context, originalCommandStartIndex, commandLength);
}

export function removeCommandAndQuery(
	context: EditingContext,
	commandName: string,
) {
	const token = `${COMMAND_PREFIX}${commandName}`;
	const foundIndex = context.state.textContent.lastIndexOf(token);
	if (foundIndex === -1) return;
	const charBefore =
		foundIndex > 0 ? context.state.textContent[foundIndex - 1] : " ";
	if (foundIndex > 0 && !isCharacterWhitespace(charBefore)) return;

	const removalStart = foundIndex;
	let idx = foundIndex + token.length;
	if (context.state.textContent[idx] === SPACE_AFTER_COMMAND) {
		idx += SPACE_AFTER_COMMAND.length;
	}
	while (idx < context.state.textContent.length) {
		const ch = context.state.textContent[idx];
		if (isCharacterWhitespace(ch) || ch === "/" || ch === "@") break;
		idx++;
	}
	const before = context.state.textContent.substring(0, removalStart);
	const after = context.state.textContent.substring(idx);
	context.state.textContent = before + after;
	context.state.textTokens = context.parseTextToTokens(
		context.state.textContent,
	);
	context.updateContentDisplay();
	void tick().then(() => {
		setCursorPosition(context.options.getContentElement(), before.length);
	});
}

export function removeFileReference(context: EditingContext, filePath: string) {
	context.state.selectedFiles = context.state.selectedFiles.filter(
		(path) => path !== filePath,
	);

	const file = context.getFiles().find((item) => item.path === filePath);
	if (file) {
		const removalPattern = createFileRemovalPattern(file);
		context.state.textContent = context.state.textContent.replace(
			removalPattern,
			"",
		);
		context.state.textTokens = context.parseTextToTokens(
			context.state.textContent,
		);
		context.updateContentDisplay();
	}
}

export function updateContentDisplay(context: EditingContext) {
	const contentElement = context.options.getContentElement();
	if (!contentElement) return;

	const currentCursor = getCurrentCursorPosition(contentElement);
	contentElement.innerHTML = renderTokenHtml(context.state.textTokens);
	void tick().then(() => {
		setCursorPosition(contentElement, currentCursor);
	});
}

function insertCommand(context: CommandEditingContext, commandName: string) {
	if (context.state.commandStartIndex === -1) return;

	const beforeCommand = context.state.textContent.substring(
		0,
		context.state.commandStartIndex,
	);
	const afterCursor = context.state.textContent.substring(
		context.state.cursorPosition,
	);
	context.state.textContent =
		beforeCommand +
		COMMAND_PREFIX +
		commandName +
		SPACE_AFTER_COMMAND +
		afterCursor;
	context.state.textTokens = context.parseTextToTokens(
		context.state.textContent,
	);
	context.hideDropdown();
	context.updateContentDisplay();
	void tick().then(() => {
		const newCursorPosition = beforeCommand.length + commandName.length + 2;
		setCursorPosition(
			context.options.getContentElement(),
			newCursorPosition,
		);
	});
}

function removeCommandFromText(
	context: EditingContext,
	commandStartIndex: number,
	commandLength: number,
) {
	if (commandStartIndex === -1) return;

	const beforeCommand = context.state.textContent.substring(
		0,
		commandStartIndex,
	);
	const afterCommand = context.state.textContent.substring(
		commandStartIndex + commandLength,
	);
	context.state.textContent = beforeCommand + afterCommand;
	context.state.textTokens = context.parseTextToTokens(
		context.state.textContent,
	);
	context.updateContentDisplay();
	void tick().then(() => {
		setCursorPosition(
			context.options.getContentElement(),
			beforeCommand.length,
		);
	});
}
