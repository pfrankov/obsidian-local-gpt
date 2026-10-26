<script context="module" lang="ts">
	let nextLabelId = 0;
</script>

<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { I18n } from "../i18n";
	import SavedActionList from "./SavedActionList.svelte";
	import ActionPaletteDropdowns from "./ActionPaletteDropdowns.svelte";
	import type {
		ActionModelChoice,
		ActionModelSelection,
		SavedActionReference,
		ActionPaletteSubmitEvent,
		ReasoningPaletteSnapshot,
		CommandReference,
		CreativityReference,
		FileReference,
		GetFilesCallback,
		GetModelsCallback,
		GetProvidersCallback,
		GetSystemPromptsCallback,
		ModelReference,
		OnCreativityChangeCallback,
		OnModelChangeCallback,
		OnProviderChangeCallback,
		ProviderReference,
		SystemPromptReference,
	} from "../interfaces";
	import type { DropdownItem, PaletteEvents } from "./actionPaletteTypes";
	import {
		ActionPaletteController,
	} from "./actionPaletteController";
	import {
		createActionPaletteState,
	} from "./actionPaletteState";
	import {
		beginHoldingPromptFocus,
		getDropdownElementForKind,
		installPaletteModAGuard,
		installPaletteOutsidePointerRelease,
	} from "./actionPaletteDom";
	import { formatSystemPreview } from "./actionPaletteOptions";
	import {
		getReplaceSelectionHotkeyLabel,
		getReplaceSelectionIconId,
		obsidianIcon,
	} from "./actionPaletteIcons";

	const labelId = `local-gpt-action-palette-label-${++nextLabelId}`;

	export let placeholder: string = I18n.t(
		"commands.actionPalette.placeholder",
	);
	export let getReasoningSnapshot: (() => Promise<ReasoningPaletteSnapshot>) | undefined = undefined;
	/** When false, hide /reasoning and the reasoning badge (AI Providers API < 5). */
	export let includeReasoning = true;
	export let value = "";
	export let providerLabel = "";
	export let providerDetails: import("./actionPaletteOptions").ProviderLabelParts | undefined = undefined;
	export let providerId: string | undefined = undefined;
	export let getFiles: GetFilesCallback | undefined = undefined;
	export let getProviders: GetProvidersCallback | undefined = undefined;
	export let onProviderChange: OnProviderChangeCallback | undefined =
		undefined;
	export let getModels: GetModelsCallback | undefined = undefined;
	export let onModelChange: OnModelChangeCallback | undefined = undefined;
	export let onCreativityChange:
		| OnCreativityChangeCallback
		| undefined = undefined;
	export let getSystemPrompts:
		| GetSystemPromptsCallback
		| undefined = undefined;
	export let selectedSystemPromptId: string | null = null;
	export let initialSelectedFiles: string[] = [];
	export let onSystemPromptChange:
		| ((systemPromptId: string | null) => Promise<void> | void)
		| undefined = undefined;
	export let onSubmit:
		| ((event: ActionPaletteSubmitEvent) => void)
		| undefined = undefined;
	export let onCancel: (() => void) | undefined = undefined;
	/** Palette opened over a selection: show the replace toggle. */
	export let canReplaceSelection = false;
	/** Initial replace-selection state (session-sticky in the plugin). */
	export let replaceSelection = false;
	export let onReplaceSelectionChange:
		| ((replaceSelection: boolean) => void)
		| undefined = undefined;

	export let savedActions: SavedActionReference[] = [];
	export let onRunSavedAction:
		| ((
				id: string,
				selectedFiles: string[],
				selectionOverride?: ActionModelSelection,
		  ) => void)
		| undefined = undefined;
	export let getActionModels: (() => Promise<ActionModelChoice[]>) | undefined = undefined;
	export let onActionModelChange: ((id: string, selection?: ActionModelSelection) => Promise<SavedActionReference[]>) | undefined = undefined;
	void getActionModels;
	void onActionModelChange;

	const replaceIconId = getReplaceSelectionIconId();
	const replaceHotkey = getReplaceSelectionHotkeyLabel();

	const dispatch = createEventDispatcher<PaletteEvents>();

	let contentElement: HTMLDivElement | null = null;
	let dropdownElement: HTMLDivElement | null = null;
	let commandDropdownElement: HTMLDivElement | null = null;
	let providerDropdownElement: HTMLDivElement | null = null;
	let modelDropdownElement: HTMLDivElement | null = null;
	let reasoningDropdownElement: HTMLDivElement | null = null;
	let reasoningItems: CreativityReference[] = [];
	let creativityDropdownElement: HTMLDivElement | null = null;
	let systemDropdownElement: HTMLDivElement | null = null;

	let state = createActionPaletteState(value, providerLabel, providerDetails);
	const fallbackParts =
		!state.providerName &&
		!state.modelName &&
		savedActions.length > 0 &&
		savedActions[0].modelLabel
			? savedActions[0].modelLabel.split(" · ")
			: [];
	if (!state.providerName && fallbackParts[0]) {
		state.providerName = fallbackParts[0];
	}
	if (!state.modelName && fallbackParts[1]) {
		state.modelName = fallbackParts[1];
	}
	let baseProviderId = providerId;
	let baseProviderName = state.providerName;
	let baseModelName = state.modelName;
	let highlightedActionId: string | null = null;
	let sessionOverrideSelection: ActionModelSelection | null = null;

	let invalidateEpoch = 0;
	let fileItems: FileReference[] = [];
	let commandItems: CommandReference[] = [];
	let providerItems: ProviderReference[] = [];
	let modelItems: ModelReference[] = [];
	let creativityItems: CreativityReference[] = [];
	let systemItems: SystemPromptReference[] = [];

	async function handlePaletteProviderChange(nextProviderId: string) {
		const selectedProvider = state.allProviders.find(
			(item) => item.id === nextProviderId,
		);
		const nextModel = selectedProvider?.name || state.modelName;
		baseProviderId = nextProviderId;
		baseProviderName = selectedProvider?.providerName || state.providerName;
		baseModelName = nextModel;
		sessionOverrideSelection = nextModel
			? { providerId: nextProviderId, model: nextModel }
			: null;
		if (highlightedActionId) {
			const idx = savedActions.findIndex(
				(item) => item.id === highlightedActionId,
			);
			if (idx >= 0) selectedActionIndex = idx;
		}
		await onProviderChange?.(nextProviderId);
	}

	async function handlePaletteModelChange(nextModel: string) {
		let effectiveProviderId: string | undefined =
			providerId ||
			baseProviderId ||
			state.allProviders[0]?.id;
		if (!effectiveProviderId && getProviders) {
			try {
				const providers = await getProviders();
				effectiveProviderId = providers[0]?.id;
			} catch {
				effectiveProviderId = undefined;
			}
		}
		effectiveProviderId = effectiveProviderId || "default";
		baseProviderId = effectiveProviderId;
		baseProviderName = state.providerName || baseProviderName;
		baseModelName = nextModel;
		sessionOverrideSelection = {
			providerId: effectiveProviderId,
			model: nextModel,
		};
		if (highlightedActionId) {
			const idx = savedActions.findIndex(
				(item) => item.id === highlightedActionId,
			);
			if (idx >= 0) selectedActionIndex = idx;
		}
		await onModelChange?.(nextModel);
	}

	const controller = new ActionPaletteController(state, {
		getValue: () => value,
		getReasoningSnapshot: () => getReasoningSnapshot,
		getProviderId: () => providerId,
		setProviderId: (nextProviderId) => {
			providerId = nextProviderId;
		},
		getInitialSelectedFiles: () => initialSelectedFiles,
		getSelectedSystemPromptId: () => selectedSystemPromptId,
		getFiles: () => getFiles,
		getProviders: () => getProviders,
		getModels: () => getModels,
		getSystemPrompts: () => getSystemPrompts,
		onProviderChange: () => handlePaletteProviderChange,
		onModelChange: () => handlePaletteModelChange,
		onCreativityChange: () => onCreativityChange,
		onSystemPromptChange: () => onSystemPromptChange,
		onSubmit: () => onSubmit,
		onCancel: () => onCancel,
		getCanReplaceSelection: () => canReplaceSelection,
		getInitialReplaceSelection: () => replaceSelection,
		onReplaceSelectionChange: () => onReplaceSelectionChange,
		setProviderLabel: (nextProviderLabel) => {
			providerLabel = nextProviderLabel;
		},
		getContentElement: () => contentElement,
		includeReasoning: () => includeReasoning && Boolean(getReasoningSnapshot),
		getDropdownElement: (kind) =>
			getDropdownElementForKind(kind, {
				file: dropdownElement,
				command: commandDropdownElement,
				provider: providerDropdownElement,
				model: modelDropdownElement,
				creativity: creativityDropdownElement,
				reasoning: reasoningDropdownElement,
				system: systemDropdownElement,
			}),
		dispatchSubmit: (payload) => dispatch("submit", payload),
		dispatchCancel: () => dispatch("cancel"),
		invalidate: () => {
			invalidateEpoch += 1;
			state = state;
		},
	});

	controller.restoreSelectedSystemPrompt();
	controller.initializeReplaceSelection();
	if (includeReasoning && getReasoningSnapshot) void controller.refreshReasoning();
	onMount(() => {
		const stopModA = installPaletteModAGuard(() => contentElement);
		const stopPointer = installPaletteOutsidePointerRelease(
			() => contentElement,
		);
		return () => {
			stopModA();
			stopPointer();
		};
	});
	onDestroy(() => {
		controller.releaseFocusHold();
		controller.resetReasoning();
	});
	$: reasoningItems = state.activeDropdown === "reasoning" ? state.filteredItems as CreativityReference[] : [];

	$: if (contentElement && !state.initializedContent) {
		controller.initializeContent();
	}

	$: fileItems =
		state.activeDropdown === "file"
			? (state.filteredItems as FileReference[])
			: [];
	$: commandItems =
		state.activeDropdown === "command"
			? (state.filteredItems as CommandReference[])
			: [];
	$: providerItems =
		state.activeDropdown === "provider"
			? (state.filteredItems as ProviderReference[])
			: [];
	$: modelItems =
		state.activeDropdown === "model"
			? (state.filteredItems as ModelReference[])
			: [];
	$: creativityItems =
		state.activeDropdown === "creativity"
			? (state.filteredItems as CreativityReference[])
			: [];
	$: systemItems =
		state.activeDropdown === "system"
			? (state.filteredItems as SystemPromptReference[])
			: [];

	let selectedActionIndex = -1;

	$: hasNonFilePromptText = state.textTokens.some(
		(token) => token.type !== "file" && token.content.trim(),
	);
	$: isCommandOnlyText =
		!hasNonFilePromptText ||
		state.textTokens.every(
			(token) =>
				token.type === "file" ||
				token.type === "command" ||
				!token.content.trim() ||
				token.content.trim().startsWith("/"),
		);
	$: showSavedActions =
		savedActions.length > 0 &&
		!hasNonFilePromptText &&
		state.activeDropdown === "none" &&
		Boolean(onRunSavedAction);
	function syncSavedActionsState(
		visible: boolean,
		index: number,
		actions: SavedActionReference[],
		commandOnly: boolean,
		dropdown: string,
	) {
		if (!visible || actions.length === 0) {
			if (selectedActionIndex !== -1) {
				selectedActionIndex = -1;
			}
			if (!commandOnly && dropdown === "none") {
				highlightedActionId = null;
			}
			return;
		}
		if (index >= actions.length) {
			selectedActionIndex = actions.length - 1;
			return;
		}
		let effectiveIndex = index;
		if (effectiveIndex < 0 && highlightedActionId) {
			const restoredIndex = actions.findIndex(
				(item) => item.id === highlightedActionId,
			);
			if (restoredIndex >= 0) {
				selectedActionIndex = restoredIndex;
				effectiveIndex = restoredIndex;
			}
		}
		if (effectiveIndex >= 0 && effectiveIndex < actions.length) {
			const activeAction = actions[effectiveIndex];
			highlightedActionId = activeAction.id;
			if (!sessionOverrideSelection) {
				const defaultPrefix = `${I18n.t("commands.actionPalette.actionModelDefault")} · `;
				const strippedLabel = activeAction.modelLabel?.startsWith(
					defaultPrefix,
				)
					? activeAction.modelLabel.slice(defaultPrefix.length)
					: activeAction.modelLabel;
				const labelParts = strippedLabel
					? strippedLabel.split(" · ")
					: [];
				const nextProviderName =
					labelParts.length > 1
						? labelParts[0]
						: baseProviderName || state.providerName;
				const nextModelName =
					activeAction.selection?.model ||
					(labelParts.length > 1
						? labelParts.slice(1).join(" · ")
						: activeAction.shortModelLabel ||
							strippedLabel ||
							baseModelName ||
							state.modelName);
				providerId =
					activeAction.selection?.providerId ?? baseProviderId;
				if (
					state.providerName !== nextProviderName ||
					state.modelName !== nextModelName
				) {
					controller.setProviderBadgeLabel(
						nextProviderName,
						nextModelName,
					);
					state = state;
				}
			}
		} else {
			highlightedActionId = null;
			if (
				!sessionOverrideSelection &&
				(baseProviderName || baseModelName) &&
				(state.providerName !== baseProviderName ||
					state.modelName !== baseModelName)
			) {
				providerId = baseProviderId;
				controller.setProviderBadgeLabel(
					baseProviderName,
					baseModelName,
				);
				state = state;
			}
		}
	}

	$: syncSavedActionsState(
		showSavedActions,
		selectedActionIndex,
		savedActions,
		isCommandOnlyText,
		state.activeDropdown,
	);

	function runSavedAction(id: string) {
		if (sessionOverrideSelection) {
			onRunSavedAction?.(
				id,
				state.selectedFiles,
				sessionOverrideSelection,
			);
		} else {
			onRunSavedAction?.(id, state.selectedFiles);
		}
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (showSavedActions && savedActions.length > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				selectedActionIndex =
					selectedActionIndex < 0
						? 0
						: (selectedActionIndex + 1) % savedActions.length;
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				selectedActionIndex =
					selectedActionIndex < 0
						? savedActions.length - 1
						: (selectedActionIndex - 1 + savedActions.length) %
							savedActions.length;
				return;
			}
			if (
				event.key === "Enter" &&
				!event.shiftKey &&
				selectedActionIndex >= 0 &&
				selectedActionIndex < savedActions.length
			) {
				event.preventDefault();
				void runSavedAction(savedActions[selectedActionIndex].id);
				return;
			}
		}
		controller.handleKeydown(event);
	}

	function handleSelection(item: DropdownItem) {
		controller.handleSelection(item);
	}

	function handleInput(event: Event & { currentTarget: HTMLDivElement }) {
		controller.handleInput(
			event as InputEvent & {
				currentTarget: HTMLDivElement;
				target: HTMLDivElement;
			},
		);
	}
