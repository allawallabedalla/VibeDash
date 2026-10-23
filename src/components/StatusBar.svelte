<script lang="ts">
  /**
   * Areas as calm dots: "Modules ok · Battery ok · Night running".
   * Only "look" and "act" get colour; "ok" stays quiet.
   */
  export interface StatusItem {
    label: string;
    state: 'ok' | 'look' | 'act';
  }
  import Icon from './Icon.svelte';

  let { items, label }: { items: StatusItem[]; label: string } = $props();
  const icon = { ok: 'okCircle', look: 'lookCircle', act: 'actCircle' } as const;
</script>

<ul class="bar" aria-label={label}>
  {#each items as item (item.label)}
    <li class={item.state}>
      <span class="mark"><Icon name={icon[item.state]} size={18} /></span>
      <span>{item.label}</span>
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
    gap: 6px;
    height: 34px;
    padding: 0 14px 0 8px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    border: 2px solid var(--border);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-2);
    white-space: nowrap;
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
