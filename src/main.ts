// --- START OF FILE main.ts ---

import {
	Editor,
	Menu,
	Notice,
	Plugin,
	SuggestModal,
	App,
	PluginManifest,
	MenuItem, // Keep MenuItem even if ESLint complains, it's used
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	setIcon, // Keep import for type checking clarity, disable lint warning
	MarkdownView, // Import MarkdownView
	// View, // Removed unused import
} from "obsidian";
// Import EditorView from codemirror
import { EditorView } from "@codemirror/view";
import {
	initAI,
	waitForAI,
	IAIProvider,
	IAIProvidersService,
	IChunkHandler,
} from "@obsidian-ai-providers/sdk";
import { v4 as uuidv4 } from 'uuid';

import { LocalGPTSettingTab } from "./LocalGPTSettingTab";
import { CREATIVITY, DEFAULT_SETTINGS } from "defaultSettings";
import { spinnerPlugin, SpinnerPlugin } from "./spinnerPlugin";
import { removeThinkingTags } from "./text-processing";
import { LocalGPTAction, LocalGPTSettings, ActionGroup } from "./interfaces"; // Added ActionGroup
import { preparePrompt } from "./utils";
import { logger } from "./logger";
import { fileCache } from "./indexedDB";

// --- Modals (Unchanged) ---
interface ProviderChoice extends IAIProvider { isDefault?: boolean; }
class ProviderSuggestModal extends SuggestModal<ProviderChoice> {
	providers: ProviderChoice[];
	onSubmit: (result: ProviderChoice | null) => void;
	constructor(app: App, providers: ProviderChoice[], onSubmit: (result: ProviderChoice | null) => void) {
		super(app);
		const defaultChoice: ProviderChoice = { id: '__DEFAULT__', name: 'Default (Use Setting)', type: 'ollama', model: '', isDefault: true };
		const uniqueSdkProviders = providers.filter(p => p && p.id !== '__DEFAULT__');
		this.providers = [defaultChoice, ...uniqueSdkProviders.map(p => ({ ...p, id: p.id }))];
		this.onSubmit = onSubmit;
		this.setPlaceholder("Select Provider (or ESC to cancel)...");
	}
	getSuggestions(query: string): ProviderChoice[] { const lowerQuery = query.toLowerCase(); return this.providers.filter(p => p.name?.toLowerCase().includes(lowerQuery) || p.id?.toLowerCase().includes(lowerQuery) || (p.isDefault && "default".toLowerCase().includes(lowerQuery))); }
	renderSuggestion(provider: ProviderChoice, el: HTMLElement) { el.createEl("div", { text: provider.name }); const descEl = el.createEl("small", { cls: "plugin-suggestion-description" }); if (provider.isDefault) { descEl.setText("Uses global or action-specific setting"); } else { const details: string[] = []; if (provider.model) details.push(`M: ${provider.model}`); if (provider.id && provider.id !== provider.name && provider.id !== '__DEFAULT__') { details.push(`ID: ${provider.id}`); } descEl.setText(details.join(' | ')); } }
	onChooseSuggestion(provider: ProviderChoice, evt: MouseEvent | KeyboardEvent) { this.onSubmit(provider); }
}
interface CreativityChoice { key: string; name: string; isDefault?: boolean; }
class CreativitySuggestModal extends SuggestModal<CreativityChoice> {
	choices: CreativityChoice[];
	onSubmit: (result: CreativityChoice | null) => void;
	constructor(app: App, choices: CreativityChoice[], onSubmit: (result: CreativityChoice | null) => void) { super(app); this.choices = choices; this.onSubmit = onSubmit; this.setPlaceholder("Select Creativity (or ESC to cancel)..."); }
	getSuggestions(query: string): CreativityChoice[] { const lowerQuery = query.toLowerCase(); return this.choices.filter(c => c.name.toLowerCase().includes(lowerQuery) || c.key.toLowerCase().includes(lowerQuery)); }
	renderSuggestion(choice: CreativityChoice, el: HTMLElement) { el.createEl("div", { text: choice.name }); if (choice.isDefault) { el.createEl("small", { text: "Uses global or action-specific setting", cls: "plugin-suggestion-description" }); } }
	onChooseSuggestion(choice: CreativityChoice, evt: MouseEvent | KeyboardEvent) { this.onSubmit(choice); }
}


