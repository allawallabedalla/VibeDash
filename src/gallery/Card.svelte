<script lang="ts">
  import type { Snippet } from 'svelte';
  import Explanation from '../components/Explanation.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import InfoButton from '../components/InfoButton.svelte';

  interface Props {
    title: string;
    icon?: IconName;
    color?: string;
    note?: string;
    info?: { what: string; source: string };
    children: Snippet;
  }
  let { title, icon, color, note, info, children }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
</script>

<section class="card">
  <header>
    {#if icon}<span class="icon" style:color><Icon name={icon} /></span>{/if}
    <h3>{title}</h3>
    <span class="spacer"></span>
    {#if info}<InfoButton bind:open controls="{uid}-info" />{/if}
  </header>
  {#if open && info}
    <div id="{uid}-info"><Explanation what={info.what} source={info.source} /></div>
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
  .note {
    margin: 0;
    font-size: var(--small);
    color: var(--muted);
  }
</style>
