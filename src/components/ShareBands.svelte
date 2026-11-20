<script lang="ts" module>
  export interface BandSegment {
    label: string;
    value: number | null;
    /** fill colour */
    color: string;
    /** the same hue dark enough for text (WCAG AA) */
    textColor: string;
    approx?: boolean;
  }
  export interface Band {
    label: string;
    segments: BandSegment[];
  }
</script>

<script lang="ts">
  /**
   * 100 % bands under each other on ONE kWh scale (Audit05 I-7): each band is
   * as long as its total, its parts are labelled with kWh and share. The same
   * amount is equally long in every band (G5-06).
   */
  import { num } from '../i18n/index.svelte';
  import { axisMarks, bandLayout, wholePercents } from '../model/shares';

  let { bands, unit = 'kWh', label }: { bands: Band[]; unit?: string; label: string } = $props();

  const layout = $derived(bandLayout(bands.map((b) => b.segments)));
  const marks = $derived(axisMarks(layout.max));
  const pcts = $derived(layout.rows.map((r) => wholePercents(r.parts.map((p) => p.share))));
  let width = $state(600);
  const kwh = (v: number) => num(v, v < 10 ? 1 : 0);
</script>

<div class="bands" role="group" aria-label={label} bind:clientWidth={width}>
  {#each bands as band, k (band.label)}
    {@const row = layout.rows[k]!}
    <div class="band">
      <p class="head">
        <span class="name">{band.label}</span>
        <span class="total"
          >{row.incomplete ? '≥ ' : band.segments.some((s) => s.approx) ? '≈ ' : ''}{kwh(
            row.total,
          )}<span class="unit">{unit}</span></span
        >
      </p>
      <div class="track">
        {#each band.segments as s, i (s.label)}
          {@const part = row.parts[i]!}
          {#if part.width > 0}
            <span
              class="seg"
              style:left="{part.start * 100}%"
              style:width="{part.width * 100}%"
              style:--c={s.color}
              >{#if part.width * width >= 48}<span class="in">{pcts[k]![i]} %</span>{/if}</span
            >
          {/if}
        {/each}
      </div>
      <ul class="legend">
        {#each band.segments as s, i (s.label)}
          <li>
            <span class="key" style:--c={s.color}></span>
            <span class="lbl">{s.label}</span>
            <b style:color={s.textColor}
              >{#if s.value === null}–{:else}{s.approx ? '≈ ' : ''}{kwh(s.value)}
                {unit}{/if}</b
            >
            {#if pcts[k]![i] !== null}<span class="pct">{pcts[k]![i]} %</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/each}
  <div class="axis" aria-hidden="true">
    {#each marks as m, i (m)}
      <span
        class="mark"
        class:first={i === 0}
        class:last={i === marks.length - 1 && m / layout.max > 0.9}
        style:left="{layout.max > 0 ? (m / layout.max) * 100 : 0}%"
        >{num(m, m % 1 ? 1 : 0)}{i === marks.length - 1 ? ` ${unit}` : ''}</span
      >
    {/each}
  </div>
</div>

<style>
  .bands {
    display: flex;
    flex-direction: column;
    gap: 18px;
    /* the axis below the last band */
    padding-bottom: 4px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin: 0 0 6px;
  }
  .name {
    font-size: 15px;
    font-weight: 600;
  }
  .total {
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: 14px;
    margin-left: 3px;
    color: var(--muted);
    font-weight: 500;
  }
  .track {
    position: relative;
    height: 30px;
    border-radius: 8px;
    /* the scale behind the bands: grid lines in the track colour */
    background: var(--track);
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    box-shadow: inset -2px 0 0 var(--surface);
    overflow: hidden;
  }
  /* the colour as a layer under the text (a plain colour for the contrast check, Audit01 DE-01) */
  .seg::before {
    content: '';
    position: absolute;
    inset: 0 2px 0 0;
    background: var(--c);
    opacity: 0.5;
  }
  .seg:first-child {
    border-radius: 8px 0 0 8px;
  }
  .in {
    position: relative;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .legend b {
    font-weight: 600;
    margin-left: 4px;
    white-space: nowrap;
  }
  .pct {
    margin-left: 4px;
    color: var(--muted);
  }
  .key {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    border-radius: 3px;
    vertical-align: -1px;
    background: color-mix(in srgb, var(--c) 55%, var(--surface));
    box-shadow: inset 0 0 0 1px var(--c);
  }
  .axis {
    position: relative;
    height: 20px;
    margin-top: -6px;
    border-top: 1px solid var(--line);
  }
  .mark {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    font-size: 14px;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .mark.first {
    transform: none;
  }
  .mark.last {
    transform: translateX(-100%);
  }
</style>
