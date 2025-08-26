<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';

  export let placeholder: string = 'Type here…';
  export let value: string = '';
  export let modelLabel: string = '';

  const dispatch = createEventDispatcher<{ submit: string; cancel: void }>();
  let inputEl: HTMLInputElement | null = null;

  onMount(() => {
    // Autofocus and select content for quick typing
    queueMicrotask(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      dispatch('submit', value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch('cancel');
    }
  }
</script>

<div class="local-gpt-action-palette-shell">
  <input
    bind:this={inputEl}
    bind:value={value}
    placeholder={placeholder}
    on:keydown={handleKeydown}
    class="local-gpt-action-palette"
    autocomplete="off"
    spellcheck="false"
  />
  {#if modelLabel}
    <div class="local-gpt-model-badge" aria-hidden="true">
      <div class="local-gpt-model-badge-label">{modelLabel}</div>
    </div>
  {/if}
</div>


