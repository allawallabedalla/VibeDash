<script lang="ts" module>
  export interface OriginPart {
    value: number;
    color: string;
    label: string;
  }
</script>

<script lang="ts">
  /** Where the power comes from right now: one soft stacked bar plus a small legend. */
  import { num } from '../i18n/index.svelte';
  let { parts }: { parts: OriginPart[] } = $props();

  const shown = $derived(parts.filter((p) => p.value > 0));
  const sum = $derived(shown.reduce((s, p) => s + p.value, 0));
  const pct = (v: number) => num((100 * v) / sum);
</script>

<div class="bar" class:empty={!sum} aria-hidden="true">
  {#each shown as p (p.label)}<span style:flex={p.value} style:background={p.color}></span>{/each}
</div>
{#if sum}
  <div class="legend">
    {#each shown as p (p.label)}<span
        ><i style:background={p.color}></i>{p.label} {pct(p.value)} %</span
      >{/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    gap: 3px;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--track);
  }
  .bar span {
    border-radius: 6px;
    transition: flex 0.8s ease;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 5px;
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
  }
  .legend i {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 4px;
  }
</style>
