// --- START OF FILE text-processing.ts ---

// Removed logger import as it was unused after commenting out debug calls
// import { logger } from "./logger";

// Sensible default chunk size, aiming for ~300-500 tokens depending on model.
// 1000 characters is a rough proxy, adjust based on testing.
const MAX_CHUNK_SIZE = 1000;
// Minimum chunk size to avoid tiny, meaningless chunks.
const MIN_CHUNK_SIZE = 50;

/**
 * Preprocesses Markdown content for embedding by removing noise.
 * @param content - The raw Markdown content.
 * @returns Cleaned content string.
 */
export function preprocessContent(content: string): string {
	if (!content) return "";
	// logger.debug("Preprocessing content", { initialLength: content.length });

	// Use const as cleanedContent is not reassigned
	const cleanedContent = content
		// 1. Remove frontmatter
		.replace(/^---\s*[\s\S]*?---\s*/, "")
		// 2. Remove HTML comments
		.replace(/<!--[\s\S]*?-->/g, "")
		// 3. Remove multi-line code blocks
		.replace(/```[\s\S]*?```/g, "")
		// 4. Remove Mermaid, Excalidraw, Kanban blocks etc.
		.replace(/```(mermaid|excalidraw|kanban|graph|mindmap|plantuml)[\s\S]*?```/g, "")
		// 5. Replace multiple consecutive newlines with a maximum of two
		.replace(/\n{3,}/g, "\n\n")
		// 6. Remove Obsidian block IDs like ^id123 at end of lines
		.replace(/\s+\^[a-zA-Z0-9]+$/gm, "")
		// 7. Remove empty list items "- " or "* " on their own lines
		.replace(/^(\s*[-*+]\s*)$\n/gm, "")
		// 8. Remove horizontal rules (---, ***, ___ on their own lines)
		.replace(/^\s*([-*_]){3,}\s*$/gm, "")
		.trim(); // Final trim of the whole content

	// logger.debug("Preprocessing complete", { finalLength: cleanedContent.length });
	return cleanedContent;
}

/**
 * Splits preprocessed content into chunks suitable for embedding.
 * Aims for MAX_CHUNK_SIZE but respects sentence/paragraph boundaries where possible.
 * @param content - Preprocessed content string.
 * @returns Array of text chunks.
 */
export function splitContent(content: string): string[] {
	if (!content) return [];
	// logger.debug("Splitting content", { contentLength: content.length });

	const chunks: string[] = [];
	// Simple newline splitting as a basic strategy.
	// More advanced: Use sentence boundary detection or paragraph splitting.
	const potentialChunks = content.split('\n\n'); // Split by double newline (paragraphs)

	let currentChunk = "";
	for (const p of potentialChunks) {
		const paragraph = p.trim();
		if (!paragraph) continue; // Skip empty paragraphs

		// If adding the paragraph exceeds max size, push the current chunk and start a new one.
		if (currentChunk.length > 0 && currentChunk.length + paragraph.length + 1 > MAX_CHUNK_SIZE) {
			if (currentChunk.length >= MIN_CHUNK_SIZE) {
				chunks.push(currentChunk);
			} else {
				// logger.debug(`Skipping short chunk before adding new paragraph: "${currentChunk.substring(0, 50)}..."`);
			}
			currentChunk = paragraph;
		}
		// If the paragraph itself is too large, split it further (e.g., by sentences)
		else if (paragraph.length > MAX_CHUNK_SIZE) {
			// Push the current chunk before handling the large paragraph
			if (currentChunk.length >= MIN_CHUNK_SIZE) {
				chunks.push(currentChunk);
			}
			currentChunk = ""; // Reset current chunk

			// Sub-split the large paragraph (e.g., by sentence)
			// Simple sentence split. Consider libraries like 'sentence-splitter' for more robust splitting.
			const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)/g) || [paragraph];
			let subChunk = "";
			for (const sentence of sentences) {
				const trimmedSentence = sentence.trim();
				if (!trimmedSentence) continue;

				if (subChunk.length > 0 && subChunk.length + trimmedSentence.length + 1 > MAX_CHUNK_SIZE) {
					if (subChunk.length >= MIN_CHUNK_SIZE) chunks.push(subChunk);
					subChunk = trimmedSentence;
				} else {
					subChunk = subChunk ? `${subChunk} ${trimmedSentence}` : trimmedSentence;
				}
			}
			// Add the last sub-chunk of the large paragraph
			if (subChunk.length >= MIN_CHUNK_SIZE) chunks.push(subChunk);
			// else if (subChunk.length > 0) logger.debug(`Skipping small final sub-chunk: "${subChunk.substring(0, 50)}..."`);


		}
		// Otherwise, append the paragraph to the current chunk.
		else {
			currentChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
		}
	}

	// Add the last remaining chunk if it's not empty and meets min size
	if (currentChunk.length >= MIN_CHUNK_SIZE) {
		chunks.push(currentChunk);
	}
	// else if (currentChunk.length > 0) {
	// logger.debug(`Skipping final small chunk: "${currentChunk.substring(0, 50)}..."`);
	// }

	// logger.debug(`Splitting complete. ${chunks.length} chunks created.`);
	return chunks;
}


/**
 * Removes <think>...</think> tags and their content from the beginning of the text.
 * Used by the main.ts file for final output processing.
 *
 * @param text Text that may contain thinking tags at the start.
 * @returns Clean text without the initial thinking tag block.
 */
export function removeThinkingTags(text: string): string {
	if (!text) return "";
	// Regex to match <think>...</think> potentially with leading/trailing whitespace around the tags
	return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}


// --- Old Splitting Logic (Removed) ---

// --- END OF FILE text-processing.ts ---