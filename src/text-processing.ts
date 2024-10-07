import { logger } from "./logger";

const MAX_CHUNK_SIZE = 1000;

export function preprocessContent(content: string): string {
	logger.debug("Preprocessing content", { contentLength: content.length });
	return content
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/^(#+)\s*$\n/gm, "")
		.replace(/^(#+)\s*(?!$)[^\n]+\n(?=\s*(?:\1#|\s*$)(?!\s*\S))/gm, "")
		.replace(/\n{3,}/g, "\n\n");
}

export function splitContent(content: string): string[] {
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
	const chunks: string[] = [];
	const lines = section.split("\n");
	let currentChunk = "";
	let inList = false;
	let lastNonListText = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const isListItem = /^(\s*[-*+]|\s*\d+\.)/.test(line);
		const isHeader = /^(#{1,6}\s|[*_]{2}).+/.test(line);

		if (isHeader) {
			if (currentChunk.length > 0) {
				chunks.push(currentChunk.trim());
			}
			currentChunk = line;
			inList = false;
			lastNonListText = line;
		} else if (isListItem) {
			if (
				!inList &&
				currentChunk.length + line.length <= MAX_CHUNK_SIZE
			) {
				// If the list item can fit in the current chunk, add it
				currentChunk += "\n" + line;
				inList = true;
			} else if (!inList) {
				// Start of a new list that doesn't fit in the current chunk
				if (currentChunk.length > 0) {
					chunks.push(currentChunk.trim());
				}
				currentChunk = lastNonListText + "\n" + line;
				inList = true;
			} else {
				// Continue the list
				currentChunk += "\n" + line;
			}
		} else {
			if (inList && line.trim() === "") {
				// Empty line within a list, keep it as part of the list
				currentChunk += "\n" + line;
			} else {
				if (inList) {
					// End of the list
					inList = false;
				}

				if (
					currentChunk.length + line.length > MAX_CHUNK_SIZE &&
					!inList
				) {
					chunks.push(currentChunk.trim());
					currentChunk = "";
				}

				currentChunk += (currentChunk ? "\n" : "") + line;

				if (line.trim() !== "") {
					lastNonListText = line;
				}
			}
		}
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk.trim());
	}

	return chunks;
}
