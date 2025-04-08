// --- START OF FILE LocalGPTSettingTab.ts ---

import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
	TextComponent,
	// Removed unused component imports: DropdownComponent, ToggleComponent, ButtonComponent, ExtraButtonComponent
	Modal,
	debounce,
	Debouncer
} from "obsidian";
import { waitForAI, IAIProvidersService } from "@obsidian-ai-providers/sdk";
import { v4 as uuidv4 } from 'uuid';

import { CREATIVITY, DEFAULT_SETTINGS, SELECTION_KEYWORD, CONTEXT_KEYWORD } from "defaultSettings";
import LocalGPT from "./main";
import { LocalGPTAction, ActionGroup /*, LocalGPTSettings*/ } from "./interfaces"; // LocalGPTSettings is used implicitly via plugin.settings
import { logger } from "./logger";

// Constants
const QUICK_ADD_SEPARATOR = "✂️";
type SettableActionKeys = 'name' | 'system' | 'prompt' | 'providerId' | 'temperature' | 'replace';
const QUICK_ADD_MAPPING: { [K in SettableActionKeys]?: string } = { name: "Name: ", system: "System: ", prompt: "Prompt: ", replace: "Replace: ", providerId: "ProviderID: ", temperature: "Creativity: " };

// Modals
class ConfirmModal extends Modal { constructor( app: App, readonly title: string, readonly message: string, readonly onConfirm: () => void | Promise<void>, readonly confirmButtonText: string = "Confirm", readonly confirmButtonClass: string = "mod-warning", ) { super(app); } onOpen() { const { contentEl, title, message, confirmButtonText, confirmButtonClass } = this; contentEl.createEl("h2", { text: title }); contentEl.createEl("p", { text: message }); new Setting(contentEl) .addButton((btn) => btn .setButtonText("Cancel") .onClick(() => this.close()) ) .addButton((btn) => btn .setButtonText(confirmButtonText) .setClass(confirmButtonClass) .onClick(async () => { try { await this.onConfirm(); } catch (e) { logger.error("Error during modal confirm:", e); new Notice("Operation failed. Check console."); } finally { this.close(); } }) ); } onClose() { this.contentEl.empty(); } }
class InputModal extends Modal { result: string; onSubmit: (result: string) => void | Promise<void>; inputComponent: TextComponent; constructor(app: App, public title: string, public initialValue: string = "", onSubmit: (result: string) => void | Promise<void>) { super(app); this.onSubmit = onSubmit; this.result = initialValue; } onOpen() { const { contentEl, title } = this; contentEl.createEl("h2", { text: title }); new Setting(contentEl) .setName("New name") .addText((text) => { this.inputComponent = text; text.setValue(this.initialValue) .onChange((value) => { this.result = value; }); text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } }); }); new Setting(contentEl) .addButton((btn) => btn .setButtonText("Cancel") .onClick(() => this.close())) .addButton((btn) => btn .setButtonText("Save") .setCta() .onClick(() => this.submit())); setTimeout(() => this.inputComponent?.inputEl.focus(), 50); } async submit() { try { await this.onSubmit(this.result.trim()); } catch (e) { logger.error("Error during modal submit:", e); new Notice("Operation failed. Check console."); } finally { this.close(); } } onClose() { this.contentEl.empty(); } }

// Main Settings Tab Class
export class LocalGPTSettingTab extends PluginSettingTab {
	plugin: LocalGPT;

	// Dropdown options caches
	private availableProviders: { id: string; name: string }[] = [];
	private providerOptions: Record<string, string> = {};
	private providerOptionsWithDefault: Record<string, string> = {};
	private creativityOptions: Record<string, string> = {};
	private creativityOptionsWithDefault: Record<string, string> = {};
	private groupOptions: Record<string, string> = {};

	// Declare debouncedSave with correct type
	private debouncedSave: Debouncer<[], Promise<void>>;

