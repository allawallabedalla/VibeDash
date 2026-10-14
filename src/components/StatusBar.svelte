<script lang="ts">
  /**
   * Areas as calm dots: "Modules ok · Battery ok · Night running".
   * Only "look" and "act" get colour; "ok" stays quiet.
   */
  export interface StatusItem {
    label: string;
    state: 'ok' | 'look' | 'act';
  }
  let { items, label }: { items: StatusItem[]; label: string } = $props();
</script>

<ul class="bar" aria-label={label}>
  {#each items as item (item.label)}
    <li class={item.state}>
      <span class="dot" aria-hidden="true"></span>
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
    gap: 8px;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 18px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 14px;
    color: var(--muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--good);
    opacity: 0.55;
  }
  .look {
    color: var(--text);
  }
  .look .dot {
    background: var(--fair);
    opacity: 1;
  }
  .act {
    color: var(--text);
  }
  .act .dot {
    background: var(--poor);
    opacity: 1;
  }
</style>
