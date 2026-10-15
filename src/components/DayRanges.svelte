<script lang="ts">
  /** From–to per day as a rounded capsule (e.g. battery charge lowest–highest). */
  import { num } from '../i18n/index.svelte';

  interface Props {
    ranges: ({ low: number; high: number } | null)[];
    labels: string[];
    color: string;
    min?: number;
    max?: number;
    unit: string;
    partial?: number;
    label: string;
  }
  let { ranges, labels, color, min = 0, max = 100, unit, partial, label }: Props = $props();

  const p = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
</script>

<div class="days" role="img" aria-label={label}>
  {#each ranges as r, i (i)}
    <div
      class="day"
      class:now={i === partial}
      title="{labels[i]}: {r ? `${num(r.low)}–${num(r.high)} ${unit}` : '–'}"
    >
      <div class="col">
        {#if r}
          <span class="hi" style:bottom="calc({p(r.high)}% + 4px)">{num(r.high)}</span>
          <span
            class="cap"
            style:bottom="{p(r.low)}%"
            style:height="max(10px, {p(r.high) - p(r.low)}%)"
            style:background={color}
          ></span>
          <span class="lo" style:top="calc({100 - p(r.low)}% + 4px)">{num(r.low)}</span>
        {/if}
      </div>
      <span class="d">{labels[i]}</span>
    </div>
  {/each}
</div>

<style>
  .days {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 6px;
    height: 170px;
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  .col {
    position: relative;
    flex: 1;
    width: 100%;
    margin: 20px 0 22px;
  }
  .cap {
    position: absolute;
    left: 50%;
    width: 10px;
    margin-left: -5px;
    border-radius: 5px;
  }
  .now .cap {
    opacity: 0.55;
  }
  .hi,
  .lo {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    font-size: var(--small);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .d {
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
  }
  .now .d {
    color: var(--text);
    font-weight: 600;
  }
</style>