	constructor(app: App, plugin: LocalGPT) {
		super(app, plugin);
		this.plugin = plugin;
		this.debouncedSave = debounce(this.plugin.saveSettings.bind(this.plugin), 500, true);
		this.plugin.state = this.plugin.state ?? {};
		this.plugin.state.editingActionId = this.plugin.state.editingActionId ?? null;
		this.plugin.state.reorderingGroupId = this.plugin.state.reorderingGroupId ?? null;
	}

	// Prepare dropdown options
	private prepareDropdownOptions() {
		this.providerOptions = this.availableProviders.reduce((acc, provider) => { acc[provider.id] = provider.name; return acc; }, { "": "--- Select Provider ---" } as Record<string, string>);
		this.providerOptionsWithDefault = this.availableProviders.reduce((acc, provider) => { acc[provider.id] = provider.name; return acc; }, { "": "Default (Use Global Setting)" } as Record<string, string>);
		this.creativityOptions = Object.entries(CREATIVITY).reduce((acc, [key, value]) => { acc[key] = `${key.charAt(0).toUpperCase() + key.slice(1)} (~${value.temperature.toFixed(1)})`; return acc; }, {} as Record<string, string>);
		this.creativityOptionsWithDefault = Object.entries(CREATIVITY).reduce((acc, [key, value]) => { acc[key] = `${key.charAt(0).toUpperCase() + key.slice(1)} (~${value.temperature.toFixed(1)})`; return acc; }, { "": "Default (Use Global Setting)" } as Record<string, string>);
		this.groupOptions = (this.plugin.settings.actionGroups || []).reduce((acc, group) => { if (group?.id && group.name) acc[group.id] = group.name; return acc; }, {} as Record<string, string>);
	}

	// Find action and group by ID
	private findActionAndGroup(actionId: string | null | undefined): { group: ActionGroup | undefined, action: LocalGPTAction | undefined, groupIndex: number, actionIndex: number } {
		if (!actionId || !this.plugin.settings.actionGroups) { return { group: undefined, action: undefined, groupIndex: -1, actionIndex: -1 }; }
		for (let groupIndex = 0; groupIndex < this.plugin.settings.actionGroups.length; groupIndex++) {
			const group = this.plugin.settings.actionGroups[groupIndex];
			if (!group?.actions) continue;
			const actionIndex = group.actions.findIndex(a => a?.id === actionId);
			if (actionIndex > -1) { const action = group.actions[actionIndex]; if (action) { return { group, action, groupIndex, actionIndex }; } }
		}
		return { group: undefined, action: undefined, groupIndex: -1, actionIndex: -1 };
	}

	// Create the description fragment for an action item
	private createActionDescriptionFragment(action: LocalGPTAction): DocumentFragment {
		const fragment = document.createDocumentFragment();
		const maxLen = 80;
		const addDescLine = (label: string, value: string | undefined | null, fullTitle?: string | null) => { if (value && value.trim()) { const lineDiv = fragment.createDiv({ cls: 'setting-item-description-line' }); lineDiv.createEl('strong', { text: `${label}: ` }); const truncatedValue = value.length > maxLen ? value.substring(0, maxLen - 3) + '...' : value; lineDiv.appendText(truncatedValue); if (fullTitle || (value.length > maxLen)) { lineDiv.title = fullTitle || value; } } };
		const tagContainer = fragment.createDiv({ cls: 'setting-item-tags-container' });
		const addTag = (text: string) => { tagContainer.createSpan({ text: text, cls: 'local-gpt-setting-tag' }); };

		addDescLine('System', action.system);
		addDescLine('Prompt', action.prompt);

		// Check if overrides exist
		const hasProviderOverride = !!action.providerId;
		// Ensure temperature is a valid key before considering it an override
		const hasCreativityOverride = action.temperature != null && this.creativityOptions[action.temperature];
		const hasReplace = action.replace;

		// Add tags for existing overrides/modes
		// Check for null before indexing options
		if (hasProviderOverride && action.providerId !== null) {
			const providerName = this.providerOptions[action.providerId] || `ID: ${action.providerId}`;
			addTag(`Provider: ${providerName.substring(0, 30)}${providerName.length > 30 ? '...' : ''}`);
		}
		if (hasCreativityOverride && action.temperature !== null) {
			addTag(`Creativity: ${this.creativityOptions[action.temperature]}`);
		}
		if (hasReplace) { addTag('Mode: Replace'); }

		// Append tag container only if it has tags
		if (tagContainer.hasChildNodes()) {
			if (fragment.querySelector('.setting-item-description-line')) {
				fragment.createDiv({ cls: 'setting-item-description-spacer' });
			}
			fragment.appendChild(tagContainer);
		}
		return fragment;
	}

