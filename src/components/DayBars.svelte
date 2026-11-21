<script lang="ts">
  /** One soft bar per day with its value on top; the running day lighter, a gap a grey dash. */
  import { num } from '../i18n/index.svelte';

  interface Props {
    values: (number | null)[];
    labels: string[];
    color: string;
    unit: string;
    /** Index of the running day, drawn lighter. */
    partial?: number;
    label: string;
    /** optional mean (same unit): a dashed line across the bars */
    mean?: number;
  }
  let { values, labels, color, unit, partial, label, mean }: Props = $props();

  const top = $derived(Math.max(1e-9, mean ?? 0, ...values.map((v) => v ?? 0)));
  /** many bars carry no numbers of their own: a y-axis with round marks (1-2-5) instead (Nutzer 21.11.2026) */
  const dense = $derived(values.length > 24);
  const max = $derived.by(() => {
    if (!dense) return top;
    const p = 10 ** Math.floor(Math.log10(top));
    return ([1, 2, 2.5, 5, 10].find((k) => k * p >= top) ?? 10) * p;
  });
  const meanAt = $derived(mean === undefined ? null : Math.max(0, mean) / max);
</script>

<div class="wrap" class:axis={dense}>
  {#if dense}
    <div class="ticks" aria-hidden="true">
      {#each [max, max / 2, 0] as m (m)}<span style:--at={m / max}>{num(m, m % 1 ? 1 : 0)}</span
        >{/each}
    </div>
  {/if}
  <div class="days" class:many={values.length > 8} class:dense role="img" aria-label={label}>
    {#if dense}{#each [1, 0.5] as g (g)}<span class="grid" style:--at={g} aria-hidden="true"
        ></span>{/each}{/if}
    {#each values as v, i (i)}
      <div
        class="day"
        class:now={i === partial}
        title="{labels[i]}: {v === null ? '–' : `${num(v, 1)} ${unit}`}"
      >
        <div class="col">
          {#if meanAt !== null && v !== null && v !== undefined}<span
              class="mean"
              style:--at={meanAt}
            ></span>{/if}
          {#if v !== null && v !== undefined}
            <!-- 0 is a value, only null is a gap (Audit05 G5-04) -->
            <span class="v" class:zero={v === 0}
              >{num(v, Number.isInteger(v) || Math.abs(v) >= 10 ? 0 : 1)}</span
            >
            <span
              class="bar"
              style:height="{(100 * Math.max(v, 0)) / max}%"
              style:background={color}
            ></span>
          {:else}
            <span class="dash"></span>
          {/if}
        </div>
        <span class="d">{labels[i]}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .wrap.axis {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px;
  }
  /* y-axis of dense bars: marks at 0, half and the round top; the plot is the 150 px minus the label row */
  .ticks {
    position: relative;
    height: calc(150px - 5px - 1.4em);
    margin-top: 0;
    min-width: 2ch;
  }
  .ticks span {
    position: absolute;
    right: 0;
    bottom: calc(var(--at) * (100% - 18px));
    transform: translateY(50%);
    font-size: var(--small);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(5px + 1.4em + var(--at) * (150px - 5px - 1.4em - 18px));
    border-top: 1px solid var(--line);
    opacity: 0.6;
    pointer-events: none;
  }
  .days {
    position: relative;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 6px;
    height: 150px;
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
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-top: 18px;
    border-bottom: 1px solid var(--line);
  }
  /* the mean: one dash per day, the gaps between the days make the line dashed */
  .mean {
    position: absolute;
    left: 0;
    right: 0;
    /* the tallest bar gives room to its number (about 20 px) */
    bottom: min(calc((100% - 18px) * var(--at)), calc(100% - 38px));
    border-top: 2px dashed var(--text-2);
    opacity: 0.6;
    pointer-events: none;
    z-index: 1;
  }
  .bar {
    width: min(22px, 60%);
    border-radius: 5px 5px 0 0;
    min-height: 2px;
  }
  .now .bar {
    opacity: 0.55;
  }
  .dash {
    width: min(22px, 60%);
    height: 2px;
    border-radius: 1px;
    background: var(--faint);
  }
  .v {
    font-size: var(--small);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    margin-bottom: 3px;
    white-space: nowrap;
  }
  .d {
    margin-top: 5px;
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
    /* a long label (from a board) is cut, never widens the page */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now .d {
    color: var(--text);
    font-weight: 600;
  }
  /* many days on a phone: every third label (counted from today) */
  @media (max-width: 600px) {
    .many .day:not(:nth-last-child(3n + 1)) .d {
      visibility: hidden;
    }
    /* the shown label may use its hidden neighbours' room instead of „Mi.,…“ (Audit04 UX-09) */
    .many .d {
      max-width: none;
      overflow: visible;
    }
    /* very many bars (48 hours, 30 days): every sixth label, numbers only in the title */
    .dense .day:not(:nth-last-child(6n + 1)) .d {
      visibility: hidden;
    }
    .dense .day:nth-last-child(6n + 1) .d {
      visibility: visible;
    }
    .dense .v {
      visibility: hidden;
    }
  }
  /* very many bars on a wide screen: a 0 needs no number of its own */
  .dense .v.zero {
    visibility: hidden;
  }
  /* a day of quarter hours (more than 60 bars; the two grid lines come first): thin gaps, numbers only in the
     title, a time every 3 hours – on the phone every 6 hours (CSS only: no script for the first-page budget) */
  .days:has(> .day:nth-child(63)) {
    gap: 1px;
  }
  .days:has(> .day:nth-child(63)) .v {
    visibility: hidden;
  }
  .days:has(> .day:nth-child(63)) .day:not(:nth-child(12n + 3)) .d {
    visibility: hidden;
  }
  .days:has(> .day:nth-child(63)) .day:nth-child(12n + 3) .d {
    visibility: visible;
    max-width: none;
    overflow: visible;
  }
  @media (max-width: 600px) {
    .days:has(> .day:nth-child(63)) .day:not(:nth-child(24n + 3)) .d {
      visibility: hidden;
    }
  }
</style>
