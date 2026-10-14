<script lang="ts">
  /**
   * Main areas as a bar. Desktop: icon + word. Phone: compact icon bar, only
   * the active area shows its word; every tab keeps a 44 px target and a label.
   */
  import Icon, { type IconName } from './Icon.svelte';

  export interface TabItem {
    id: string;
    label: string;
    icon: IconName;
  }
  let {
    items,
    active = $bindable(),
    label,
  }: { items: TabItem[]; active: string; label: string } = $props();
</script>

<nav aria-label={label}>
  <ul>
    {#each items as item (item.id)}
      <li>
        <button
          type="button"
          aria-current={active === item.id ? 'page' : undefined}
          aria-label={item.label}
          class:active={active === item.id}
          onclick={() => (active = item.id)}
        >
          <Icon name={item.icon} />
          <span class="word">{item.label}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    gap: 2px;
    background: var(--surface);
    border-radius: 24px;
    box-shadow: var(--shadow);
    width: fit-content;
    max-width: 100%;
  }
  li {
    flex: 1 1 auto;
    min-width: 0;
  }
  button {
    width: 100%;
    height: 44px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--muted);
    font-size: 15px;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button.active {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  @media (max-width: 600px) {
    ul {
      width: 100%;
    }
    li {
      flex: 0 0 44px;
    }
    li:has(.active) {
      flex: 1 1 auto;
    }
    button {
      padding: 0 12px;
    }
    button:not(.active) .word {
      display: none;
    }
  }
</style>
