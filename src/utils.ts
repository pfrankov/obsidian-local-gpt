// --- START OF FILE utils.ts ---

import {
	SELECTION_KEYWORD,
	CONTEXT_KEYWORD,
	CONTEXT_CONDITION_START,
	CONTEXT_CONDITION_END,
} from "./defaultSettings";
import { logger } from "./logger";

/**
 * Prepares the final prompt string by replacing keywords and handling context.
 *
 * @param prompt - The base prompt template string from the action. Can be undefined or empty.
 * @param selectedText - The text currently selected in the editor (can be empty).
 * @param context - Context string (e.g., from RAG) to potentially include (can be empty).
 * @returns The fully prepared prompt string ready to be sent to the AI.
 */
export function preparePrompt(
	prompt = "", // Default to empty string, ESLint fix: removed : string
	selectedText: string,
	context: string,
): string {
	let finalPrompt = prompt || ""; // Ensure finalPrompt is a string
	// logger.debug("Preparing prompt. Initial template:", finalPrompt);
	// logger.debug("Selected Text:", selectedText ? selectedText.substring(0, 100) + "..." : "None");
	// logger.debug("Context:", context ? context.substring(0, 100) + "..." : "None");

	// 1. Handle {{selection}} keyword
	if (finalPrompt.includes(SELECTION_KEYWORD)) {
		// logger.debug(`Replacing ${SELECTION_KEYWORD}`);
		finalPrompt = finalPrompt.replace(SELECTION_KEYWORD, selectedText || ""); // Replace with selection or empty string
	} else if (selectedText) {
		// If keyword is missing but selection exists, append selection after a separator
		// logger.debug(`${SELECTION_KEYWORD} not found, appending selected text.`);
		finalPrompt = `${finalPrompt}\n\n---\n\n${selectedText}`; // Use a clear separator
	}

	// 2. Handle {{context}} keyword and conditional context block
	const hasContextKeyword = finalPrompt.includes(CONTEXT_KEYWORD);
	const hasContextCondition = finalPrompt.includes(CONTEXT_CONDITION_START) && finalPrompt.includes(CONTEXT_CONDITION_END);
	const contextIsNotEmpty = context && context.trim().length > 0;

	if (hasContextCondition) {
		// logger.debug("Processing conditional context block...");
		const startIndex = finalPrompt.indexOf(CONTEXT_CONDITION_START);
		const endIndex = finalPrompt.indexOf(CONTEXT_CONDITION_END);

		// Ensure indices are valid and in correct order
		if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
			const prefix = finalPrompt.substring(0, startIndex);
			// Calculate end position correctly: index + length of end tag
			const suffix = finalPrompt.substring(endIndex + CONTEXT_CONDITION_END.length);
			let conditionalBlock = finalPrompt.substring(startIndex + CONTEXT_CONDITION_START.length, endIndex);

			if (contextIsNotEmpty) {
				// logger.debug("Context is present, including conditional block.");
				if (conditionalBlock.includes(CONTEXT_KEYWORD)) {
					// logger.debug(`Replacing ${CONTEXT_KEYWORD} inside conditional block.`);
					conditionalBlock = conditionalBlock.replace(CONTEXT_KEYWORD, context);
				}
				// Include the (potentially modified) block
				finalPrompt = prefix + conditionalBlock + suffix;
			} else {
				// logger.debug("Context is empty, removing conditional block.");
				// Remove the block entirely if context is empty
				finalPrompt = prefix + suffix;
			}
		} else {
			logger.warn("Mismatched or invalid context condition tags found. Ignoring conditional logic.");
			// Fall through to default {{context}} keyword handling if tags are bad
			if (hasContextKeyword) {
				// logger.debug(`Replacing ${CONTEXT_KEYWORD} (fallback after invalid condition).`);
				finalPrompt = finalPrompt.replace(CONTEXT_KEYWORD, context || "");
			} else if (contextIsNotEmpty) {
				// logger.debug(`Appending context (fallback after invalid condition).`);
				finalPrompt = `${finalPrompt}\n\n---\nContext:\n${context}`;
			}
		}
	}
	// Handle {{context}} keyword if it *wasn't* inside a conditional block
	else if (hasContextKeyword) {
		// logger.debug(`Replacing ${CONTEXT_KEYWORD} (outside conditional block).`);
		finalPrompt = finalPrompt.replace(CONTEXT_KEYWORD, context || ""); // Replace with context or empty string
	}
	// Append context automatically if keyword and condition block are missing, but context exists
	else if (contextIsNotEmpty) {
		// logger.debug(`${CONTEXT_KEYWORD} and conditional block not found, appending context automatically.`);
		finalPrompt = `${finalPrompt}\n\n---\nContext:\n${context}`; // Add context with clear labeling
	}

	// logger.debug("Final prepared prompt:", finalPrompt);
	return finalPrompt.trim(); // Return trimmed prompt
}

// --- END OF FILE utils.ts ---