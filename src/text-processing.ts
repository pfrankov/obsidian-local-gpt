import { logger } from "./logger";

const MAX_CHUNK_SIZE = 1000;

export function preprocessContent(content: string): string {
	logger.debug("Preprocessing content", { contentLength: content.length });
	return (
		content
			// Remove frontmatter (content between --- delimiters at the start of the file)
			.replace(/^---\n[\s\S]*?\n---\n/, "")
			// Remove code blocks (content between ``` delimiters)
			.replace(/```[\s\S]*?```/g, "")
			// Remove empty headers (lines with only # characters followed by whitespace)
			.replace(/^(#+)\s*$\n/gm, "")
			// Remove headers that are not followed by content
			.replace(/^(#+)\s*(?!$)[^\n]+\n(?=\s*(?:\1#|\s*$)(?!\s*\S))/gm, "")
			// Replace three or more consecutive newlines with two newlines
			.replace(/\n{3,}/g, "\n\n")
	);
}

export function splitContent(content: string): string[] {
	if (content.length < MAX_CHUNK_SIZE) {
		return [content];
	}

	logger.debug("Splitting content", { contentLength: content.length });
	const sections = content
		.split(/^---$/m)
		.flatMap((section) => splitByHeaders(section.trim()));
	return sections
		.flatMap((section) => splitSectionWithLists(section))
		.filter((chunk) => chunk.length > 0);
}

function splitByHeaders(text: string): string[] {
	const headerRegex = /^(#{1,6})\s+(.+)$/gm;
	const sections: string[] = [];
	let lastIndex = 0;
	let lastHeader = "";
	let match;

	while ((match = headerRegex.exec(text)) !== null) {
		if (lastIndex < match.index) {
			sections.push(
				lastHeader + text.slice(lastIndex, match.index).trim(),
			);
		}
		lastHeader = match[0] + "\n";
		lastIndex = headerRegex.lastIndex;
	}

	if (lastIndex < text.length) {
		sections.push(lastHeader + text.slice(lastIndex).trim());
	}

	return sections.filter((section) => section.length > 0);
}

function splitSectionWithLists(section: string): string[] {
	const lines = section.split("\n");
	const result = lines.reduce(processLine, {
		chunks: [],
		currentChunk: "",
		inList: false,
		lastNonListText: "",
	});

	return result.currentChunk
		? [...result.chunks, result.currentChunk.trim()]
		: result.chunks;
}

interface ProcessState {
	// Array of processed text chunks ready for further processing
	chunks: string[];

	// The current chunk being built
	currentChunk: string;

	// Flag indicating whether we're currently processing a list item
	inList: boolean;

	// Stores the last processed non-list text to maintain context
	lastNonListText: string;
}

function processLine(state: ProcessState, line: string): ProcessState {
	const isListItem = /^(\s*[-*+]|\s*\d+\.)/.test(line);
	const isHeader = /^(#{1,6}\s|[*_]{2}).+/.test(line);

	if (isHeader) {
		return handleHeader(state, line);
	}

	if (isListItem) {
		return handleListItem(state, line);
	}

	if (state.inList && !line.trim()) {
		return { ...state, currentChunk: state.currentChunk + "\n" + line };
	}

	return handleRegularLine(state, line);
}

function handleHeader(state: ProcessState, line: string): ProcessState {
	const { chunks, currentChunk } = state;
	return {
		chunks: currentChunk ? [...chunks, currentChunk.trim()] : chunks,
		currentChunk: line,
		inList: false,
		lastNonListText: line,
	};
}

function handleListItem(state: ProcessState, line: string): ProcessState {
	const { chunks, currentChunk, inList, lastNonListText } = state;

	if (!inList && currentChunk.length + line.length <= MAX_CHUNK_SIZE) {
		return {
			...state,
			currentChunk: currentChunk + "\n" + line,
			inList: true,
		};
	}

	if (!inList) {
		return {
			chunks: currentChunk ? [...chunks, currentChunk.trim()] : chunks,
			currentChunk: lastNonListText + "\n" + line,
			inList: true,
			lastNonListText,
		};
	}

	return { ...state, currentChunk: currentChunk + "\n" + line };
}

function handleRegularLine(state: ProcessState, line: string): ProcessState {
	const { chunks, currentChunk, lastNonListText } = state;

	if (line.length > MAX_CHUNK_SIZE) {
		let remainingLine = line;
		const newChunks = [...chunks];

		if (currentChunk) {
			newChunks.push(currentChunk.trim());
		}

		while (remainingLine.length > 0) {
			const chunkEnd = findChunkEnd(remainingLine, MAX_CHUNK_SIZE);
			newChunks.push(remainingLine.slice(0, chunkEnd).trim());
			remainingLine = remainingLine.slice(chunkEnd).trim();
		}

		return {
			chunks: newChunks,
			currentChunk: "",
			inList: false,
			lastNonListText: line,
		};
	}

	const newChunk = currentChunk + (currentChunk ? "\n" : "") + line;
	if (newChunk.length > MAX_CHUNK_SIZE) {
		return {
			chunks: [...chunks, currentChunk.trim()],
			currentChunk: line,
			inList: false,
			lastNonListText: line.trim() ? line : lastNonListText,
		};
	}

	return {
		...state,
		currentChunk: newChunk,
		inList: false,
		lastNonListText: line.trim() ? line : lastNonListText,
	};
}

function findChunkEnd(text: string, maxLength: number): number {
	if (text.length <= maxLength) return text.length;

	let end = maxLength;
	while (end > 0 && !/\s/.test(text[end])) {
		end--;
	}

	return end > 0 ? end : maxLength;
}

/**
 * Remove all thinking tags and their content from text
 * Used by the main.ts file for final output
 *
 * @param text Text that may contain thinking tags
 * @returns Clean text without thinking tags and their content
 */
export function removeThinkingTags(text: string): string {
	return text.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
}
