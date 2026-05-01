import type { CommandReference, FileReference, TextToken } from "../interfaces";
import {
	COMMAND_PREFIX,
	COMMAND_REGEX,
	FILE_MENTION_REGEX,
	MENTION_PREFIX,
	SPACE_AFTER_COMMAND,
} from "./actionPaletteTypes";

export function getFullFileName(file: FileReference) {
	return `${file.basename}.${file.extension}`;
}

export function findMatchingFile(
	fileName: string,
	availableFiles: FileReference[],
	selectedFiles: string[],
): FileReference | undefined {
	const normalizedFileName = fileName.toLowerCase();
	const matchingFiles = availableFiles.filter(
		(file) => getFullFileName(file).toLowerCase() === normalizedFileName,
	);
	return (
		matchingFiles.find((file) => selectedFiles.includes(file.path)) ||
		matchingFiles[0]
	);
}

export function getFileMention(file: FileReference) {
	return `${MENTION_PREFIX}${getFullFileName(file)}`;
}

export function extractMentionsFromText(
	text: string,
	availableFiles: FileReference[],
	selectedFiles: string[],
) {
	const mentions: string[] = [];
	const newSelectedFiles: string[] = [];
	const mentionMatches = Array.from(text.matchAll(FILE_MENTION_REGEX));

	for (const match of mentionMatches) {
		const fileName = (match[1] || "").trim();
		const matchedFile = findMatchingFile(
			fileName,
			availableFiles,
			selectedFiles,
		);

		if (matchedFile && !selectedFiles.includes(matchedFile.path)) {
			newSelectedFiles.push(matchedFile.path);
		}

		mentions.push(match[0]);
	}

	return { mentions, newSelectedFiles };
}

export function parseTextToTokens(
	text: string,
	availableFiles: FileReference[],
	selectedFiles: string[],
	availableCommands: CommandReference[],
) {
	const tokens: TextToken[] = [];
	const { newSelectedFiles } = extractMentionsFromText(
		text,
		availableFiles,
		selectedFiles,
	);
	const nextSelectedFiles =
		newSelectedFiles.length > 0
			? [...selectedFiles, ...newSelectedFiles]
			: selectedFiles;

	const mentionMatches = availableFiles.length
		? (Array.from(text.matchAll(FILE_MENTION_REGEX)) as RegExpMatchArray[])
		: [];
	const commandMatches = Array.from(
		text.matchAll(COMMAND_REGEX),
	) as RegExpMatchArray[];
	const allMatches = [
		...mentionMatches.map((match) => ({ type: "file", match })),
		...commandMatches.map((match) => ({ type: "command", match })),
	].sort((a, b) => (a.match.index ?? 0) - (b.match.index ?? 0));

	let lastIndex = 0;

	for (const { type, match } of allMatches) {
		const matchStart = match.index ?? 0;
		const matchEnd = matchStart + match[0].length;
		addTextToken(tokens, text, lastIndex, matchStart);

		if (type === "file") {
			addFileToken(
				tokens,
				match,
				matchStart,
				matchEnd,
				availableFiles,
				nextSelectedFiles,
			);
		} else if (type === "command") {
			addCommandToken(
				tokens,
				match,
				matchStart,
				matchEnd,
				availableCommands,
			);
		}

		lastIndex = matchEnd;
	}

	addTextToken(tokens, text, lastIndex, text.length);

	return { tokens, selectedFiles: nextSelectedFiles };
}

function addTextToken(
	tokens: TextToken[],
	text: string,
	start: number,
	end: number,
) {
	if (start >= end) {
		return;
	}
	tokens.push({
		type: "text",
		content: text.substring(start, end),
		start,
		end,
	});
}

function addFileToken(
	tokens: TextToken[],
	match: RegExpMatchArray,
	matchStart: number,
	matchEnd: number,
	availableFiles: FileReference[],
	selectedFiles: string[],
) {
	const fileName = (match[1] || "").trim();
	const matchedFile = findMatchingFile(
		fileName,
		availableFiles,
		selectedFiles,
	);

	if (matchedFile) {
		tokens.push({
			type: "file",
			content: match[0],
			start: matchStart,
			end: matchEnd,
			filePath: matchedFile.path,
		});
		return;
	}

	tokens.push({
		type: "text",
		content: match[0],
		start: matchStart,
		end: matchEnd,
	});
}

function addCommandToken(
	tokens: TextToken[],
	match: RegExpMatchArray,
	matchStart: number,
	matchEnd: number,
	availableCommands: CommandReference[],
) {
	const commandName = (match[1] || "").trim();
	const matchedCommand = availableCommands.find(
		(cmd) => cmd.name === commandName,
	);

	if (matchedCommand) {
		tokens.push({
			type: "command",
			content: match[0],
			start: matchStart,
			end: matchEnd,
			commandName: matchedCommand.name,
		});
		return;
	}

	tokens.push({
		type: "text",
		content: match[0],
		start: matchStart,
		end: matchEnd,
	});
}

export function escapeHtmlContent(text: string) {
	const temporaryElement = document.createElement("div");
	temporaryElement.textContent = text;
	return temporaryElement.innerHTML;
}

export function renderTokensAsHtml(tokens: TextToken[]) {
	return tokens
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

export function isCharacterWhitespace(character: string) {
	return /\s/.test(character);
}

export function isCompleteMention(
	mentionText: string,
	availableFiles: FileReference[],
	selectedFiles: string[],
) {
	return selectedFiles.some((filePath) => {
		const file = availableFiles.find((f) => f.path === filePath);
		if (!file) return false;

		const fullFileName = getFullFileName(file);
		return mentionText === `${MENTION_PREFIX}${fullFileName}`;
	});
}

export function isCompleteCommand(
	commandText: string,
	availableCommands: CommandReference[],
) {
	return availableCommands.some(
		(cmd) => commandText === `${COMMAND_PREFIX}${cmd.name}`,
	);
}

export function getCommandQuery(
	commandName: string,
	textContent: string,
	cursorPosition: number,
): string {
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
	return textContent
		.substring(queryStart, cursorPosition)
		.trim()
		.toLowerCase();
}

export function createFileRemovalPattern(file: FileReference) {
	const fullFileName = getFullFileName(file);
	const escapedFileName = fullFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${MENTION_PREFIX}${escapedFileName}\\s?`, "g");
}