// --- Main Plugin Class ---
export default class LocalGPT extends Plugin {
	settings!: LocalGPTSettings;
	abortControllers: AbortController[] = [];
	public contextMenuCurrentGroupId: string | null = null;
	// Store UI state for the settings tab within the plugin instance
	public state?: { editingActionId?: string | null; reorderingGroupId?: string | null; };

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
	}

	async onload() {
		logger.info(`Loading Local GPT Plugin v${this.manifest.version}...`);
		try {
			await initAI(this.app, this, async () => {
				await this.loadSettings();
				this.addSettingTab(new LocalGPTSettingTab(this.app, this));

				// Initialize group ID if needed
				const firstValidGroupId = this.settings.actionGroups?.find(g => g?.id)?.id ?? null;
				if (!this.settings.currentGroupId || !this.settings.actionGroups?.some(g => g.id === this.settings.currentGroupId)) {
					this.settings.currentGroupId = firstValidGroupId;
					if (firstValidGroupId) await this.saveSettings();
				}
				this.contextMenuCurrentGroupId = this.settings.currentGroupId;
				this.state = { editingActionId: null, reorderingGroupId: null };

				this.reload();

				this.app.workspace.onLayoutReady(async () => {
					try {
						// @ts-expect-error - appId might exist but is not typed
						const vaultId = this.app.appId || this.app.vault?.configDir || this.app.vault?.getName() || 'default-vault';
						await fileCache.init(vaultId);
						logger.info(`File cache initialized for vault: ${vaultId}`);
					}
					catch (err) {
						logger.error("Failed to init file cache:", err);
						new Notice("Local GPT: Failed to initialize file cache.");
					}
				});

				this.registerEditorExtension(spinnerPlugin);
				logger.debug("SpinnerPlugin registered.");
				document.addEventListener("keydown", this.escapeHandler);
				logger.info("Local GPT Plugin Loaded Successfully.");
			});
		} catch (err) {
			logger.error("Error initializing AI Providers SDK or loading plugin:", err);
			new Notice("Local GPT Error: Could not initialize AI Providers. Check settings or console.", 0);
		}
	}

	/** Reloads commands and resets abort controllers */
	reload(): void {
		logger.debug("Reloading Local GPT commands...");
		this.abortControllers.forEach(controller => {
			try { controller.abort(); } catch (e) { logger.warn("Error aborting controller during reload:", e); }
		});
		this.abortControllers = [];
		this.addCommands();
		document.removeEventListener("keydown", this.escapeHandler);
		document.addEventListener("keydown", this.escapeHandler);
		logger.debug("Local GPT Reloaded.");
	}

	/** Registers plugin commands */
	private addCommands() {
		logger.debug("Registering commands...");
		this.addCommand({
			id: "local-gpt-context-menu",
			name: "Local GPT: Show Actions...",
			// Simplified editorCallback signature
			editorCallback: (editor: Editor) => {
				this.contextMenuCurrentGroupId = this.settings.currentGroupId;
				// Show menu using fallback positioning (no mouse event from command palette)
				this.showActionContextMenu(editor);
			},
		});
		const currentActiveGroup = this.settings.actionGroups?.find(g => g?.id === this.settings.currentGroupId);
		if (currentActiveGroup?.actions) {
			logger.info(`Registering hotkey commands for action group: "${currentActiveGroup.name}"`);
			currentActiveGroup.actions.forEach((action) => {
				if (!action?.id || !action.name) return;
				const commandId = `local-gpt-action-${action.id}`;
				const commandName = `Local GPT: ${currentActiveGroup.name} - ${action.name}`;
				this.addCommand({
					id: commandId,
					name: commandName,
					editorCallback: (editor: Editor) => {
						logger.info(`Running action via hotkey: ${commandName}`);
						this.runAction(action, editor);
					},
				});
			});
		} else {
			logger.debug("No current active group selected or group has no actions. No action hotkey commands registered.");
		}
	}

	/**
	 * Gets the CodeMirror EditorView instance from the active Markdown editor.
	 * Returns undefined if the active view is not a Markdown view or the view can't be accessed.
	 */
	private getActiveEditorView(): EditorView | undefined {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			// The editor property is public on MarkdownView
			// Accessing the internal CodeMirror instance often involves casting or ignoring type checks
			// as the specific property ('cm' or similar) isn't guaranteed by the public API.
			// This approach uses a type assertion assuming 'cm' exists internally.
			const editorWithCm = activeView.editor as Editor & { cm?: EditorView };
			if (editorWithCm.cm instanceof EditorView) {
				return editorWithCm.cm;
			}
		}
		logger.error("getActiveEditorView: Could not get active CodeMirror EditorView.");
		return undefined;
	}


	/** Builds and displays the context menu */
	// Removed optional event parameter
	showActionContextMenu(editor: Editor): void {
		const editorView = this.getActiveEditorView(); // Use the helper function
		if (!editorView) {
			new Notice("Error showing context menu: Active editor view not found.");
			return;
		}

		const groups = this.settings.actionGroups;
		if (!groups?.length) { new Notice("No action groups configured."); return; }

		let currentGroupId = this.contextMenuCurrentGroupId ?? this.settings.currentGroupId;
		let currentGroupIndex = groups.findIndex(g => g?.id === currentGroupId);

		if (currentGroupIndex === -1) {
			currentGroupId = groups[0]?.id ?? null;
			currentGroupIndex = 0;
			this.contextMenuCurrentGroupId = currentGroupId;
		}

		const currentGroup = groups[currentGroupIndex];
		if (!currentGroup || !currentGroupId) { new Notice("Error finding current action group."); return; }

		const contextMenu = new Menu();

		// --- Group Header ---
		contextMenu.addItem(item => {
			item.setTitle(`Group: ${currentGroup.name}`)
				.setIcon('folder-open')
				.setDisabled(true)
				.setIsLabel(true);
		});

		// Instructional text item
		contextMenu.addItem(item => {
			item.setTitle("Shift-click an action for options")
				.setIcon('info')
				.setDisabled(true)
				.setIsLabel(true);
		});


		// --- Navigation ---
		if (groups.length > 1) {
			contextMenu.addSeparator();
			contextMenu.addItem((item: MenuItem) => {
				item.setTitle("⬅️ Previous Group").setIcon("arrow-left").onClick((evt: MouseEvent | KeyboardEvent) => {
					evt.stopPropagation();
					const newIndex = (currentGroupIndex - 1 + groups.length) % groups.length;
					this.contextMenuCurrentGroupId = groups[newIndex]?.id ?? null;
					this.showActionContextMenu(editor); // Don't pass event
				});
			});
			contextMenu.addItem((item: MenuItem) => {
				item.setTitle("Next Group ➡️").setIcon("arrow-right").onClick((evt: MouseEvent | KeyboardEvent) => {
					evt.stopPropagation();
					const newIndex = (currentGroupIndex + 1) % groups.length;
					this.contextMenuCurrentGroupId = groups[newIndex]?.id ?? null;
					this.showActionContextMenu(editor); // Don't pass event
				});
			});
			contextMenu.addSeparator();
		} else {
			contextMenu.addSeparator();
		}

		// --- Actions ---
		if (!currentGroup.actions || currentGroup.actions.length === 0) {
			contextMenu.addItem(item => item.setTitle("No actions in this group").setDisabled(true));
		} else {
			currentGroup.actions.forEach((action) => {
				if (!action) return;
				// Main Action Item
				contextMenu.addItem((item) => {
					item.setTitle(action.name)
						.setIcon(action.replace ? 'replace' : 'plus-circle') // Icon for Replace/Insert
						.onClick(async (evt: MouseEvent | KeyboardEvent) => {
							// Show spinner immediately on click
							// Use the reliably obtained editorView
							const spinnerOnClick = editorView?.plugin(spinnerPlugin) as SpinnerPlugin | undefined;
							if (spinnerOnClick) {
								try {
									const pos = editor.posToOffset(editor.getCursor("to"));
									spinnerOnClick.show(pos);
								} catch (e) { logger.error("Error showing spinner on click:", e); }
							} else {
								logger.warn("Could not get spinner instance on click.");
							}

							// Logic for Shift+Click or regular click
							const shiftPressed = evt.shiftKey;
							let temporaryProviderId: string | null | undefined = undefined;
							let temporaryTemperatureKey: string | null | undefined = undefined;
							let cancelled = false;

							const showProviderToggle = this.settings.showProviderInContextMenu ?? false;
							const showCreativityToggle = this.settings.showCreativityInContextMenu ?? false;

							if (shiftPressed || showProviderToggle) {
								temporaryProviderId = await this.promptForProviderOverride();
								if (temporaryProviderId === undefined) cancelled = true;
							}

							if (!cancelled && (shiftPressed || showCreativityToggle)) {
								temporaryTemperatureKey = await this.promptForCreativityOverride();
								if (temporaryTemperatureKey === undefined) cancelled = true;
							}

							if (!cancelled) {
								logger.info(`Running action "${action.name}" from context menu. Shift: ${shiftPressed}, ProvOverride: ${temporaryProviderId === undefined ? 'Not Prompted' : temporaryProviderId ?? 'Selected Default'}, TempOverride: ${temporaryTemperatureKey === undefined ? 'Not Prompted' : temporaryTemperatureKey ?? 'Selected Default'}`);
								this.runAction(action, editor, temporaryProviderId, temporaryTemperatureKey);
							} else {
								logger.warn(`Action "${action.name}" run cancelled due to override selection.`);
								if (spinnerOnClick) {
									try {
										const pos = editor.posToOffset(editor.getCursor("to"));
										spinnerOnClick.hide(pos); // Hide spinner if cancelled
									} catch(e) {/*ignore*/}
								}
							}
						});
				});
			});
		}
		// Always use fallback position calculation now
		contextMenu.showAtPosition(this.getMenuPosition(editorView, editor));
	}


	/** Prompts user to select a provider via modal */
	private async promptForProviderOverride(): Promise<string | null | undefined> {
		logger.debug("Prompting for provider override...");
		try {
			const aiSvcWaiter = await waitForAI();
			const aiSvc: IAIProvidersService = await aiSvcWaiter.promise;
			const allProviders = aiSvc.providers || [];
			if (!allProviders?.length) {
				new Notice("No AI providers available.");
				return undefined; // Indicate cancellation/failure
			}
			// Prepare choices for the modal
			const choices: ProviderChoice[] = [
				{ id: '__DEFAULT__', name: 'Default (Use Setting)', type: 'ollama', model: '', isDefault: true }, // Explicit default option
				// Filter SDK list for potential bad entries or duplicates of the explicit default
				...allProviders.filter(p => p && p.id && p.id !== '__DEFAULT__').map(p => ({ ...p }))
			];
			const selectedProvider = await new Promise<ProviderChoice | null>((resolve) => {
				new ProviderSuggestModal(this.app, choices, resolve).open();
			});

			if (selectedProvider === null) { // User pressed ESC or closed modal
				logger.debug("Provider selection cancelled or closed.");
				return undefined; // Indicate cancellation
			} else if (selectedProvider.id === '__DEFAULT__') {
				logger.debug("Default provider selected in override.");
				return null; // Indicate explicit default selection
			} else {
				logger.debug(`Override provider selected: ${selectedProvider.id}`);
				return selectedProvider.id; // Return the selected provider ID
			}
		} catch (err) {
			logger.error("Error showing provider selection modal:", err);
			new Notice("Could not show provider selection.");
			return undefined; // Indicate failure
		}
	}

	/** Prompts user to select a creativity level via modal */
	private async promptForCreativityOverride(): Promise<string | null | undefined> {
		logger.debug("Prompting for creativity override...");
		try {
			// Prepare choices including the default option
			const choices: CreativityChoice[] = [
				{ key: "__DEFAULT__", name: "Default (Use Setting)", isDefault: true },
				...Object.entries(CREATIVITY).map(([key, value]) => ({
					key: key,
					name: `${key.charAt(0).toUpperCase() + key.slice(1)} (~${value.temperature.toFixed(1)})`
				}))
			];
			const selectedCreativity = await new Promise<CreativityChoice | null>((resolve) => {
				new CreativitySuggestModal(this.app, choices, resolve).open();
			});

			if (selectedCreativity === null) { // User pressed ESC or closed modal
				logger.debug("Creativity selection cancelled or closed.");
				return undefined; // Indicate cancellation
			} else if (selectedCreativity.key === '__DEFAULT__') {
				logger.debug("Default creativity selected in override.");
				return null; // Indicate explicit default selection
			} else {
				logger.debug(`Override creativity selected: ${selectedCreativity.key}`);
				return selectedCreativity.key; // Return the selected creativity key
			}
		} catch (err) {
			logger.error("Error showing creativity selection modal:", err);
			new Notice("Could not show creativity selection.");
			return undefined; // Indicate failure
		}
	}

	/** Calculates the position for the context menu (Fallback Method) */
	getMenuPosition(editorView: EditorView, editor: Editor): { x: number; y: number } {
		logger.debug("Calculating fallback menu position based on cursor...");
		try {
			const cursorPos = editor.getCursor("head");
			const cursorOffset = editor.posToOffset(cursorPos);
			const cursorRect = editorView.coordsAtPos(cursorOffset);

			if (!cursorRect) throw new Error("Could not get coords for cursor position");

            // Initial position slightly below the cursor
			let x = cursorRect.left;
			let y = cursorRect.bottom + 5;

            // Viewport Clamping
            const menuWidth = 250; // Estimate menu width
            const menuHeight = 300; // Estimate menu height
            const buffer = 10; // Screen edge buffer

            if (x + menuWidth + buffer > window.innerWidth) {
                x = window.innerWidth - menuWidth - buffer;
            }
            if (y + menuHeight + buffer > window.innerHeight) {
                y = window.innerHeight - menuHeight - buffer;
            }
            x = Math.max(buffer, x);
            y = Math.max(buffer, y);

			return { x, y };
		} catch (e) {
			logger.error("Failed to get cursor coordinates for fallback menu position:", e);
			// Absolute fallback
			return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
		}
	}


	/** Executes the selected action with potential overrides */
	async runAction(
		action: LocalGPTAction,
		editor: Editor,
		temporaryProviderId: string | null | undefined = undefined,
		temporaryTemperatureKey: string | null | undefined = undefined
	): Promise<void> {

		// --- Setup ---
		// Get EditorView reliably
		const editorView = this.getActiveEditorView();
		if (!editorView) { return; } // Error handled in helper

		const spinner = editorView.plugin(spinnerPlugin) as SpinnerPlugin | undefined;
		if (!spinner) { logger.error("SpinnerPlugin instance not found."); new Notice("Error initializing action display."); return; }

		const cursorPositionTo = editor.getCursor("to");
		const spinnerPosition = editor.posToOffset(cursorPositionTo);
		let hideSpinner: (() => void) | null = null;

		// Show spinner at the beginning
		try {
			hideSpinner = spinner.show(spinnerPosition);
		} catch (e) {
			logger.error("Error showing spinner in runAction:", e);
			hideSpinner = null;
		}

		const selection = editor.getSelection();
		const selectedText = selection || editor.getValue();
		const cursorPositionFrom = editor.getCursor("from");
		const abortController = new AbortController();
		this.abortControllers.push(abortController);
		const imagesInBase64: string[] = []; // Placeholder

		logger.info(`Running action: "${action.name}" (ID: ${action.id})`);

		const cleanup = (abortedByUser = false) => {
			if (hideSpinner) {
				try { hideSpinner(); } catch (e) { logger.warn("Error hiding spinner:", e); }
				hideSpinner = null;
			}
			this.removeAbortController(abortController);
			if (abortedByUser) {
				new Notice("Action aborted.");
				logger.info(`Action "${action.name}" aborted by user.`);
			}
		};

		abortController.signal.addEventListener("abort", () => {
			cleanup(true);
		}, { once: true });


		try {
			// Get AI Providers Service AFTER showing spinner
			const aiRequestWaiter = await waitForAI();
			const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;
			const availableProviderIds = aiProviders.providers?.map(p => p.id) ?? [];
			logger.debug("Available Provider IDs:", availableProviderIds);


			// Determine Final Provider
			// (Logic remains the same as previous version)
			let providerIdToUse: string | null = null;
			const hasImages = imagesInBase64.length > 0;
			const globalMainProvider = this.settings.aiProviders.main;
			const globalVisionProvider = this.settings.aiProviders.vision;
			const actionProviderOverride = action.providerId;
			logger.debug("Determining Provider - Inputs:", { temporaryProviderId, actionProviderOverride, globalMainProvider, globalVisionProvider, hasImages });
			if (temporaryProviderId !== undefined) {
				providerIdToUse = temporaryProviderId;
				logger.debug(`Provider decision step 1: Using modal result: ${providerIdToUse === null ? "'Default' selected" : providerIdToUse}`);
			} else if (actionProviderOverride !== null) {
				providerIdToUse = actionProviderOverride;
				logger.debug(`Provider decision step 1: Using action setting override: ${providerIdToUse}`);
			} else {
				providerIdToUse = null;
				logger.debug(`Provider decision step 1: No override, intending global default.`);
			}
			if (providerIdToUse === null) {
				logger.debug("Provider decision step 2 (Resolving Default): Checking context...");
				if (hasImages && globalVisionProvider) {
					providerIdToUse = globalVisionProvider;
					logger.debug(`Provider decision step 2: Resolved to global Vision provider (images): ${providerIdToUse}`);
				} else {
					providerIdToUse = globalMainProvider;
					logger.debug(`Provider decision step 2: Resolved to global Main provider: ${providerIdToUse}`);
				}
			}
			if (!providerIdToUse) {
				logger.error("Provider determination failed: No Provider ID could be determined after fallbacks. Global Main Provider is likely unselected in settings.");
				new Notice("No AI provider selected. Please choose a 'Default Main Provider' in Local GPT settings.", 7000);
				throw new Error("No AI provider selected. Check settings.");
			}
			const provider = aiProviders.providers.find(p => p.id === providerIdToUse);
			if (!provider) {
				logger.error(`Provider validation failed: Resolved Provider ID "${providerIdToUse}" not found among available providers from SDK.`, { availableProviderIds });
				new Notice(`Error: Configured AI provider (ID: "${providerIdToUse}") not found or unavailable. Check AI Provider plugin settings or Local GPT settings.`, 7000);
				throw new Error(`Configured AI provider (ID: "${providerIdToUse}") not found or unavailable.`);
			}
			logger.info(`Using provider: ${provider.name} (ID: ${provider.id}, Model: ${provider.model || 'N/A'})`);

			// Prepare Context (RAG Placeholder)
			const context = "";

			// Determine Final Temperature
			// (Logic remains the same)
			let finalTemperature: number | undefined;
			let temperatureSource = "Unknown";
			const globalCreativityKey = this.settings.defaults.creativity || "balanced";
			const globalDefaultTemperature = CREATIVITY[globalCreativityKey]?.temperature ?? 1.0;
			if (temporaryTemperatureKey !== undefined) {
				if (temporaryTemperatureKey === null) {
					finalTemperature = globalDefaultTemperature;
					temperatureSource = `Global Default (via modal override: ${globalCreativityKey})`;
				} else if (CREATIVITY[temporaryTemperatureKey]) {
					finalTemperature = CREATIVITY[temporaryTemperatureKey].temperature;
					temperatureSource = `Modal Override (${temporaryTemperatureKey})`;
				} else {
					finalTemperature = globalDefaultTemperature;
					temperatureSource = `Global Default (invalid modal key "${temporaryTemperatureKey}")`;
					logger.warn(`Invalid temporary creativity key "${temporaryTemperatureKey}", using global default.`);
				}
			} else if (action.temperature !== null && CREATIVITY[action.temperature]) {
				finalTemperature = CREATIVITY[action.temperature].temperature;
				temperatureSource = `Action Setting (${action.temperature})`;
			} else {
				finalTemperature = globalDefaultTemperature;
				temperatureSource = `Global Default (${globalCreativityKey})`;
			}
			logger.info(`Using final temperature: ${finalTemperature?.toFixed(1)} (Source: ${temperatureSource})`);

			// Prepare Prompts
			const promptText = preparePrompt(action.prompt, selectedText, context);
			const systemPromptText = action.system || undefined;

			// Execute AI Call
			const executeOptions = {
				provider: provider,
				prompt: promptText,
				systemPrompt: systemPromptText,
				images: imagesInBase64,
				options: {
					temperature: finalTemperature,
				},
			};
			logger.debug("Executing AI request with options:", { ...executeOptions, prompt: promptText.substring(0, 100) + "...", images: imagesInBase64.length });

			const chunkHandler: IChunkHandler = await aiProviders.execute(executeOptions);

			let accumulatedText = "";
			let isThinking = false; // Track logical thinking state

			// Handles UI updates during streaming
			const onUpdate = (currentFullText: string) => {
				if (!spinner || abortController.signal.aborted) return;
				try {
					// Refined Thinking State Detection
					const thinkOpenIndex = currentFullText.lastIndexOf('<think>');
					const thinkCloseIndex = currentFullText.lastIndexOf('</think>');
					const isCurrentlyThinking = thinkOpenIndex !== -1 && thinkOpenIndex > thinkCloseIndex;

					// Update Spinner State BEFORE Content
					if (isCurrentlyThinking !== isThinking) {
						logger.debug(`Changing thinking state visual: ${isCurrentlyThinking}`);
						spinner.showThinking(isCurrentlyThinking, spinnerPosition);
						isThinking = isCurrentlyThinking;
					}

					// Calculate display text
					const displayText = currentFullText
						.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
						.replace(/<think>[\s\S]*$/, '');

					// Update content
					spinner.updateContent(displayText, spinnerPosition);

				} catch (e) { logger.error("Error during spinner update:", e); }
			};

			// Stream Handlers
			chunkHandler.onData((chunk: string, currentFullText: string) => {
				if (abortController.signal.aborted) {
					chunkHandler.abort(); return;
				}
				accumulatedText = currentFullText;
				onUpdate(accumulatedText);
			});

			chunkHandler.onEnd(() => {
				if (abortController.signal.aborted) {
					logger.warn("Stream ended, but action was aborted before output insertion.");
					return;
				}
				logger.info(`Action "${action.name}" stream finished.`);
				cleanup();

				let thinkingContent = "";
				const thinkMatch = accumulatedText.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
				if (thinkMatch?.[1]) {
					thinkingContent = thinkMatch[1].trim();
					logger.debug("Extracted thinking content:", thinkingContent.substring(0, 100) + "...");
				}
				const mainOutputText = removeThinkingTags(accumulatedText).trim();
				let finalOutput = "";
				if (thinkingContent) {
					finalOutput += `\`\`\`thoughts\n${thinkingContent}\n\`\`\`\n\n`;
				}
				finalOutput += mainOutputText;
				if (!finalOutput.trim()) {
					logger.warn("Final output is empty, nothing to insert/replace.");
					return;
				}
				try {
					if (action.replace) {
						logger.debug(`Replacing selection (${cursorPositionFrom.line},${cursorPositionFrom.ch} to ${cursorPositionTo.line},${cursorPositionTo.ch})`);
						editor.replaceRange(finalOutput, cursorPositionFrom, cursorPositionTo);
					} else {
						logger.debug(`Inserting output below line ${cursorPositionTo.line}`);
						const insertPos = { line: cursorPositionTo.line + 1, ch: 0 };
						const textToInsert = `\n${finalOutput.trim()}\n`;
						editor.replaceRange(textToInsert, insertPos);
					}
				} catch (insertError) {
					logger.error("Error replacing/inserting final text:", insertError);
					new Notice("Error inserting AI response.");
				}
			});

			chunkHandler.onError((error: Error) => {
				if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
					logger.warn(`Stream generation aborted (onError): ${error.message}`);
				} else {
					logger.error(`Error during AI stream generation:`, error);
					new Notice(`AI Provider Error: ${error.message}`, 7000);
					cleanup();
				}
			});

		} catch (error: unknown) { // Catch unknown for better type safety
			const errorMessage = (error instanceof Error) ? error.message : String(error);
			if (!errorMessage.startsWith("No AI provider selected") && !errorMessage.startsWith("Configured AI provider")) {
				logger.error(`Setup Error before executing action "${action.name}":`, error);
				new Notice(`Error starting action: ${errorMessage}`, 7000);
			}
			// Always cleanup if an error occurred before streaming started or during setup
			if (!abortController.signal.aborted) {
				cleanup();
			}
		}
	}

	// --- Lifecycle and Settings ---
	// (onunload, removeAbortController, Type Guards, loadSettings, escapeHandler, saveSettings remain unchanged)
	onunload(): void {
		logger.info("Unloading Local GPT Plugin...");
		this.abortControllers.forEach(controller => {
			try { controller.abort(); } catch (e) { /* ignore error during unload */ }
		});
		this.abortControllers = [];
		document.removeEventListener("keydown", this.escapeHandler);
		logger.info("Local GPT Plugin Unloaded.");
	}

	/** Removes a specific AbortController from the active list */
	private removeAbortController(controllerToRemove: AbortController): void {
		this.abortControllers = this.abortControllers.filter(c => c !== controllerToRemove);
	}

	// --- User Defined Type Guards ---
	private hasStringProperty<K extends string>(obj: unknown, prop: K): obj is Record<K, string> {
		return typeof obj === 'object' && obj !== null && prop in obj && typeof (obj as Record<K, unknown>)[prop] === 'string';
	}
	private hasNumberProperty<K extends string>(obj: unknown, prop: K): obj is Record<K, number> {
		return typeof obj === 'object' && obj !== null && prop in obj && typeof (obj as Record<K, unknown>)[prop] === 'number';
	}
	private isValidActionGroup(obj: unknown): obj is ActionGroup {
		return typeof obj === 'object' && obj !== null &&
			this.hasStringProperty(obj, 'id') &&
			this.hasStringProperty(obj, 'name') &&
			('actions' in obj) && Array.isArray((obj as ActionGroup).actions);
	}
	private isValidAction(obj: unknown): obj is LocalGPTAction {
		return typeof obj === 'object' && obj !== null &&
			this.hasStringProperty(obj, 'id') &&
			this.hasStringProperty(obj, 'name') &&
			this.hasStringProperty(obj, 'groupId') &&
			this.hasStringProperty(obj, 'prompt') &&
			this.hasStringProperty(obj, 'system') &&
			typeof (obj as LocalGPTAction).replace === 'boolean';
	}

	/** Loads plugin settings and performs migration if necessary */
	async loadSettings(): Promise<void> {
		logger.debug("Loading settings...");
		interface ActionV7 { name?: string; prompt?: string; system?: string; replace?: boolean; }
		interface SettingsV7 { _version: number; aiProviders?: { main?: string | null; embedding?: string | null; vision?: string | null; }; defaults?: { creativity?: string; }; actions?: ActionV7[]; }

		try {
			const loadedData: unknown = await this.loadData();
			let migrationNeeded = false;
			const currentVersion: number = this.hasNumberProperty(loadedData, '_version') ? loadedData._version : 0;
			logger.info(`Loaded settings data version: ${currentVersion}`);

			if (currentVersion < 7) {
				logger.warn(`Settings version ${currentVersion} is too old (< 7). Resetting to defaults.`);
				this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
				migrationNeeded = true;
			} else if (currentVersion === 7) {
				logger.info("Migrating settings from v7 to v8...");
				const oldSettings = loadedData as SettingsV7;
				const newSettings: LocalGPTSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
				if (oldSettings.aiProviders) {
					newSettings.aiProviders.main = oldSettings.aiProviders.main ?? null;
					newSettings.aiProviders.embedding = oldSettings.aiProviders.embedding ?? null;
					newSettings.aiProviders.vision = oldSettings.aiProviders.vision ?? null;
					logger.debug("Migrated provider IDs:", newSettings.aiProviders);
				}
				if (oldSettings.defaults?.creativity && CREATIVITY[oldSettings.defaults.creativity]) {
					newSettings.defaults.creativity = oldSettings.defaults.creativity;
					logger.debug("Migrated default creativity:", newSettings.defaults.creativity);
				}
				if (Array.isArray(oldSettings.actions) && oldSettings.actions.length > 0) {
					logger.debug(`Found ${oldSettings.actions.length} actions in v7 settings.`);
					const defaultGroupId = newSettings.actionGroups[0]?.id ?? uuidv4();
					if (!newSettings.actionGroups[0]) {
						newSettings.actionGroups.push({ id: defaultGroupId, name: "General (Migrated)", actions: [] });
						logger.debug("Created new default group for migration.");
					} else {
						newSettings.actionGroups[0].name = "General (Migrated)";
						logger.debug(`Using existing default group (ID: ${defaultGroupId}), renamed.`);
					}
					newSettings.actionGroups[0].actions = (oldSettings.actions)
						.filter((oldAction: ActionV7): oldAction is Required<ActionV7> & { name: string } =>
							oldAction && typeof oldAction.name === 'string' && oldAction.name.trim() !== ''
						)
						.map((oldAction): LocalGPTAction => ({
							id: uuidv4(), groupId: defaultGroupId, name: oldAction.name,
							prompt: oldAction.prompt || "", system: oldAction.system || "",
							replace: oldAction.replace ?? false, providerId: null, temperature: null,
						}));
					logger.info(`Migrated ${newSettings.actionGroups[0].actions.length} valid actions to group "${newSettings.actionGroups[0].name}".`);
				} else {
					logger.debug("No actions found in v7 settings to migrate.");
				}
				newSettings._version = 8;
				this.settings = newSettings;
				migrationNeeded = true;
			} else { // v8 or newer
				logger.debug(`Loading settings version ${currentVersion}. Applying defaults for missing properties.`);
				const tempSettings: LocalGPTSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
				const loadedObject = (typeof loadedData === 'object' && loadedData !== null) ? loadedData : {};
				for (const key in loadedObject) {
					if (Object.prototype.hasOwnProperty.call(loadedObject, key)) {
						const loadedValue = (loadedObject as Record<string, unknown>)[key];
						if (loadedValue !== undefined && key !== 'aiProviders' && key !== 'defaults' && key !== 'actionGroups') {
							(tempSettings as unknown as Record<string, unknown>)[key] = loadedValue;
						}
					}
				}
				const loadedProviders = (loadedObject as Partial<LocalGPTSettings>).aiProviders;
				if (typeof loadedProviders === 'object' && loadedProviders !== null) {
					tempSettings.aiProviders = { ...tempSettings.aiProviders, ...loadedProviders };
				}
				const loadedDefaults = (loadedObject as Partial<LocalGPTSettings>).defaults;
				if (typeof loadedDefaults === 'object' && loadedDefaults !== null) {
					tempSettings.defaults = { ...tempSettings.defaults, ...loadedDefaults };
				}
				const loadedActionGroups = (loadedObject as Partial<LocalGPTSettings>).actionGroups;
				if (Array.isArray(loadedActionGroups)) {
					logger.debug("Loaded 'actionGroups' is an array. Validating and merging...");
					const validatedGroups = loadedActionGroups
						.filter(this.isValidActionGroup)
						.map((g): ActionGroup => {
							logger.debug(`Validating group: ${g.name} (ID: ${g.id})`);
							const validatedActions = Array.isArray(g.actions) ? g.actions.filter(this.isValidAction) : [];
							if (Array.isArray(g.actions) && validatedActions.length !== g.actions.length) {
								logger.warn(`Group "${g.name}": Filtered out ${g.actions.length - validatedActions.length} invalid actions.`);
							}
							return { ...g, actions: validatedActions };
						});
					if (validatedGroups.length > 0) {
						tempSettings.actionGroups = validatedGroups;
						logger.debug(`Successfully merged ${validatedGroups.length} valid action groups.`);
						if (validatedGroups.length !== loadedActionGroups.length) {
							logger.warn(`Filtered out ${loadedActionGroups.length - validatedGroups.length} invalid groups during merge.`);
						}
					} else {
						logger.warn("Loaded 'actionGroups' array contained no valid groups. Using default group structure.");
						migrationNeeded = true;
					}
				} else if (loadedActionGroups !== undefined) {
					logger.warn("Loaded 'actionGroups' is not an array. Using default group structure.");
					migrationNeeded = true;
				}
				tempSettings._version = DEFAULT_SETTINGS._version;
				this.settings = tempSettings;
			}

			// --- Sanity Checks After Load/Migration ---
			if (!this.settings.actionGroups || this.settings.actionGroups.length === 0) {
				logger.warn("CRITICAL: No valid action groups found after load/migration. Resetting to single default group.");
				const defaultGroup = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.actionGroups[0]));
				defaultGroup.id = uuidv4();
				defaultGroup.actions.forEach((a: LocalGPTAction) => { a.id = uuidv4(); a.groupId = defaultGroup.id; });
				this.settings.actionGroups = [defaultGroup];
				migrationNeeded = true;
			} else {
				this.settings.actionGroups.forEach(g => {
					logger.debug(`Loaded Group: "${g.name}" (ID: ${g.id}), Actions: ${g.actions?.length ?? 0}`);
				});
			}
			if (!this.settings.currentGroupId || !this.settings.actionGroups.some(g => g.id === this.settings.currentGroupId)) {
				logger.warn(`Current group ID "${this.settings.currentGroupId}" is invalid or group not found. Resetting to first available group.`);
				this.settings.currentGroupId = this.settings.actionGroups[0]?.id ?? null;
				migrationNeeded = true;
			}
			if (!this.settings.defaults.creativity || !CREATIVITY[this.settings.defaults.creativity]) {
				logger.warn(`Invalid default creativity "${this.settings.defaults.creativity}". Resetting to "${DEFAULT_SETTINGS.defaults.creativity}".`);
				this.settings.defaults.creativity = DEFAULT_SETTINGS.defaults.creativity;
				migrationNeeded = true;
			}
			this.settings.showProviderInContextMenu = this.settings.showProviderInContextMenu ?? false;
			this.settings.showCreativityInContextMenu = this.settings.showCreativityInContextMenu ?? false;

			if (migrationNeeded) {
				logger.info("Saving migrated/corrected settings.");
				await this.saveSettings();
			}
			logger.debug("Settings loaded successfully.", JSON.parse(JSON.stringify(this.settings)));

		} catch (error) {
			logger.error("CRITICAL FAILURE during settings load/migration:", error);
			this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
			logger.warn("Using default settings due to CRITICAL loading/migration error.");
			try { await this.saveSettings(); } catch (saveError) { logger.error("Failed to save default settings after load error:", saveError); }
		}
	}

	/** Handles the Escape key to abort ongoing actions */
	escapeHandler = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			if (this.abortControllers.length > 0) {
				logger.warn(`Escape key pressed. Aborting ${this.abortControllers.length} active action(s).`);
				const controllersToAbort = [...this.abortControllers];
				controllersToAbort.forEach(controller => {
					try {
						if (!controller.signal.aborted) { controller.abort(); }
					} catch (e) { logger.error("Error aborting controller on ESC:", e); }
				});
				this.abortControllers = [];
			}
		}
	};

	/** Saves the current plugin settings */
	async saveSettings(): Promise<void> {
		logger.debug("Saving settings...");
		await this.saveData(this.settings);
		this.reload();
		logger.debug("Settings saved.");
	}
}

// --- END OF FILE main.ts ---