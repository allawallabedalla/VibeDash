<script lang="ts">
  /**
   * One stacked bar per day (e.g. the car's energy from sun / battery / grid), the total on
   * top where there is room. 0 is the bare baseline, a day without any record a small
   * hollow ring (a gap, never 0); the running day lighter. Labels: every 7th day from today.
   */
  import { num } from '../i18n/index.svelte';

  interface Props {
    /** per day the parts in the order of `colors`; null = no record */
    values: (number[] | null)[];
    colors: string[];
    labels: string[];
    unit: string;
    /** index of the running day, drawn lighter */
    partial?: number;
    label: string;
    /** text for each part in the hover title */
    names: string[];
  }
  let { values, colors, labels, unit, partial, label, names }: Props = $props();

  const total = (p: number[] | null) => (p ? p.reduce((a, v) => a + Math.max(0, v), 0) : 0);
  const max = $derived(Math.max(1e-9, ...values.map(total)));
  const fmt = (v: number) => num(v, v >= 10 ? 0 : 1);
  const title = (i: number) => {
    const p = values[i];
    if (!p) return `${labels[i]}: –`;
    return `${labels[i]}: ${fmt(total(p))} ${unit}${p
      .map((v, k) => (v > 0 ? ` · ${names[k]} ${fmt(v)}` : ''))
      .join('')}`;
  };
</script>

<div class="days" role="img" aria-label={label}>
  {#each values as p, i (i)}
    <div class="day" class:now={i === partial} title={title(i)}>
      <div class="col">
        {#if p}
          {#if total(p) > 0}<span class="v">{fmt(total(p))}</span>{/if}
          <span class="stack" style:height="{(100 * total(p)) / max}%">
            {#each p as v, k (k)}
              {#if v > 0}<span style:flex-grow={v} style:background={colors[k]}></span>{/if}
            {/each}
          </span>
        {:else}
          <span class="gap" aria-hidden="true"></span>
        {/if}
      </div>
      <span class="d" class:show={(values.length - 1 - i) % 7 === 0}>{labels[i]}</span>
    </div>
  {/each}
</div>

<style>
  .days {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    height: 160px;
    /* room for the last label (today) centred under its own bar, never over the page edge */
    padding: 0 20px;
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  .col {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-top: 18px;
    border-bottom: 1px solid var(--line);
  }
  .stack {
    width: min(24px, 76%);
    display: flex;
    flex-direction: column-reverse;
    border-radius: 5px 5px 0 0;
    overflow: hidden;
  }
  .stack span {
    flex-basis: 0;
    min-height: 2px;
  }
  /* parts touch with a thin seam so neighbouring colours stay tellable apart */
  .stack span + span {
    border-bottom: 1px solid var(--surface);
  }
  .now .stack {
    opacity: 0.6;
  }
  .gap {
    width: 7px;
    height: 7px;
    margin-bottom: 3px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--faint);
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
    visibility: hidden;
  }
  .d.show {
    visibility: visible;
  }
  .now .d {
    color: var(--text);
    font-weight: 600;
  }
  /* narrow bars (30 days on a phone): no numbers on top – the title and the table have them */
  @container (max-width: 640px) {
    .v {
      display: none;
    }
  }
  .days {
    container-type: inline-size;
  }
</style>
