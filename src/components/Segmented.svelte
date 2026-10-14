<script lang="ts" generics="T extends string">
  /** Calm segmented choice (period, language …); 44 px targets. */
  let {
    options,
    value = $bindable(),
    label,
  }: { options: { id: T; label: string }[]; value: T; label: string } = $props();
</script>

<div class="seg" role="group" aria-label={label}>
  {#each options as o (o.id)}
    <button type="button" aria-pressed={value === o.id} onclick={() => (value = o.id)}>
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    background: var(--surface-2);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  button {
    min-width: 56px;
    height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
</style>
