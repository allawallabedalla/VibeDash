<script lang="ts" module>
  import type { OriginPart } from './OriginBar.svelte';

  export type TileGraphic =
    | { kind: 'ring'; value: number; color?: string }
    | {
        kind: 'scale';
        value?: number;
        min: number;
        max: number;
        band?: { low: number; high: number };
        /** Comfort zone, green. */
        zone?: { low: number; high: number };
        /** Spread of several readings, dark. */
        range?: { low: number; high: number };
        tick?: number;
        temperature?: boolean;
        ends?: string[];
        color?: string;
      }
    | {
        kind: 'spark';
        values: (number | null)[];
        /** Own forecast line (dashed) on the same slots. */
        forecast?: (number | null)[];
        color?: string;
        signed?: boolean;
        band?: { low: (number | null)[]; high: (number | null)[] };
        min?: number;
      }
    /** Sun now as a half arc, share 0–1 of the plant's peak. */
    | { kind: 'arc'; share: number; off?: boolean }
    /** Where the power comes from right now. */
    | { kind: 'origin'; parts: OriginPart[] }
    /** Battery filling with the charge; flow in W (> 0 charging). */
    | { kind: 'battery'; soc: number; flow?: number }
    /** Grid from the middle: W > 0 feed-in (right), < 0 import (left). */
    | { kind: 'pendulum'; watts: number; range?: number }
    /** Count as dots, e.g. 3 of 10. */
    | { kind: 'dots'; value: number; max: number; color?: string }
    /** a of b: dots up to 12, a bar above. */
    | { kind: 'share'; have: number; of: number; color?: string }
    /** Now against before (two bars). */
    | { kind: 'compare'; now: number; before: number; color?: string };

  export interface TileProps {
    label: string;
    icon: import('./Icon.svelte').IconName;
    color?: string;
    value: string;
    unit?: string;
    /** Marks an approximation; pair it with a range and n in `sub`. */
    approx?: boolean;
    sub?: string;
    graphic?: TileGraphic;
    /** Only for real need of action; "ok" shows nothing. */
    status?: 'look' | 'act';
    statusLabel?: string;
    info?: { what: string; source: string };
    /** Short marker, e.g. "being checked" until the person confirmed the value. */
    pending?: string;
    /**
     * Tap to enlarge: the series behind the tile (ids in the house data), drawn
     * for 24 h / 7 / 30 days with min, max, mean and n. Without it the enlarged
     * tile shows the value, the graphic larger and the explanation.
     */
    zoom?: TileZoomSpec;
  }

  export interface TileZoomSpec {
    lines: { id: string; label: string; color: string; scale?: number }[];
    unit: string;
    digits?: number;
    /** axis around the values instead of from zero */
    tight?: boolean;
  }
</script>

<script lang="ts">
  /** Value + 1–2 words + one small graphic. Details behind ⓘ. */
  import Explanation from './Explanation.svelte';
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';
  import InfoButton from './InfoButton.svelte';
  import { flip } from './flip';
  import BatteryGauge from './BatteryGauge.svelte';
  import Compare from './Compare.svelte';
  import Dots from './Dots.svelte';
  import OriginBar from './OriginBar.svelte';
  import Pendulum from './Pendulum.svelte';
  import Ring from './Ring.svelte';
  import Scale from './Scale.svelte';
  import Sparkline from './Sparkline.svelte';
  import SunArc from './SunArc.svelte';

  let {
    label,
    icon,
    color = 'var(--text)',
    value,
    unit,
    approx = false,
    sub,
    graphic,
    status,
    statusLabel,
    info,
    pending,
    zoom,
  }: TileProps = $props();

  const uid = $props.id();
  let open = $state(false);
  let el = $state<HTMLElement>();
  const toggle = () => flip(el, !open, () => (open = !open));
  /** enlarged tile (dialog), loaded only when tapped */
  let zoomed = $state(false);
</script>