	// Copy action details to clipboard string
	private copyActionToString(action: LocalGPTAction) { const parts: string[] = []; for (const key in QUICK_ADD_MAPPING) { const typedKey = key as keyof typeof QUICK_ADD_MAPPING; const prefix = QUICK_ADD_MAPPING[typedKey]; const value = action[typedKey as keyof LocalGPTAction]; if (prefix && value !== undefined && value !== null && value !== '') { if (typedKey === 'replace') { if (value === true) parts.push(`${prefix}true`); } else if (typedKey === 'temperature') { if (typeof value === 'string' && CREATIVITY[value]) parts.push(`${prefix}${value}`); } else if (typeof value === 'string' && value.trim()) { parts.push(`${prefix}${value}`); } } } const actionString = parts.join(` ${QUICK_ADD_SEPARATOR}\n`); navigator.clipboard.writeText(actionString).then(() => new Notice(`Copied action "${action.name}" to clipboard.`)).catch(err => { logger.error("Failed to copy action string:", err); new Notice("Error copying action."); }); }

	// Handle the logic for Quick Add
	private async handleQuickAdd(inputValue: string, textComponent: TextAreaComponent) { if (!inputValue) return; logger.debug("Handling Quick Add:", inputValue); const targetGroup = this.plugin.settings.actionGroups?.[0]; if (!targetGroup) { new Notice("Error: No action groups exist to add the action to."); return; } const newAction: Partial<LocalGPTAction> & { id: string, groupId: string } = { id: uuidv4(), groupId: targetGroup.id, name: "", prompt: "", system: "", replace: false, providerId: null, temperature: null, }; const parts = inputValue.split(QUICK_ADD_SEPARATOR); let nameFound = false; for (const part of parts) { const trimmedPart = part.trim(); let foundKey = false; for (const key in QUICK_ADD_MAPPING) { const typedKey = key as keyof typeof QUICK_ADD_MAPPING; const prefix = QUICK_ADD_MAPPING[typedKey]; if (prefix && trimmedPart.startsWith(prefix)) { const value = trimmedPart.substring(prefix.length).trim(); switch (typedKey) { case 'replace': newAction.replace = value.toLowerCase() === 'true'; break; case 'temperature': newAction.temperature = CREATIVITY[value] ? value : null; break; case 'name': case 'prompt': case 'system': case 'providerId': newAction[typedKey] = value; break; } if (typedKey === 'name') nameFound = true; foundKey = true; break; } } if (!foundKey && trimmedPart) { logger.warn(`Quick Add: Ignoring unrecognized part: "${trimmedPart}"`); } } if (!nameFound || !newAction.name) { new Notice("Quick Add Error: Action 'Name:' field is required."); return; } if (newAction.providerId === "") newAction.providerId = null; const existingIndex = targetGroup.actions.findIndex(a => a?.name === newAction.name); if (existingIndex !== -1) { targetGroup.actions[existingIndex] = { ...targetGroup.actions[existingIndex], ...newAction, id: targetGroup.actions[existingIndex].id, groupId: targetGroup.actions[existingIndex].groupId, }; new Notice(`Action "${newAction.name}" updated in group "${targetGroup.name}".`); } else { const completeAction: LocalGPTAction = { id: newAction.id, groupId: newAction.groupId, name: newAction.name, prompt: newAction.prompt ?? "", system: newAction.system ?? "", replace: newAction.replace ?? false, providerId: newAction.providerId ?? null, temperature: newAction.temperature ?? null, }; targetGroup.actions.push(completeAction); new Notice(`Action "${newAction.name}" added to group "${targetGroup.name}".`); } await this.plugin.saveSettings(); textComponent.setValue(""); this.display(); }

