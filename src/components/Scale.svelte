<script lang="ts">
  /**
   * Horizontal scale: track from min to max, an optional green comfort zone,
   * an optional soft band (usual range, forecast span), an optional dark range
   * (e.g. coolest to warmest room) and a dot for the current value.
   * `temperature` paints the track cold blue → warm orange.
   */
  interface Props {
    value?: number;
    min: number;
    max: number;
    band?: { low: number; high: number };
    /** Comfort zone, drawn green. */
    zone?: { low: number; high: number };
    /** Spread of several readings, drawn dark. */
    range?: { low: number; high: number };
    color?: string;
    /** Optional thin tick, e.g. the median of the band. */
    tick?: number;
    temperature?: boolean;
    /** Show min and max under the track. */
    ends?: string[];
  }
  let {
    value,
    min,
    max,
    band,
    zone,
    range,
    color = 'var(--text)',
    tick,
    temperature = false,
    ends,
  }: Props = $props();

  const p = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
</script>

<div class="scale" class:temperature aria-hidden="true">
  {#if zone}
    <span class="zone" style:left="{p(zone.low)}%" style:width="{p(zone.high) - p(zone.low)}%"
    ></span>
  {/if}
  {#if band}
    <span
      class="band"
      style:left="{p(band.low)}%"
      style:width="{Math.max(1.5, p(band.high) - p(band.low))}%"
      style:background={color}
    ></span>
  {/if}
  {#if range}
    <span
      class="range"
      style:left="{p(range.low)}%"
      style:width="{Math.max(2, p(range.high) - p(range.low))}%"
    ></span>
  {/if}
  {#if tick !== undefined}
    <span class="tick" style:left="{p(tick)}%" style:background={color}></span>
  {/if}
  {#if value !== undefined}
    <span class="dot" style:left="{p(value)}%" style:border-color={color}></span>
  {/if}
</div>
{#if ends}
  <div class="ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>
{/if}

<style>
  .scale {
    position: relative;
    height: 8px;
    margin: 4px 0;
    border-radius: 4px;
    background: var(--track);
  }
  .scale.temperature {
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(90deg, #bfe0ff, #e6f2ff 45%, #ffe9d6 70%, #ffc9b0);
  }
  :global(:root[data-theme='dark']) .scale.temperature {
    background: linear-gradient(90deg, #1f3d5c, #24313f 45%, #3f3024 70%, #5c3424);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .scale.temperature {
      background: linear-gradient(90deg, #1f3d5c, #24313f 45%, #3f3024 70%, #5c3424);
    }
  }
  .zone,
  .band,
  .range,
  .tick,
  .dot {
    position: absolute;
  }
  .zone {
    top: 0;
    bottom: 0;
    border-radius: inherit;
    background: rgba(52, 199, 123, 0.22);
  }
  .temperature .zone {
    background: rgba(52, 199, 123, 0.18);
    outline: 1px dashed rgba(52, 199, 123, 0.6);
  }
  .band {
    top: 2px;
    bottom: 2px;
    border-radius: 3px;
    opacity: 0.35;
  }
  .range {
    top: 2px;
    bottom: 2px;
    border-radius: 4px;
    background: var(--text);
    opacity: 0.55;
  }
  .tick {
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    opacity: 0.8;
  }
  .dot {
    top: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    margin-top: 5px;
    font-size: var(--small);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