<article class="tile" class:open bind:this={el}>
  <header>
    <span class="icon" style:color><Icon name={icon} /></span>
    <span class="label">{label}</span>
    {#if status}
      <span class="status {status}" role="img" aria-label={statusLabel ?? status}></span>
    {/if}
    {#if info}
      <InfoButton {open} ontoggle={toggle} controls="{uid}-info" />
    {/if}
  </header>

  {#if open && info}
    <div id="{uid}-info" class="details">
      <Explanation what={info.what} source={info.source} />
    </div>
  {:else}
    <div class="body" class:with-ring={graphic?.kind === 'ring'}>
      <div class="reading">
        <div class="value">
          {#if approx}<span class="approx">≈</span>{/if}{value}{#if unit}<span class="unit"
              >{unit}</span
            >{/if}
        </div>
        {#if sub}<div class="sub">{sub}</div>{/if}
        {#if pending}<div class="pending">{pending}</div>{/if}
      </div>
      {#if graphic?.kind === 'ring'}
        <Ring value={graphic.value} color={graphic.color ?? color} />
      {/if}
    </div>

    {#if graphic && graphic.kind !== 'ring'}
      <div class="graphic">
        {#if graphic.kind === 'scale'}
          <Scale
            value={graphic.value}
            min={graphic.min}
            max={graphic.max}
            band={graphic.band}
            zone={graphic.zone}
            range={graphic.range}
            tick={graphic.tick}
            temperature={graphic.temperature}
            ends={graphic.ends}
            color={graphic.color ?? (graphic.temperature ? 'var(--text)' : color)}
          />
        {:else if graphic.kind === 'spark'}
          <Sparkline
            values={graphic.values}
            forecast={graphic.forecast}
            color={graphic.color ?? color}
            signed={graphic.signed}
            band={graphic.band}
            min={graphic.min}
            height={40}
            {label}
          />
        {:else if graphic.kind === 'arc'}
          <SunArc share={graphic.share} off={graphic.off} />
        {:else if graphic.kind === 'origin'}
          <OriginBar parts={graphic.parts} />
        {:else if graphic.kind === 'battery'}
          <BatteryGauge soc={graphic.soc} flow={graphic.flow} />
        {:else if graphic.kind === 'pendulum'}
          <Pendulum watts={graphic.watts} range={graphic.range} />
        {:else if graphic.kind === 'dots'}
          <Dots value={graphic.value} max={graphic.max} color={graphic.color ?? color} />
        {:else if graphic.kind === 'share'}
          {#if graphic.of <= 12}
            <Dots value={graphic.have} max={graphic.of} color={graphic.color ?? color} />
          {:else}
            <div class="share">
              <span
                style:width="{(100 * graphic.have) / Math.max(1, graphic.of)}%"
                style:background={graphic.color ?? color}
              ></span>
            </div>
          {/if}
        {:else if graphic.kind === 'compare'}
          <Compare now={graphic.now} before={graphic.before} color={graphic.color ?? color} />
        {/if}
      </div>
    {/if}
  {/if}
  <!-- the whole tile is a tap target for the enlarged view; ⓘ sits above it (last, so ⓘ comes first) -->
  {#if !open}
    <button
      type="button"
      class="hit"
      aria-label={t('zoom.open', { label })}
      aria-haspopup="dialog"
      onclick={() => (zoomed = true)}
    ></button>
  {/if}
</article>

{#if zoomed}
  {#await import('./TileZoom.svelte') then { default: TileZoom }}
    <TileZoom
      tile={{ label, icon, color, value, unit, approx, sub, graphic, status, info, pending, zoom }}
      onclose={() => (zoomed = false)}
    />
  {/await}
{/if}

<style>
  .tile {
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow);
    padding: 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 150px;
    min-width: 0;
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    padding-right: 30px;
  }
  .hit {
    position: absolute;
    inset: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: zoom-in;
    z-index: 1;
  }
  .hit:focus-visible {
    outline: 2px solid var(--home);
    outline-offset: 2px;
  }
  .icon {
    display: inline-flex;
  }
  .label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
    line-height: 1.2;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* ⓘ sits in the corner (44 px target) so the label keeps its width. */
  header > :global(.info) {
    position: absolute;
    top: 3px;
    right: 3px;
    margin: 0;
    /* stays tappable above the tile's tap target */
    z-index: 2;
  }
  .status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    margin-left: 4px;
  }
  .status.look {
    background: var(--fair);
  }
  .status.act {
    background: var(--poor);
  }
  .body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .reading {
    min-width: 0;
  }
  .value {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    /* numbers stay on one line; a long word value (from a board) may break instead of widening the page */
    overflow-wrap: anywhere;
  }
  .approx {
    font-weight: 400;
    color: var(--muted);
    margin-right: 2px;
  }
  .unit {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    margin-left: 3px;
    letter-spacing: 0;
  }
  .sub {
    font-size: var(--small);
    color: var(--muted);
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .graphic {
    margin-top: auto;
    padding-top: 4px;
  }
  .share {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    overflow: hidden;
  }
  .share span {
    display: block;
    height: 100%;
    border-radius: 4px;
  }
  .pending {
    display: inline-block;
    margin-top: 6px;
    padding: 1px 8px;
    border-radius: 9px;
    font-size: var(--small);
    color: var(--muted);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .details {
    color: var(--text);
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* a long explanation scrolls; the soft edge says there is more */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
    padding-bottom: 14px;
  }

  @media (max-width: 600px) {
    .tile {
      padding: 10px 12px 12px;
      min-height: 130px;
      border-radius: 14px;
    }
    .value {
      font-size: 26px;
    }
    .unit,
    .sub {
      font-size: 14px;
    }
  }
</style>
