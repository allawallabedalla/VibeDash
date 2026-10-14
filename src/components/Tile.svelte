<script lang="ts" module>
  export type TileGraphic =
    | { kind: 'ring'; value: number; color?: string }
    | {
        kind: 'scale';
        value: number;
        min: number;
        max: number;
        band?: { low: number; high: number };
        tick?: number;
        color?: string;
      }
    | {
        kind: 'spark';
        values: (number | null)[];
        color?: string;
        signed?: boolean;
        band?: { low: (number | null)[]; high: (number | null)[] };
        min?: number;
      };

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
  }
</script>

<script lang="ts">
  /** Value + 1–2 words + one small graphic. Details behind ⓘ. */
  import Explanation from './Explanation.svelte';
  import Icon from './Icon.svelte';
  import InfoButton from './InfoButton.svelte';
  import Ring from './Ring.svelte';
  import Scale from './Scale.svelte';
  import Sparkline from './Sparkline.svelte';

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
  }: TileProps = $props();

  const uid = $props.id();
  let open = $state(false);
</script>

<article class="tile" class:open>
  <header>
    <span class="icon" style:color><Icon name={icon} /></span>
    <span class="label">{label}</span>
    {#if status}
      <span class="status {status}" role="img" aria-label={statusLabel ?? status}></span>
    {/if}
    {#if info}
      <InfoButton bind:open controls="{uid}-info" />
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

    {#if graphic?.kind === 'scale'}
      <div class="graphic">
        <Scale
          value={graphic.value}
          min={graphic.min}
          max={graphic.max}
          band={graphic.band}
          tick={graphic.tick}
          color={graphic.color ?? color}
        />
      </div>
    {:else if graphic?.kind === 'spark'}
      <div class="graphic">
        <Sparkline
          values={graphic.values}
          color={graphic.color ?? color}
          signed={graphic.signed}
          band={graphic.band}
          min={graphic.min}
          height={40}
          {label}
        />
      </div>
    {/if}
  {/if}
</article>

<style>
  .tile {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 150px;
    min-width: 0;
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    padding-right: 26px;
  }
  .icon {
    display: inline-flex;
  }
  .label {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.2;
    min-width: 0;
  }
  /* ⓘ sits in the corner (44 px target) so the label keeps its width. */
  header > :global(.info) {
    position: absolute;
    top: 3px;
    right: 3px;
    margin: 0;
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
  .value {
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .approx {
    font-weight: 400;
    color: var(--muted);
    margin-right: 2px;
  }
  .unit {
    font-size: 15px;
    font-weight: 500;
    color: var(--muted);
    margin-left: 4px;
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
  }

  @media (max-width: 600px) {
    .tile {
      padding: 12px 12px 14px;
      min-height: 140px;
      border-radius: 18px;
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
