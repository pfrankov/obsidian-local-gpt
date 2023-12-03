import {LocalGPTSettings} from "./interfaces";

export const DEFAULT_SETTINGS: LocalGPTSettings = {
	ollamaUrl: "http://localhost:11434",
	defaultModel: "orca-mini",
	actions: [
		{
			name: "🪄 General help",
			prompt: "",
			system: "You are an assistant helping a user write more content in a document based on a prompt. Output in markdown format. Do not use links. Do not include literal content from the original document."
		},
		{
			name: "✍️ Continue writing",
			prompt: "Act as a professional editor with many years of experience as a writer. Carefully finalize the following text, add details, use facts and make sure that the meaning and original style are preserved. Purposely write in detail, with examples, so that your reader is comfortable, even if they don't understand the specifics. Don't use clericalisms, evaluations without proof with facts, passive voice. Use Markdown markup language for formatting. Answer only content and nothing else, no introductory words, only substance.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can."
		},
		{
			name: "🍭 Summarize",
			prompt: "Make a concise summary of the key points of the following text.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can."
		},
		{
			name: "📖 Fix spelling and grammar",
			prompt: "Proofread the below for spelling and grammar.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
			replace: true
		},
		{
			name: "✅ Find action items",
			prompt: "Act as an assistant helping find action items inside a document. An action item is an extracted task or to-do found inside of an unstructured document. Use Markdown checkbox format: each line starts with \"- [ ] \"",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can."
		}
	],
};
