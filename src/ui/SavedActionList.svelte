<script lang="ts">
	import type { SavedActionReference } from "../interfaces";

	export let actions: SavedActionReference[];
	export let onRun: (id: string) => void;
	export let selectedIndex = -1;

	let containerElement: HTMLDivElement | null = null;

	$: if (
		containerElement &&
		selectedIndex >= 0 &&
		selectedIndex < actions.length
	) {
		const rows = containerElement.querySelectorAll<HTMLElement>(
			".local-gpt-saved-action",
		);
		rows[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
	}

	function focusRowButton(index: number) {
		const buttons = containerElement?.querySelectorAll<HTMLButtonElement>(
			".local-gpt-saved-action-run",
		);
		buttons?.[index]?.focus();
	}

	function handleRowKeydown(event: KeyboardEvent, index: number) {
		if (!actions.length) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			event.stopPropagation();
			const nextIndex = (index + 1) % actions.length;
			selectedIndex = nextIndex;
			focusRowButton(nextIndex);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			const prevIndex = (index - 1 + actions.length) % actions.length;
			selectedIndex = prevIndex;
			focusRowButton(prevIndex);
		}
	}
</script>

<div class="local-gpt-saved-actions" bind:this={containerElement}>
	{#each actions as action, index (action.id)}
		<div
			class="local-gpt-saved-action"
			class:local-gpt-selected={index === selectedIndex}
			class:is-selected={index === selectedIndex}
		>
			<button
				type="button"
				class="local-gpt-saved-action-run"
				on:focus={() => (selectedIndex = index)}
				on:keydown={(event) => handleRowKeydown(event, index)}
				on:click={() => onRun(action.id)}
			>
				<span class="local-gpt-saved-action-title">
					<span class="local-gpt-saved-action-icon" aria-hidden="true"
						>›</span
					>{action.name}
				</span>
				{#if action.selection}
					<span
						class="local-gpt-saved-action-model"
						title={action.modelLabel}
						>{action.shortModelLabel || action.modelLabel}</span
					>
				{/if}
			</button>
		</div>
	{/each}
</div>
