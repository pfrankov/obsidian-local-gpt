import type {
	ActionPaletteSubmitEvent,
	CommandReference,
	CreativityReference,
	FileReference,
	ModelReference,
	ProviderReference,
	SystemPromptReference,
} from "../interfaces";

export type DropdownItem =
	| FileReference
	| CommandReference
	| ProviderReference
	| ModelReference
	| CreativityReference
	| SystemPromptReference;

export type DropdownKind =
	| "none"
	| "file"
	| "command"
	| "provider"
	| "model"
	| "creativity"
	| "system";

export type SelectionHandler = (
	item: DropdownItem,
) => void | Promise<void> | undefined;

export type PaletteEvents = {
	submit: ActionPaletteSubmitEvent;
	cancel: void;
};

export const MAX_DROPDOWN_RESULTS = 15;
export const FILE_MENTION_REGEX = /@([^@]+?\.[a-zA-Z0-9]+)(?=\s|$|@)/g;
export const MENTION_PREFIX = "@";
export const SPACE_AFTER_MENTION = " ";
export const COMMAND_REGEX = /\/([^/\s]+)(?=\s|$|\/)/g;
export const COMMAND_PREFIX = "/";
export const SPACE_AFTER_COMMAND = " ";
export const CLEAR_SYSTEM_PROMPT_ID = "__clear_system_prompt__";
export const SYSTEM_PREVIEW_LENGTH = 80;