</script>

<div class="local-gpt-action-palette-shell">
	<div class:has-saved-actions={showSavedActions} class="local-gpt-action-palette-surface">
	{#if showSavedActions && onRunSavedAction}
		<SavedActionList
			bind:actions={savedActions}
			bind:selectedIndex={selectedActionIndex}
			onRun={(id) => void runSavedAction(id)}
		/>
	{/if}
	<!-- aria-label triggers a body-level Obsidian tooltip. A referenced label
	     preserves the accessible name without creating that detached tooltip. -->
	<span id={labelId} hidden>{I18n.t("commands.actionPalette.name")}</span>
	<div
		bind:this={contentElement}
		class="local-gpt-action-palette"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-labelledby={labelId}
		on:keydown={handlePromptKeydown}
		on:input={handleInput}
		on:keyup={(event) => controller.handleKeyup(event)}
		on:focusin={() => beginHoldingPromptFocus(contentElement)}
		on:focusout={(event) => controller.handleFocusOut(event)}
		on:click={(event) => controller.handleContentClick(event)}
		data-placeholder={placeholder}
		spellcheck="false"
	></div>
	</div>
	{#if state.activeDropdown !== "none"}
		<ActionPaletteDropdowns
			activeDropdown={state.activeDropdown}
			selectedIndex={state.selectedIndex}
			{fileItems}
			{commandItems}
			{providerItems}
			{modelItems}
			{creativityItems}
			{reasoningItems}
			{systemItems}
			onSelect={handleSelection}
			{formatSystemPreview}
			bind:dropdownElement
			bind:commandDropdownElement
			bind:providerDropdownElement
			bind:modelDropdownElement
			bind:reasoningDropdownElement
			bind:creativityDropdownElement
			bind:systemDropdownElement
		/>
	{/if}

	<div class="local-gpt-provider-badge">
		{#if state.selectedSystemPromptName}
			<div
				class={state.badgeHighlight
					? "local-gpt-system-indicator local-gpt-badge-highlight"
					: "local-gpt-system-indicator"}
			>
				<span class="local-gpt-system-indicator-label">
					{state.selectedSystemPromptName}
				</span>
			</div>
		{:else}
			<div class="local-gpt-provider-badge-hint">
				{I18n.t("commands.actionPalette.hint")}
			</div>
		{/if}

		{#if state.providerName || state.modelName || state.creativityBadge || state.reasoningLabel || state.replaceAvailable}
			<div
				class={state.badgeHighlight
					? "local-gpt-provider-badge-meta local-gpt-badge-highlight"
					: "local-gpt-provider-badge-meta"}
			>
				{#if state.providerName || state.modelName}
					<div class="local-gpt-provider-badge-label">{#if state.providerName}<button
								type="button"
								class="local-gpt-provider-badge-button"
								title={I18n.t("commands.actionPalette.changeProvider")}
								on:click={() =>
									controller.activateCommandDropdown("provider")}
							>{state.providerName}</button>{/if}{#if state.providerName && state.modelName}{` · `}{/if}{#if state.modelName}<button
								type="button"
								class="local-gpt-model-badge-button"
								title={I18n.t("commands.actionPalette.changeModel")}
								on:click={() =>
									controller.activateCommandDropdown("model")}
							>{state.modelName}</button>{/if}</div>
				{/if}
				{#if state.creativityBadge}
					<button
						type="button"
						class="local-gpt-creativity-badge"
						title={I18n.t("settings.creativity")}
						on:click={() =>
							controller.activateCommandDropdown("creativity")}
					>
						{state.creativityBadge}
					</button>
				{/if}
				{#if state.reasoningLabel}
					<button
						type="button"
						class="local-gpt-reasoning-badge"
						title={I18n.t("commands.actionPalette.changeReasoning")}
						on:click={() =>
							controller.activateCommandDropdown("reasoning")}
					>
						🧠 {state.reasoningLabel}
					</button>
				{/if}
				{#if state.replaceAvailable}
					<!-- Icon-only toggle. `title` (native tooltip + accessible name),
					     like the other chips: an aria-label would spawn Obsidian's
					     body-level tooltip, which outlives the palette on Esc. -->
					<button
						type="button"
						class={state.replaceSelection
							? "local-gpt-replace-toggle is-active"
							: "local-gpt-replace-toggle"}
						aria-pressed={state.replaceSelection}
						title={I18n.t(
							state.replaceSelection
								? "commands.actionPalette.replaceSelectionOn"
								: "commands.actionPalette.replaceSelectionOff",
							{ hotkey: replaceHotkey },
						)}
						use:obsidianIcon={replaceIconId}
						on:click={() => controller.handleReplaceToggleClick()}
					></button>
				{/if}
			</div>
		{/if}
	</div>
</div>
