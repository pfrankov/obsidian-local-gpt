import { SELECTION_KEYWORD } from "./defaultSettings";

export function preparePrompt(prompt: string = "", selectedText: string) {
	if (prompt.includes(SELECTION_KEYWORD)) {
		return prompt.replace(SELECTION_KEYWORD, selectedText || "");
	} else {
		return [prompt, selectedText].filter(Boolean).join("\n\n");
	}
}
