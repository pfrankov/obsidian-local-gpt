<script lang="ts">
	import type {
		CommandReference,
		CreativityReference,
		FileReference,
		ModelReference,
		ProviderReference,
		SystemPromptReference,
	} from "../interfaces";
	import type { DropdownItem, DropdownKind } from "./actionPaletteTypes";
	import { CLEAR_SYSTEM_PROMPT_ID } from "./actionPaletteTypes";

	export let activeDropdown: DropdownKind;
	export let selectedIndex: number;
	export let fileItems: FileReference[];
	export let commandItems: CommandReference[];
	export let providerItems: ProviderReference[];
	export let modelItems: ModelReference[];
	export let creativityItems: CreativityReference[];
	export let systemItems: SystemPromptReference[];
	export let onSelect: (item: DropdownItem) => void;
	export let formatSystemPreview: (text: string) => string;

	export let dropdownElement: HTMLDivElement | null = null;
	export let commandDropdownElement: HTMLDivElement | null = null;
	export let providerDropdownElement: HTMLDivElement | null = null;
	export let modelDropdownElement: HTMLDivElement | null = null;
	export let creativityDropdownElement: HTMLDivElement | null = null;
	export let systemDropdownElement: HTMLDivElement | null = null;

	function selectedClass(index: number) {
		return index === selectedIndex ? "local-gpt-selected" : "";
	}
</script>

<div
	bind:this={dropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'file' ? 'block' : 'none'}"
>
	{#each fileItems as item, index}
		{#if activeDropdown === "file"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<span class="local-gpt-file-name"
					>{item.basename}.{item.extension}</span
				>
				<span class="local-gpt-file-path">{item.path}</span>
			</div>
		{/if}
	{/each}
</div>

<div
	bind:this={commandDropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'command' ? 'block' : 'none'}"
>
	{#each commandItems as item, index}
		{#if activeDropdown === "command"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<span class="local-gpt-command-name">/{item.name}</span>
				<span class="local-gpt-command-description"
					>{item.description}</span
				>
			</div>
		{/if}
	{/each}
</div>

<div
	bind:this={providerDropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'provider' ? 'block' : 'none'}"
>
	{#each providerItems as item, index}
		{#if activeDropdown === "provider"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<div class="local-gpt-provider-header">
					<span class="local-gpt-provider-name"
						>{item.providerName}</span
					>
					{#if item.providerUrl}
						<span class="local-gpt-provider-url"
							>{item.providerUrl}</span
						>
					{/if}
				</div>
				<span class="local-gpt-provider-model">{item.name}</span>
			</div>
		{/if}
	{/each}
</div>

<div
	bind:this={modelDropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'model' ? 'block' : 'none'}"
>
	{#each modelItems as item, index}
		{#if activeDropdown === "model"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<span class="local-gpt-model-name">{item.name}</span>
			</div>
		{/if}
	{/each}
</div>

<div
	bind:this={creativityDropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'creativity' ? 'block' : 'none'}"
>
	{#each creativityItems as item, index}
		{#if activeDropdown === "creativity"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<span class="local-gpt-creativity-name">{item.name}</span>
			</div>
		{/if}
	{/each}
</div>

<div
	bind:this={systemDropdownElement}
	class="local-gpt-dropdown"
	style="display: {activeDropdown === 'system' ? 'block' : 'none'}"
>
	{#each systemItems as item, index}
		{#if activeDropdown === "system"}
			<div
				class="local-gpt-dropdown-item {selectedClass(index)}"
				role="option"
				tabindex="0"
				aria-selected={index === selectedIndex}
				on:click={() => onSelect(item)}
				on:keydown={(event) =>
					event.key === "Enter" && onSelect(item)}
			>
				<span class="local-gpt-system-name">{item.name}</span>
				{#if item.id !== CLEAR_SYSTEM_PROMPT_ID}
					<span class="local-gpt-system-detail"
						>{formatSystemPreview(item.system)}</span
					>
				{/if}
			</div>
		{/if}
	{/each}
</div>
