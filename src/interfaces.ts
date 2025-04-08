// --- START OF FILE interfaces.ts ---

/**
 * Represents a single action that can be performed by the Local GPT plugin.
 */
export interface LocalGPTAction {
	id: string;          // Unique identifier for the action
	groupId: string;     // ID of the ActionGroup this action belongs to
	name: string;        // User-facing name of the action
	prompt: string;      // The prompt template to be sent to the AI
	system: string;      // The system message to guide the AI's behavior
	replace: boolean;    // Whether the action's output should replace the selected text
	providerId: string | null; // Specific AI Provider ID override (null uses determined default)
	// Action-specific creativity override KEY ('focused', 'balanced', etc.) from defaultSettings.CREATIVITY.
	// Null means use the global default setting.
	temperature: string | null;
}

/**
 * Represents a group of related actions.
 */
export interface ActionGroup {
	id: string;          // Unique identifier for the group
	name: string;        // User-facing name of the group
	actions: LocalGPTAction[]; // Array of actions within this group
}


// --- Main Settings Interface ---

/**
 * Defines the overall settings structure for the Local GPT plugin.
 */
export interface LocalGPTSettings {
	_version: number;     // Internal version number for settings migration

	// AI Provider configuration (using IDs from the AI Providers SDK)
	aiProviders: {
		main: string | null;      // Default provider for general tasks
		embedding: string | null; // Provider for generating embeddings (RAG)
		vision: string | null;    // Provider for handling image input
	};

	// Default behavior settings
	defaults: {
		// Default creativity level KEY ('focused', 'balanced', etc.)
		creativity: string;
	};

	// Action management using groups
	actionGroups: ActionGroup[];

	// UI/UX settings
	showProviderInContextMenu: boolean; // Feature flag for showing provider choice modal via context menu
	showCreativityInContextMenu: boolean; // <<< ADDED: Feature flag for showing creativity choice modal via context menu
	currentGroupId: string | null; // ID of the group whose actions are available in the context menu / command palette
}

// --- END OF FILE interfaces.ts ---