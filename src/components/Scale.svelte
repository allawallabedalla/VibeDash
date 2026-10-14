<script lang="ts">
  /**
   * Horizontal scale: track from min to max, an optional soft band (comfort
   * range or usual range) and a dot for the current value.
   */
  interface Props {
    value: number;
    min: number;
    max: number;
    band?: { low: number; high: number };
    color?: string;
    /** Optional thin tick, e.g. the median of the band. */
    tick?: number;
  }
  let { value, min, max, band, color = 'var(--text)', tick }: Props = $props();

  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
</script>

<div class="scale" aria-hidden="true">
  <div class="track"></div>
  {#if band}
    <div
      class="band"
      style:left={pos(band.low)}
      style:width="calc({pos(band.high)} - {pos(band.low)})"
      style:background={color}
    ></div>
  {/if}
  {#if tick !== undefined}
    <div class="tick" style:left={pos(tick)} style:background={color}></div>
  {/if}
  <div class="dot" style:left={pos(value)} style:border-color={color}></div>
</div>

<style>
  .scale {
    position: relative;
    height: 18px;
    margin: 0 7px;
  }
  .track,
  .band {
    position: absolute;
    top: 6px;
    height: 6px;
    border-radius: 3px;
  }
  .track {
    left: -7px;
    right: -7px;
    background: var(--line);
  }
  .band {
    opacity: 0.35;
  }
  .tick {
    position: absolute;
    top: 3px;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    border-radius: 1px;
    opacity: 0.8;
  }
  .dot {
    position: absolute;
    top: 2px;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border-radius: 50%;
    background: var(--surface);
    border: 3px solid;
  }
</style>
