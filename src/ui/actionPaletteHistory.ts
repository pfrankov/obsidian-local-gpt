const PROMPT_HISTORY_LIMIT = 50;
const HISTORY_STORAGE_KEY = "local-gpt-action-palette-history";
const promptHistory: string[] = loadHistoryFromStorage();

function loadHistoryFromStorage(): string[] {
	if (typeof localStorage === "undefined") return [];

	try {
		const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((item): item is string => typeof item === "string")
			.slice(-PROMPT_HISTORY_LIMIT);
	} catch (error) {
		console.error("Failed to read Action Palette history:", error);
		return [];
	}
}

function persistHistory() {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(
			HISTORY_STORAGE_KEY,
			JSON.stringify(promptHistory.slice(-PROMPT_HISTORY_LIMIT)),
		);
	} catch (error) {
		console.error("Failed to save Action Palette history:", error);
	}
}

export function addToPromptHistory(entry: string) {
	const normalized = entry.trim();
	if (!normalized) return;

	const lastNormalized = promptHistory[promptHistory.length - 1]?.trim();
	if (lastNormalized === normalized) return;

	promptHistory.push(entry);
	if (promptHistory.length > PROMPT_HISTORY_LIMIT) {
		promptHistory.shift();
	}
	persistHistory();
}

export function getPromptHistoryEntry(index: number): string | undefined {
	return promptHistory[index];
}

export function getPromptHistoryLength(): number {
	return promptHistory.length;
}

export function resetPromptHistory() {
	promptHistory.length = 0;
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(HISTORY_STORAGE_KEY);
	} catch (error) {
		console.error("Failed to reset Action Palette history:", error);
	}
}
