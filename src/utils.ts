import {
	SELECTION_KEYWORD,
	CONTEXT_KEYWORD,
	CONTEXT_CONDITION_START,
	CONTEXT_CONDITION_END,
} from "./defaultSettings";

export function preparePrompt(
	prompt: string = "",
	selectedText: string,
	context: string,
) {
	const withSelection = mergeSelection(prompt, selectedText);
	const withContext = injectContext(withSelection, context);
	return resolveConditionalContext(withContext, context);
}

function mergeSelection(prompt: string, selectedText: string): string {
	if (prompt.includes(SELECTION_KEYWORD)) {
		return prompt.replace(SELECTION_KEYWORD, selectedText || "");
	}

	return [prompt, selectedText].filter(Boolean).join("\n\n");
}

function injectContext(prompt: string, context: string): string {
	if (prompt.includes(CONTEXT_KEYWORD)) {
		return prompt.replace(CONTEXT_KEYWORD, context || "");
	}

	if (context.trim()) {
		return [prompt, "Context:\n" + context].filter(Boolean).join("\n\n");
	}

	return prompt;
}

function resolveConditionalContext(prompt: string, context: string): string {
	if (
		prompt.includes(CONTEXT_CONDITION_START) &&
		prompt.includes(CONTEXT_CONDITION_END)
	) {
		const start = prompt.indexOf(CONTEXT_CONDITION_START) - 1;
		const end = prompt.indexOf(CONTEXT_CONDITION_END);
		if (start !== -1 && end !== -1 && start < end) {
			let contextBlock = prompt.substring(
				start + CONTEXT_CONDITION_START.length + 1,
				end,
			);
			if (!context.trim()) {
				contextBlock = "";
			}
			prompt =
				prompt.substring(0, start) +
				contextBlock +
				prompt.substring(end + CONTEXT_CONDITION_END.length + 1);
		}
	}

	return prompt;
}
