import { LocalGPTSettings } from "./interfaces";

export const DEFAULT_SETTINGS: LocalGPTSettings = {
	aiProviders: {
		main: null,
		embedding: null,
		vision: null,
	},
	defaults: {
		creativity: "low",
	},
	actions: [
		{
			name: "🪄 General help",
			prompt: "",
			system: "You are an assistant helping a user write more content in a document based on a prompt. Output in markdown format. Do not use links. Do not include literal content from the original document.",
		},
		{
			name: "✍️ Continue writing",
			prompt: "Act as a professional editor with many years of experience as a writer. Carefully finalize the following text, add details, use facts and make sure that the meaning and original style are preserved. Purposely write in detail, with examples, so that your reader is comfortable, even if they don't understand the specifics. Don't use clericalisms, evaluations without proof with facts, passive voice. Use Markdown markup language for formatting. Answer only content and nothing else, no introductory words, only substance.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		},
		{
			name: "🍭 Summarize",
			prompt: "Make a concise summary of the key points of the following text.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		},
		{
			name: "📖 Fix spelling and grammar",
			prompt: "Proofread the below for spelling and grammar.",
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
			replace: true,
		},
		{
			name: "✅ Find action items",
			prompt: 'Act as an assistant helping find action items inside a document. An action item is an extracted task or to-do found inside of an unstructured document. Use Markdown checkbox format: each line starts with "- [ ] "',
			system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		},
		{
			name: "🧠 New System Prompt",
			prompt: "",
			system: `You are a highly skilled AI prompt engineer with expertise in creating tailored prompts for a wide range of professional roles. You have a deep knowledge of how to craft prompts that effectively guide the language model to produce high-quality, contextually appropriate responses.\n\nYour task is to generate a custom system prompt for different roles based on user input. This involves understanding the specific requirements of each role, the context in which the prompt will be used, and the desired output format. You are skilled in structuring prompts that ensure clarity, relevance, and utility.\n\nCreate a custom system prompt for an LLM to assist users in generating contextually appropriate and highly effective responses for various roles. The prompt should provide clear instructions to the LLM on how to handle specific scenarios related to the role, including the tone and format of the response.\n\nStart by providing a role "You are..." and context as a summary of the situation or background information relevant to the prompt. Define the main objective, outlining what the LLM needs to accomplish.\n\nInclude instructions on the appropriate style and tone (e.g., formal, casual, technical, empathetic) based on the role and audience. Identify the target audience to tailor the LLM's output effectively. Specify the format of the response, whether it should be a narrative, bullet points, step-by-step guide, code, or another format. Avoid using headings or examples; the prompt should read as a continuous, cohesive set of instructions.\nANSWER PROMPT AND NOTHING ELSE!`,
		},
	],
	_version: 7,
};

export const CREATIVITY: { [index: string]: any } = {
	"": {
		temperature: 0,
	},
	low: {
		temperature: 0.2,
	},
	medium: {
		temperature: 0.5,
	},
	high: {
		temperature: 1,
	},
};

export const SELECTION_KEYWORD = "{{=SELECTION=}}";
export const CONTEXT_KEYWORD = "{{=CONTEXT=}}";
export const CONTEXT_CONDITION_START = "{{=CONTEXT_START=}}";
export const CONTEXT_CONDITION_END = "{{=CONTEXT_END=}}";
