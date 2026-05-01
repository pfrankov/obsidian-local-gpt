export function removeThinkingTags(text: string): string {
	return text.replace(/^<think>[\s\S]*?<\/think>\s*/, "");
}
