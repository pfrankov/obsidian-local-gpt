const MAX_CHUNK_SIZE = 1000;

export function preprocessContent(content: string): string {
	return content
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/^#+\s*[^\n]+\n(?=#+|\s*$)/gm, "")
		.replace(/\n{3,}/g, "\n\n");
}

export function splitContent(content: string): string[] {
	const sections = content
		.split(/^---$/m)
		.flatMap((section) => splitByHeaders(section.trim()));
	return sections
		.flatMap((section) => splitSectionWithLists(section))
		.filter((chunk) => chunk.length > 0);
}

export function splitIntoChunks(text: string, maxChunkSize: number): string[] {
	const chunks: string[] = [];
	const headingRegex = /^(#{1,6}\s|[*_]{2}).+\s*(\n|$)/gm;
	let lastIndex = 0;
	let match;

	while ((match = headingRegex.exec(text)) !== null) {
		if (lastIndex > 0) {
			const chunk = text.slice(lastIndex, match.index).trim();
			if (chunk.length > 0) {
				chunks.push(chunk);
			}
		}
		lastIndex = match.index;
	}

	// Add the last chunk
	const lastChunk = text.slice(lastIndex).trim();
	if (lastChunk.length > 0) {
		chunks.push(lastChunk);
	}

	// Merge chunks that are too small
	return mergeSmallChunks(chunks, maxChunkSize);
}

function mergeSmallChunks(chunks: string[], maxChunkSize: number): string[] {
	const mergedChunks: string[] = [];
	let currentChunk = "";

	for (const chunk of chunks) {
		if (currentChunk.length + chunk.length + 1 <= maxChunkSize) {
			currentChunk += (currentChunk ? "\n\n" : "") + chunk;
		} else {
			if (currentChunk) {
				mergedChunks.push(currentChunk);
			}
			currentChunk = chunk;
		}
	}

	if (currentChunk) {
		mergedChunks.push(currentChunk);
	}

	return mergedChunks;
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

function splitLargeSection(section: string): string[] {
	return splitByDoubleLine(section).flatMap((chunk) =>
		chunk.length <= MAX_CHUNK_SIZE ? [chunk] : splitTextRecursively(chunk),
	);
}

function splitByDoubleLine(text: string): string[] {
	return text.split(/\n\s*\n/).filter((chunk) => chunk.trim().length > 0);
}

function splitTextRecursively(text: string): string[] {
	if (text.length <= MAX_CHUNK_SIZE) {
		return [text];
	}

	const splitByLine = text.split("\n");
	if (splitByLine.length > 1) {
		const midIndex = Math.floor(splitByLine.length / 2);
		const firstHalf = splitByLine.slice(0, midIndex).join("\n");
		const secondHalf = splitByLine.slice(midIndex).join("\n");
		return [
			...splitTextRecursively(firstHalf),
			...splitTextRecursively(secondHalf),
		];
	}

	const splitByPeriod = text.split(".");
	if (splitByPeriod.length > 1) {
		const midIndex = Math.floor(splitByPeriod.length / 2);
		const firstHalf = splitByPeriod.slice(0, midIndex).join(".");
		const secondHalf = splitByPeriod.slice(midIndex).join(".");
		return [
			...splitTextRecursively(firstHalf),
			...splitTextRecursively(secondHalf),
		];
	}

	return [text];
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
