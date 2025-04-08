// --- START OF FILE defaultSettings.ts ---

import { LocalGPTSettings, ActionGroup, LocalGPTAction } from "./interfaces";
import { v4 as uuidv4 } from 'uuid';

// Generate unique IDs for the default group and actions
const defaultGroupId = uuidv4();
const defaultActionIds = Array.from({ length: 6 }, () => uuidv4());

// Define the default actions
const DEFAULT_ACTIONS: LocalGPTAction[] = [
	{
		id: defaultActionIds[0],
		groupId: defaultGroupId,
		name: "🪄 General help",
		prompt: "",
		system: "You are an assistant helping a user write more content in a document based on a prompt. Output in markdown format. Do not use links. Do not include literal content from the original document.",
		replace: false,
		providerId: null,
		temperature: null, // Use global default
	},
	{
		id: defaultActionIds[1],
		groupId: defaultGroupId,
		name: "✍️ Continue writing",
		prompt: "Act as a professional editor with many years of experience as a writer. Carefully finalize the following text, add details, use facts and make sure that the meaning and original style are preserved. Purposely write in detail, with examples, so that your reader is comfortable, even if they don't understand the specifics. Don't use clericalisms, evaluations without proof with facts, passive voice. Use Markdown markup language for formatting. Answer only content and nothing else, no introductory words, only substance.",
		system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		replace: false,
		providerId: null,
		temperature: null, // Use global default
	},
	{
		id: defaultActionIds[2],
		groupId: defaultGroupId,
		name: "🍭 Summarize",
		prompt: "Make a concise summary of the key points of the following text.",
		system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		replace: false,
		providerId: null,
		temperature: null, // Use global default
	},
	{
		id: defaultActionIds[3],
		groupId: defaultGroupId,
		name: "📖 Fix spelling and grammar",
		prompt: "Proofread the below for spelling and grammar.",
		system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		replace: true,
		providerId: null,
		temperature: null, // Use global default
	},
	{
		id: defaultActionIds[4],
		groupId: defaultGroupId,
		name: "✅ Find action items",
		prompt: 'Act as an assistant helping find action items inside a document. An action item is an extracted task or to-do found inside of an unstructured document. Use Markdown checkbox format: each line starts with "- [ ] "',
		system: "You are an AI assistant that follows instruction extremely well. Help as much as you can.",
		replace: false,
		providerId: null,
		temperature: null, // Use global default
	},
	{
		id: defaultActionIds[5],
		groupId: defaultGroupId,
		name: "🧠 New System Prompt",
		prompt: "",
		system: `You are a highly skilled AI prompt engineer with expertise in creating tailored prompts for a wide range of professional roles. You have a deep knowledge of how to craft prompts that effectively guide the language model to produce high-quality, contextually appropriate responses.\n\nYour task is to generate a custom system prompt for different roles based on user input. This involves understanding the specific requirements of each role, the context in which the prompt will be used, and the desired output format. You are skilled in structuring prompts that ensure clarity, relevance, and utility.\n\nCreate a custom system prompt for an LLM to assist users in generating contextually appropriate and highly effective responses for various roles. The prompt should provide clear instructions to the LLM on how to handle specific scenarios related to the role, including the tone and format of the response.\n\nStart by providing a role "You are..." and context as a summary of the situation or background information relevant to the prompt. Define the main objective, outlining what the LLM needs to accomplish.\n\nInclude instructions on the appropriate style and tone (e.g., formal, casual, technical, empathetic) based on the role and audience. Identify the target audience to tailor the LLM's output effectively. Specify the format of the response, whether it should be a narrative, bullet points, step-by-step guide, code, or another format. Avoid using headings or examples; the prompt should read as a continuous, cohesive set of instructions.\nANSWER PROMPT AND NOTHING ELSE!`,
		replace: false,
		providerId: null,
		temperature: null, // Use global default
	},
];

// Define the default action group(s)
const DEFAULT_ACTION_GROUPS: ActionGroup[] = [
	{
		id: defaultGroupId,
		name: "General",
		actions: DEFAULT_ACTIONS,
	}
];

// Define the default settings structure
export const DEFAULT_SETTINGS: Readonly<LocalGPTSettings> = {
	_version: 8, // Current settings version
	aiProviders: {
		main: null,
		embedding: null,
		vision: null,
	},
	defaults: {
		creativity: "balanced", // Default creativity level key
	},
	actionGroups: DEFAULT_ACTION_GROUPS,
	showProviderInContextMenu: false,
	showCreativityInContextMenu: false, // <<< ADDED: Default to false
	currentGroupId: defaultGroupId, // Default to the ID of the first group
};

// Updated Creativity levels and mapping
export const CREATIVITY: Readonly<Record<string, { temperature: number }>> = {
	"focused": { temperature: 0.2 },
	"creative": { temperature: 0.5 },
	"balanced": { temperature: 1.0 }, // Matches default key above
	"explorer": { temperature: 1.5 },
	"max": { temperature: 2.0 },
};

// Template keywords
export const SELECTION_KEYWORD = "{{selection}}";
export const CONTEXT_KEYWORD = "{{context}}";
export const CONTEXT_CONDITION_START = "{{=CONTEXT_START=}}";
export const CONTEXT_CONDITION_END = "{{=CONTEXT_END=}}";

// --- END OF FILE defaultSettings.ts ---