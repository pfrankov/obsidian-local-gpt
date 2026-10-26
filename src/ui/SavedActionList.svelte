<script lang="ts">
	import { tick } from "svelte";
	import { I18n } from "../i18n";
	import type { ActionModelChoice, ActionModelSelection, SavedActionReference } from "../interfaces";
	export let actions: SavedActionReference[] = [];
	export let onRun: (id: string) => void;
	export let getModels: () => Promise<ActionModelChoice[]>;
	export let onModelChange: (id: string, selection?: ActionModelSelection) => Promise<SavedActionReference[]>;
	let choosing: string | null = null;
	let loading: string | null = null;
	let choices: ActionModelChoice[] = [];
	let error = "";
	let selectElement: HTMLSelectElement;
	let saving = false;
	let container: HTMLDivElement;
	async function closePicker(id: string, restoreFocus = document.activeElement === selectElement) {
		choosing = null;
		await tick();
		if (restoreFocus) {
			Array.from(container?.querySelectorAll<HTMLButtonElement>(".local-gpt-saved-action-model") ?? []).find((button) => button.dataset.actionId === id)?.focus();
		}
	}
	async function choose(id: string, button: HTMLButtonElement) {
		if (loading !== null) return;
		loading = id;
		error = "";
		try {
			choices = await getModels();
			if (!button.isConnected || document.activeElement !== button) return;
			choosing = id;
			await tick();
			selectElement?.focus();
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			loading = null;
		}
	}
	async function change(id: string, key: string) {
		const hadFocus = document.activeElement === selectElement;
		saving = true;
		try {
			actions = await onModelChange(id, key ? choices[Number(key) - 1].selection : undefined);
			saving = false;
			await closePicker(id, hadFocus && (document.activeElement === selectElement || document.activeElement === document.body));
		} catch (cause) {
			error = (cause as Error).message;
		} finally { saving = false; }
	}
</script>

<div class="local-gpt-saved-actions" bind:this={container}>
	{#each actions as action (action.id)}
		<div class="local-gpt-saved-action">
			<button class="local-gpt-saved-action-run" disabled={saving} on:click={() => onRun(action.id)}><span class="local-gpt-saved-action-icon" aria-hidden="true">›</span>{action.name}</button>
			{#if choosing === action.id}
				<select bind:this={selectElement} disabled={saving} aria-label={`${action.name}: ${I18n.t("commands.actionPalette.changeActionModel")}`}
					value={action.selection ? String(choices.findIndex((choice) => choice.selection.providerId === action.selection?.providerId && choice.selection.model === action.selection?.model) + 1) : ""}
					on:change={(event) => change(action.id, event.currentTarget.value)} on:keydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); closePicker(action.id); } }}>
					<option value="">{I18n.t("commands.actionPalette.actionModelDefault")}</option>
					{#if action.selection && !choices.some((choice) => choice.selection.providerId === action.selection?.providerId && choice.selection.model === action.selection?.model)}
						<option value="0" disabled>{action.modelLabel}</option>
					{/if}
					{#each choices as choice, index}<option value={String(index + 1)}>{choice.label}</option>{/each}
				</select>
			{:else}
				<button class="local-gpt-saved-action-model" data-action-id={action.id} disabled={(loading !== null && loading !== action.id) || saving} title={`${I18n.t("commands.actionPalette.changeActionModel")}: ${action.modelLabel}`} on:click={(event) => { event.currentTarget.focus(); choose(action.id, event.currentTarget); }}>{action.shortModelLabel || action.modelLabel} ▾</button>
			{/if}
		</div>
	{/each}
	{#if error}<div role="alert">{error}</div>{/if}
</div>
