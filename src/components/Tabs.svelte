<script lang="ts">
  /**
   * Main areas as one row of soft pills (icon + word), the active one tinted.
   * Phone: the same row, swipeable instead of squeezed; 44 px targets.
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
    padding: 2px;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  ul::-webkit-scrollbar {
    display: none;
  }
  li {
    flex: 0 0 auto;
  }
  button {
    height: 44px;
    padding: 0 16px 0 13px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 0;
    border-radius: 999px;
    background: var(--gap);
    color: var(--text-2);
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:hover {
    background: color-mix(in srgb, var(--gap) 160%, transparent);
  }
  button.active {
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 650;
  }

  /* wide screens: every tab visible, a second row instead of a hidden scroll (Audit04 UX-05) */
  @media (min-width: 601px) {
    ul {
      flex-wrap: wrap;
      overflow-x: visible;
    }
  }
  @media (max-width: 600px) {
    /* the right edge fades while more tabs follow; the extra end padding lets the last one leave the fade */
    ul {
      margin: 0 -16px;
      padding: 2px 44px 2px 16px;
      mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent);
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent);
    }
    button {
      padding: 0 14px 0 11px;
    }
  }
</style>
