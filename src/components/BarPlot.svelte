<script lang="ts">
  /**
   * The small trigger around a bar chart (DayBars, StackDayBars, DayRanges): focusable,
   * vertical scrolling stays with the page (touch-action pan-y); on the first hover,
   * touch or focus it loads the lens (BarLens.svelte, budget). The bars' grid is the
   * first element inside.
   */
  import type { Snippet } from 'svelte';
  import type { BarData } from './bar-lens';
  import { barLensHost } from './lens-host.svelte';
  import { tl } from './lens-text';

  interface Props {
    label: string;
    data: BarData;
    children: Snippet;
  }
  let { label, data, children }: Props = $props();

  const lens = barLensHost();
  let host = $state<HTMLElement>();
  const grid = $derived(lens.Lens && host ? (host.firstElementChild as HTMLElement | null) : null);
</script>

<!-- focusable for the lens: arrow keys step through the bars (role application passes the keys on) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="plot"
  bind:this={host}
  role="application"
  tabindex="0"
  aria-label={tl('hint', { label })}
  onpointerenter={lens.wake}
  onpointerdown={lens.wake}
  onfocus={lens.wake}
>
  {@render children()}
  {#if lens.Lens && host && grid}
    <lens.Lens {host} {grid} first={lens.first} {data} />
  {/if}
</div>

<style>
  .plot {
    position: relative;
    isolation: isolate;
    min-width: 0;
    touch-action: pan-y;
    cursor: crosshair;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    border-radius: 8px;
  }
  .plot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