	// --- Main Rendering Methods ---

	// display: Fetches providers, prepares options, and renders sections
	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h1", { text: "Local GPT Settings" });

		try {
			logger.debug("Fetching AI providers for settings tab...");
			const aiSvcWaiter = await waitForAI();
			const aiSvc: IAIProvidersService = await aiSvcWaiter.promise;
			this.availableProviders = (aiSvc.providers || [])
				.map((p) => ({ id: p.id, name: p.model ? `${p.name} (${p.model})` : p.name }))
				.sort((a, b) => a.name.localeCompare(b.name));
			this.prepareDropdownOptions();
			logger.debug(`Found ${this.availableProviders.length} providers.`);

			this.renderProviderSettings(containerEl.createDiv());
			containerEl.createEl('hr');
			this.renderDefaultSettings(containerEl.createDiv());
			containerEl.createEl('hr');

			const editingId = this.plugin.state?.editingActionId;
			if (editingId) {
				const { action } = this.findActionAndGroup(editingId);
				if (action) { this.renderEditForm(containerEl.createDiv(), action); }
				else { logger.error(`Edit Action Error: Action ID ${editingId} not found.`); if (this.plugin.state) this.plugin.state.editingActionId = null; this.renderNormalView(containerEl); }
			} else { this.renderNormalView(containerEl); }

			containerEl.createEl('hr');
			this.renderDangerZone(containerEl.createDiv());

		} catch (error) {
			logger.error("Error displaying settings tab:", error);
			containerEl.createEl("h2", { text: "Error Loading Settings" });
			containerEl.createEl("p", { text: "Could not fetch AI providers or render settings. Check the console (Ctrl+Shift+I) for details." });
			if (error instanceof Error) { containerEl.createEl("pre", { text: error.message }); }
		}
	}

	// renderNormalView: Renders sections when not editing
	private renderNormalView(containerEl: HTMLElement) {
		this.renderActionGroupManagement(containerEl.createDiv());
		this.renderQuickAdd(containerEl.createDiv());
		this.renderActionListHeader(containerEl.createDiv());
		this.renderActionList(containerEl.createDiv());
	}

	// renderProviderSettings: Section for default provider selection
	private renderProviderSettings(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "AI Provider Settings" });
		containerEl.createEl("p", { cls: "setting-item-description", text: "Select default AI providers. Can be overridden per action." });
		new Setting(containerEl).setName("Default Main Provider").addDropdown((dd) => { dd.addOptions(this.providerOptions).setValue(this.plugin.settings.aiProviders.main || "").onChange(async (val) => { this.plugin.settings.aiProviders.main = val || null; await this.debouncedSave(); }); dd.selectEl.title = this.availableProviders.map(p => `${p.name} (ID: ${p.id})`).join('\n'); });
		new Setting(containerEl).setName("Default Embedding Provider").addDropdown((dd) => { dd.addOptions(this.providerOptions).setValue(this.plugin.settings.aiProviders.embedding || "").onChange(async (val) => { this.plugin.settings.aiProviders.embedding = val || null; await this.debouncedSave(); }); dd.selectEl.title = this.availableProviders.map(p => `${p.name} (ID: ${p.id})`).join('\n'); });
		new Setting(containerEl).setName("Default Vision Provider").addDropdown((dd) => { dd.addOptions(this.providerOptions).setValue(this.plugin.settings.aiProviders.vision || "").onChange(async (val) => { this.plugin.settings.aiProviders.vision = val || null; await this.debouncedSave(); }); dd.selectEl.title = this.availableProviders.map(p => `${p.name} (ID: ${p.id})`).join('\n'); });
	}

	// renderDefaultSettings: Section for default creativity and context menu toggles
	private renderDefaultSettings(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Default Behavior" });
		new Setting(containerEl).setName("Default Creativity").setDesc("Controls AI 'temperature'. Higher = more creative/random.").addDropdown((dd) => { dd.addOptions(this.creativityOptions).setValue(this.plugin.settings.defaults.creativity || "balanced").onChange(async (val) => { if (CREATIVITY[val]) { this.plugin.settings.defaults.creativity = val; } else { this.plugin.settings.defaults.creativity = DEFAULT_SETTINGS.defaults.creativity; dd.setValue(this.plugin.settings.defaults.creativity); logger.warn(`Invalid creativity key "${val}" selected, falling back to default.`); } await this.debouncedSave(); }); });
		new Setting(containerEl).setName("Show Provider Choice in Context Menu").setDesc("Always ask for provider via modal (like Shift+Click).").addToggle((toggle) => { toggle.setValue(this.plugin.settings.showProviderInContextMenu).onChange(async (val) => { this.plugin.settings.showProviderInContextMenu = val; await this.debouncedSave(); }); });
		new Setting(containerEl).setName("Show Creativity Choice in Context Menu").setDesc("Always ask for creativity via modal (like Shift+Click).").addToggle((toggle) => { toggle.setValue(this.plugin.settings.showCreativityInContextMenu).onChange(async (val) => { this.plugin.settings.showCreativityInContextMenu = val; await this.debouncedSave(); }); });
	}

	// renderActionGroupManagement: Section for Add/Rename/Delete groups
	private renderActionGroupManagement(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Action Groups" });
		new Setting(containerEl).setName("Manage Action Groups").addButton((button) => { button.setButtonText("Add New Group").setIcon("plus-circle").onClick(async () => { const newId = uuidv4(); let newName = "New Group"; let count = 1; while (this.plugin.settings.actionGroups.some(g => g.name === newName)) { count++; newName = `New Group ${count}`; } const newGroup: ActionGroup = { id: newId, name: newName, actions: [] }; this.plugin.settings.actionGroups.push(newGroup); await this.plugin.saveSettings(); this.prepareDropdownOptions(); this.display(); new Notice(`Added group: ${newGroup.name}`); }); });
		(this.plugin.settings.actionGroups || []).forEach((group, index) => { if (!group) return; new Setting(containerEl).setName(group.name).setClass("local-gpt-settings-group-item").addButton((button) => { button.setTooltip("Rename Group").setIcon("pencil").onClick(() => { const modal = new InputModal(this.app, "Rename Group", group.name, async (newName) => { if (newName && newName !== group.name) { if (this.plugin.settings.actionGroups.some(g => g.id !== group.id && g.name === newName.trim())) { new Notice(`A group named "${newName.trim()}" already exists.`); return; } group.name = newName.trim(); await this.plugin.saveSettings(); this.prepareDropdownOptions(); this.display(); new Notice(`Renamed group to: ${group.name}`); } }); modal.open(); }); }).addButton((button) => { button.setTooltip("Delete Group").setIcon("trash").setClass("mod-warning").setDisabled(this.plugin.settings.actionGroups.length <= 1).onClick(() => { if (this.plugin.settings.actionGroups.length <= 1) { new Notice("Cannot delete the last action group."); return; } const confirmModal = new ConfirmModal( this.app, "Delete Group?", `Are you sure you want to delete the group "${group.name}"? All actions within it will also be deleted. This cannot be undone.`, async () => { this.plugin.settings.actionGroups.splice(index, 1); if (this.plugin.settings.currentGroupId === group.id) { this.plugin.settings.currentGroupId = this.plugin.settings.actionGroups[0]?.id ?? null; } await this.plugin.saveSettings(); this.prepareDropdownOptions(); this.display(); new Notice(`Deleted group: ${group.name}`); } ); confirmModal.open(); }); }); });
	}

	// renderQuickAdd: Section for pasting action strings
	private renderQuickAdd(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Quick Add Action" });
		const setting = new Setting(containerEl).setName("Paste Action String");
		// Build description using descEl
		setting.descEl.appendText(`Paste a shared action string here (separated by "${QUICK_ADD_SEPARATOR}").`);
		setting.descEl.createEl('br');
		setting.descEl.appendText(`It will be added to the `);
		setting.descEl.createEl('strong', {text: `"${this.plugin.settings.actionGroups[0]?.name ?? 'first'}"`});
		setting.descEl.appendText(` group.`);
		setting.descEl.createEl('br');
		setting.descEl.appendText(`If an action with the same name exists in that group, it will be `);
		setting.descEl.createEl('strong', { text: `overwritten.`});
		setting.addTextArea((text) => {
				text.inputEl.style.width = "100%"; text.inputEl.rows = 3;
				text.setPlaceholder(`Example:\nName: My Action ${QUICK_ADD_SEPARATOR} Prompt: Do something`);
				text.onChange(debounce(async (value) => { if (value && value.includes(QUICK_ADD_SEPARATOR)) { await this.handleQuickAdd(value, text); } }, 300));
			});
	}

	// renderActionListHeader: Section header with Reorder/Done button
	private renderActionListHeader(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Actions" });
		const reorderingGroupId = this.plugin.state?.reorderingGroupId;
		const isReordering = !!reorderingGroupId;
		const currentGroupName = this.plugin.settings.actionGroups.find(g => g.id === reorderingGroupId)?.name;
		new Setting(containerEl).setName(isReordering ? `Reordering "${currentGroupName ?? 'Unknown Group'}"` : "Reorder Actions").setDesc(isReordering ? "Click 'Done' when finished reordering actions." : "Click to enable reordering for the selected group.").addButton((button) => {
			button.setButtonText(isReordering ? "Done" : "Reorder")
				.setIcon(isReordering ? "check" : "move")
				// *** FIX: Use toggleClass instead of setClass ***
				.onClick(() => {
					if (this.plugin.state) {
						this.plugin.state.reorderingGroupId = isReordering ? null : this.plugin.settings.currentGroupId;
					}
					this.display();
				});
			// Apply the 'mod-cta' class conditionally *after* creating the button
			button.buttonEl.toggleClass("mod-cta", isReordering);
		});
	}

	// renderActionList: Renders groups and their actions
	private renderActionList(containerEl: HTMLElement): void {
		const groups = this.plugin.settings.actionGroups || [];
		const reorderingGroupId = this.plugin.state?.reorderingGroupId;
		if (!groups.length) { containerEl.createEl('p', { text: "No action groups defined.", cls: 'setting-item-description' }); return; }
		groups.forEach((group, groupIndex) => { if (!group) return; const groupContainer = containerEl.createDiv({ cls: 'local-gpt-settings-group' }); const isReorderingThisGroup = reorderingGroupId === group.id; new Setting(groupContainer).setHeading().setName(group.name).addExtraButton((button) => { button.setIcon("plus").setTooltip(`Add new action to "${group.name}"`).onClick(() => { const newAction: LocalGPTAction = { id: uuidv4(), groupId: group.id, name: "New Action", prompt: "", system: "", replace: false, providerId: null, temperature: null, }; group.actions = group.actions || []; group.actions.push(newAction); if (this.plugin.state) this.plugin.state.editingActionId = newAction.id; this.plugin.saveSettings(); this.display(); }); }); const actions = group.actions || []; if (actions.length === 0) { groupContainer.createEl('p', { text: "No actions in this group.", cls: 'local-gpt-settings-empty-group' }); } else { actions.forEach((action, actionIndex) => { if (!action) return; this.renderActionItem(groupContainer, action, groupIndex, actionIndex, isReorderingThisGroup); }); } });
	}

	// renderActionItem: Renders a single action row with appropriate buttons
	private renderActionItem(containerEl: HTMLElement, action: LocalGPTAction, groupIndex: number, actionIndex: number, isReorderingThisGroup: boolean): void {
		const setting = new Setting(containerEl).setName(action.name || "Untitled Action");
		setting.descEl.appendChild(this.createActionDescriptionFragment(action)); // Use helper for description

		if (isReorderingThisGroup) { // Reordering Buttons
			setting.addExtraButton((button) => { button.setIcon('arrow-up').setTooltip('Move up').setDisabled(actionIndex === 0).onClick(async () => { if (actionIndex > 0) { const group = this.plugin.settings.actionGroups[groupIndex]; if (!group?.actions) return; [group.actions[actionIndex - 1], group.actions[actionIndex]] = [group.actions[actionIndex], group.actions[actionIndex - 1]]; await this.plugin.saveSettings(); this.display(); } }); })
			.addExtraButton((button) => { button.setIcon('arrow-down').setTooltip('Move down').setDisabled(actionIndex === this.plugin.settings.actionGroups[groupIndex].actions.length - 1).onClick(async () => { const group = this.plugin.settings.actionGroups[groupIndex]; if (!group?.actions || actionIndex >= group.actions.length - 1) return; [group.actions[actionIndex + 1], group.actions[actionIndex]] = [group.actions[actionIndex], group.actions[actionIndex + 1]]; await this.plugin.saveSettings(); this.display(); }); });
		} else { // Normal Buttons
			setting.addExtraButton((button) => { button.setIcon('copy').setTooltip('Copy action string').onClick(() => { this.copyActionToString(action); }); })
			.addExtraButton((button) => { button.setIcon('pencil').setTooltip('Edit action').onClick(() => { if (this.plugin.state) this.plugin.state.editingActionId = action.id; this.display(); }); });
		}
	}

	// renderEditForm: Renders the form for editing/creating an action
	private renderEditForm(containerEl: HTMLElement, action: LocalGPTAction): void {
		containerEl.createEl("h2", { text: action.name ? `Edit Action: ${action.name}` : "Create New Action" });
		containerEl.addClass("local-gpt-edit-form");
		// Use const as tempAction object reference is not reassigned
		const tempAction: LocalGPTAction = JSON.parse(JSON.stringify(action)); // Work on a copy

		// Form Fields
		new Setting(containerEl).setName("Action Name").setDesc("Unique name (within group).").addText((text) => { text.setValue(tempAction.name).setPlaceholder("e.g., Summarize Selection").onChange(debounce((value) => { tempAction.name = value.trim(); }, 300)); });
		new Setting(containerEl).setName("Group").addDropdown((dd) => { dd.addOptions(this.groupOptions).setValue(tempAction.groupId).onChange(value => { tempAction.groupId = value; }); });
		new Setting(containerEl).setName("System Prompt").addTextArea((text) => { text.setValue(tempAction.system).setPlaceholder("e.g., You are helpful").onChange(debounce((value) => { tempAction.system = value; }, 300)); text.inputEl.rows = 4; text.inputEl.style.width = "100%"; });
		new Setting(containerEl).setName("Action Prompt").setDesc(`Use ${SELECTION_KEYWORD} / ${CONTEXT_KEYWORD}.`).addTextArea((text) => { text.setValue(tempAction.prompt).setPlaceholder(`e.g., Summarize:\n\n${SELECTION_KEYWORD}`).onChange(debounce((value) => { tempAction.prompt = value; }, 300)); text.inputEl.rows = 6; text.inputEl.style.width = "100%"; });
		new Setting(containerEl).setName("Replace Selection").addToggle((toggle) => { toggle.setValue(tempAction.replace).onChange(value => { tempAction.replace = value; }); });
		new Setting(containerEl).setName("Provider Override").addDropdown((dd) => { dd.addOptions(this.providerOptionsWithDefault).setValue(tempAction.providerId || "").onChange(value => { tempAction.providerId = value || null; }); });
		new Setting(containerEl).setName("Creativity Override").addDropdown((dd) => { dd.addOptions(this.creativityOptionsWithDefault).setValue(tempAction.temperature || "").onChange(value => { tempAction.temperature = value || null; }); });

		// Action Buttons for Edit Form
		new Setting(containerEl)
			.addButton((button) => { // Delete
				button.setButtonText("Delete Action").setIcon("trash").setClass("mod-warning").onClick(() => { const confirmModal = new ConfirmModal( this.app, "Delete Action?", `Delete "${action.name || 'this action'}"? Cannot be undone.`, async () => { const { group, actionIndex } = this.findActionAndGroup(action.id); if (group && actionIndex > -1) { group.actions.splice(actionIndex, 1); await this.plugin.saveSettings(); if (this.plugin.state) this.plugin.state.editingActionId = null; this.display(); new Notice(`Deleted action: ${action.name}`); } else { new Notice("Error deleting action."); } } ); confirmModal.open(); });
			}).addExtraButton((button) => { // Cancel
				button.setTooltip("Cancel").setIcon("cross").onClick(() => { if (this.plugin.state) this.plugin.state.editingActionId = null; this.display(); });
			}).addExtraButton((button) => { // Save
				button.setTooltip("Save").setIcon("save");
				// .setCta() is not valid on ExtraButtonComponent, removed
				button.onClick(async () => {
					if (!tempAction.name) { new Notice("Action name required."); return; }
					const targetGroup = this.plugin.settings.actionGroups.find(g => g.id === tempAction.groupId);
					// Check for name collision in the target group
					if (targetGroup && targetGroup.actions.some(a => a.id !== tempAction.id && a.name === tempAction.name)) { new Notice(`Name "${tempAction.name}" already used in group "${targetGroup.name}".`); return; }

					const { group: originalGroup, actionIndex } = this.findActionAndGroup(action.id);
					if (originalGroup && actionIndex > -1) {
						if (originalGroup.id !== tempAction.groupId) { // If group changed
							originalGroup.actions.splice(actionIndex, 1); // Remove from old
							const newGroup = this.plugin.settings.actionGroups.find(g => g.id === tempAction.groupId);
							if (newGroup) {
								newGroup.actions = newGroup.actions || []; // Ensure array exists
								newGroup.actions.push(tempAction); // Add to new
							} else {
								// This should ideally not happen if dropdown is populated correctly
								logger.error(`Target group ${tempAction.groupId} not found during save! Reverting move.`);
								originalGroup.actions.splice(actionIndex, 0, tempAction); // Put back in original
								tempAction.groupId = originalGroup.id; // Reset groupId
								new Notice("Error: Could not find target group. Action not moved.");
								return; // Prevent saving if target group not found
							}
						} else { // If group didn't change, just update in place
							originalGroup.actions[actionIndex] = tempAction;
						}

						await this.plugin.saveSettings();
						if (this.plugin.state) this.plugin.state.editingActionId = null; // Exit edit mode
						this.display(); // Refresh settings tab
						new Notice(`Saved action: ${tempAction.name}`);
					} else {
						// This case might happen if the action was deleted in another session/window
						logger.error(`Could not find original action (ID: ${action.id}) to save.`);
						new Notice("Error finding original action. Save failed.");
						if (this.plugin.state) this.plugin.state.editingActionId = null; // Exit edit mode anyway
						this.display();
					}
				});
			});
	}

	// renderDangerZone: Section for resetting settings
	private renderDangerZone(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Danger Zone" });
		new Setting(containerEl).setName("Reset Actions").setDesc("🚨 Reset ALL groups and actions to defaults. Cannot be undone.").addButton((button) => button.setButtonText("Reset Actions to Default").setClass("mod-warning").onClick(() => { const confirmModal = new ConfirmModal( this.app, "Reset All Actions?", "Reset all actions/groups to defaults? All customizations lost.", async () => { const defaultGroups: ActionGroup[] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.actionGroups)); defaultGroups.forEach(group => { group.id = uuidv4(); group.actions.forEach(action => { action.id = uuidv4(); action.groupId = group.id; }); }); this.plugin.settings.actionGroups = defaultGroups; this.plugin.settings.currentGroupId = defaultGroups[0]?.id ?? null; if (this.plugin.state) { this.plugin.state.editingActionId = null; this.plugin.state.reorderingGroupId = null; } await this.plugin.saveSettings(); this.prepareDropdownOptions(); this.display(); new Notice("All actions reset to defaults."); } ); confirmModal.open(); }));
	}
}
// --- END OF FILE LocalGPTSettingTab.ts ---