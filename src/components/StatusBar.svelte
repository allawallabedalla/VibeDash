<script lang="ts">
  /**
   * Areas as calm dots: "Modules ok · Battery ok · Night running".
   * Only "look" and "act" get colour; "ok" stays quiet.
   * With `onclick` the pill is a button (e.g. jump to the questions behind it).
   */
  export interface StatusItem {
    label: string;
    state: 'ok' | 'look' | 'act';
    onclick?: () => void;
  }
  import Icon from './Icon.svelte';

  let { items, label }: { items: StatusItem[]; label: string } = $props();
  const icon = { ok: 'okCircle', look: 'lookCircle', act: 'actCircle' } as const;
</script>

<ul class="bar" aria-label={label}>
  {#each items as item (item.label)}
    <li class={item.state}>
      {#if item.onclick}
        <button type="button" class="pill" onclick={item.onclick}>
          <span class="mark"><Icon name={icon[item.state]} size={18} /></span>
          <span>{item.label}</span>
        </button>
      {:else}
        <span class="pill">
          <span class="mark"><Icon name={icon[item.state]} size={18} /></span>
          <span>{item.label}</span>
        </span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .bar {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
  }
  li {
    display: inline-flex;
    align-items: center;
    height: 34px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    border: 2px solid var(--border);
    color: var(--text-2);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px 0 8px;
    border: 0;
    border-radius: 999px;
    background: none;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: inherit;
    white-space: nowrap;
  }
  /* looks like the plain pill, but the tap area reaches 44 px (bleeds past the border) */
  button.pill {
    height: 44px;
    min-width: 44px;
    cursor: pointer;
  }
  button.pill:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 3px;
  }
  .mark {
    display: inline-flex;
    color: var(--good);
  }
  .look {
    background: var(--look-bg);
    color: var(--text);
  }
  .look .mark {
    color: var(--fair);
  }
  .act {
    background: var(--act-bg);
    color: var(--text);
  }
  .act .mark {
    color: var(--poor);
  }
</style>
