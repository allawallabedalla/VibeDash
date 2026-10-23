<script lang="ts">
  import type { Snippet } from 'svelte';
  import Explanation from './Explanation.svelte';
  import { flip } from './flip';
  import Icon, { type IconName } from './Icon.svelte';
  import InfoButton from './InfoButton.svelte';

  interface Props {
    title: string;
    icon?: IconName;
    color?: string;
    note?: string;
    info?: { what: string; source: string };
    /** Controls in the header, e.g. a period choice. */
    actions?: Snippet;
    children: Snippet;
  }
  let { title, icon, color, note, info, actions, children }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
  let el = $state<HTMLElement>();
  const toggle = () => flip(el, !open, () => (open = !open));
</script>

<section class="card" class:back={open} bind:this={el}>
  <header>
    {#if icon}<span class="icon" style:color><Icon name={icon} /></span>{/if}
    <h3>{title}</h3>
    <span class="spacer"></span>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
    {#if info}<InfoButton {open} ontoggle={toggle} controls="{uid}-info" />{/if}
  </header>
  {#if open && info}
    <div id="{uid}-info" class="flip-back">
      <Explanation what={info.what} source={info.source} />
    </div>
  {:else}
    {@render children()}
    {#if note}<p class="note">{note}</p>{/if}
  {/if}
</section>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    border: 2px solid var(--border);
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon {
    display: inline-flex;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
  }
  .spacer {
    flex: 1;
  }
  .actions {
    margin: -6px 0;
  }
  .flip-back {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* a long explanation scrolls; the soft edge says there is more */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
    padding-bottom: 14px;
  }
  .note {
    margin: 0;
    font-size: var(--small);
    color: var(--muted);
    /* a long address in a note wraps instead of widening the page (Audit04 UX-04) */
    overflow-wrap: anywhere;
  }
</style>
