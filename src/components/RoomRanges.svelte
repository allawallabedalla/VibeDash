<script lang="ts" module>
  export interface RoomRange {
    name: string;
    low: number;
    high: number;
    mean: number;
  }
</script>

<script lang="ts">
  /**
   * Rooms as rows, warmest first: name with the mean, a soft bar from the
   * coolest to the warmest value and a dark mark at the mean, on one shared
   * scale with a few degree lines.
   */
  import { num } from '../i18n/index.svelte';

  let {
    rooms,
    unit = '°C',
    label,
  }: { rooms: RoomRange[]; unit?: string; label: string } = $props();

  const sorted = $derived([...rooms].sort((a, b) => b.mean - a.mean));
  const lo = $derived(Math.floor(Math.min(...rooms.map((r) => r.low)) - 1));
  const hi = $derived(Math.ceil(Math.max(...rooms.map((r) => r.high)) + 1));
  const p = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  const ticks = $derived.by(() => {
    const out: number[] = [];
    for (let v = Math.ceil(lo / 5) * 5; v <= hi; v += 5) out.push(v);
    return out;
  });
</script>

<div class="rooms" role="img" aria-label={label}>
  {#each sorted as r (r.name)}
    <span class="name">{r.name} <span class="mean">Ø {num(r.mean, 1)}°</span></span>
    <span class="lane">
      {#each ticks as v (v)}<span class="grid" style:left="{p(v)}%"></span>{/each}
      <span class="bar" style:left="{p(r.low)}%" style:width="{Math.max(1, p(r.high) - p(r.low))}%"
      ></span>
      <span class="tick" style:left="{p(r.mean)}%"></span>
    </span>
  {/each}
  <span></span>
  <span class="axis">
    {#each ticks as v (v)}<span style:left="{p(v)}%">{num(v)} {unit}</span>{/each}
  </span>
</div>

<style>
  .rooms {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 14px;
    row-gap: 10px;
  }
  .name {
    text-align: right;
    font-size: 15px;
    white-space: nowrap;
  }
  .mean {
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }
  .lane {
    position: relative;
    height: 28px;
  }
  .grid {
    position: absolute;
    top: -6px;
    bottom: -6px;
    width: 1px;
    background: var(--line);
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    background: color-mix(in srgb, var(--text) 18%, var(--surface));
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 1px;
    background: var(--text);
  }
  .axis {
    position: relative;
    height: 20px;
    font-size: var(--small);
    color: var(--text-2);
  }
  .axis span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  @media (max-width: 600px) {
    .name {
      font-size: 14px;
    }
    .lane {
      height: 22px;
    }
  }
</style>
