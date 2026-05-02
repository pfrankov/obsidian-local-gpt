<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { I18n } from "../i18n";
	import ActionPaletteDropdowns from "./ActionPaletteDropdowns.svelte";
	import type {
		ActionPaletteSubmitEvent,
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
	import { getDropdownElementForKind } from "./actionPaletteDom";
	import { formatSystemPreview } from "./actionPaletteOptions";

	export let placeholder: string = I18n.t(
		"commands.actionPalette.placeholder",
	);
	export let value = "";
	export let providerLabel = "";
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

	const dispatch = createEventDispatcher<PaletteEvents>();

	let contentElement: HTMLDivElement | null = null;
	let dropdownElement: HTMLDivElement | null = null;
	let commandDropdownElement: HTMLDivElement | null = null;
	let providerDropdownElement: HTMLDivElement | null = null;
	let modelDropdownElement: HTMLDivElement | null = null;
	let creativityDropdownElement: HTMLDivElement | null = null;
	let systemDropdownElement: HTMLDivElement | null = null;

	let state = createActionPaletteState(value, providerLabel);
	let fileItems: FileReference[] = [];
	let commandItems: CommandReference[] = [];
	let providerItems: ProviderReference[] = [];
	let modelItems: ModelReference[] = [];
	let creativityItems: CreativityReference[] = [];
	let systemItems: SystemPromptReference[] = [];

	const controller = new ActionPaletteController(state, {
		getValue: () => value,
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
		onProviderChange: () => onProviderChange,
		onModelChange: () => onModelChange,
		onCreativityChange: () => onCreativityChange,
		onSystemPromptChange: () => onSystemPromptChange,
		onSubmit: () => onSubmit,
		onCancel: () => onCancel,
		setProviderLabel: (nextProviderLabel) => {
			providerLabel = nextProviderLabel;
		},
		getContentElement: () => contentElement,
		getDropdownElement: (kind) =>
			getDropdownElementForKind(kind, {
				file: dropdownElement,
				command: commandDropdownElement,
				provider: providerDropdownElement,
				model: modelDropdownElement,
				creativity: creativityDropdownElement,
				system: systemDropdownElement,
			}),
		dispatchSubmit: (payload) => dispatch("submit", payload),
		dispatchCancel: () => dispatch("cancel"),
		invalidate: () => {
			state = state;
		},
	});

	controller.restoreSelectedSystemPrompt();

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
	<div
		bind:this={contentElement}
		class="local-gpt-action-palette"
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-label={placeholder}
		on:keydown={(event) => controller.handleKeydown(event)}
		on:input={handleInput}
		on:keyup={(event) => controller.handleKeyup(event)}
		on:click={(event) => controller.handleContentClick(event)}
		data-placeholder={placeholder}
		spellcheck="false"
	></div>
	{#if state.activeDropdown !== "none" && state.filteredItems.length > 0}
		<ActionPaletteDropdowns
			activeDropdown={state.activeDropdown}
			selectedIndex={state.selectedIndex}
			{fileItems}
			{commandItems}
			{providerItems}
			{modelItems}
			{creativityItems}
			{systemItems}
			onSelect={handleSelection}
			{formatSystemPreview}
			bind:dropdownElement
			bind:commandDropdownElement
			bind:providerDropdownElement
			bind:modelDropdownElement
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

		{#if providerLabel}
			<div
				class={state.badgeHighlight
					? "local-gpt-provider-badge-label local-gpt-badge-highlight"
					: "local-gpt-provider-badge-label"}
			>
				{providerLabel}
			</div>
		{/if}
	</div>
</div>
