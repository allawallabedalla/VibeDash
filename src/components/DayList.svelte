<script lang="ts">
  /**
   * Days as rows, like a weather app: day · sky · low ▬▬ high · rain · sun
   * hours · expected yield with range. Phone: sun hours drop out, rain only
   * when there is any.
   */
  import type { Estimate } from '../model/types';
  import { num } from '../i18n/index.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  export interface DayRow {
    label: string;
    sky: IconName;
    skyLabel: string;
    tempLow: number;
    tempHigh: number;
    rainMm: number;
    sunHours: number;
    energy: Estimate;
  }
  let { days }: { days: DayRow[] } = $props();

  const lo = $derived(Math.min(...days.map((d) => d.tempLow)));
  const hi = $derived(Math.max(...days.map((d) => d.tempHigh)));
  const pos = (v: number) => ((v - lo) / Math.max(hi - lo, 1)) * 100;
</script>

<ul class="days">
  {#each days as d (d.label)}
    <li>
      <span class="day">{d.label}</span>
      <span class="sky" role="img" aria-label={d.skyLabel}><Icon name={d.sky} /></span>
      <span class="temp low">{num(d.tempLow)}°</span>
      <span class="range" aria-hidden="true">
        <span class="fill" style:left="{pos(d.tempLow)}%" style:right="{100 - pos(d.tempHigh)}%"
        ></span>
      </span>
      <span class="temp high">{num(d.tempHigh)}°</span>
      <span class="rain" class:none={d.rainMm === 0}>
        {#if d.rainMm > 0}{num(d.rainMm, 1)} mm{:else}–{/if}
      </span>
      <span class="sunh">{num(d.sunHours, 1)} h</span>
      <span class="kwh">
        <span class="v"><span class="approx">≈</span>{num(d.energy.value)} kWh</span>
        <span class="r">{num(d.energy.low)}–{num(d.energy.high)}</span>
      </span>
    </li>
  {/each}
</ul>

<style>
  .days {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 64px 28px 36px minmax(60px, 1fr) 36px 72px 56px 96px;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    border-top: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }
  li:first-child {
    border-top: 0;
  }
  .day {
    font-weight: 500;
  }
  .sky {
    display: inline-flex;
    color: var(--muted);
  }
  .temp {
    text-align: right;
  }
  .low {
    color: var(--muted);
  }
  .high {
    text-align: left;
  }
  .range {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--climate), var(--sun));
  }
  .rain {
    color: var(--climate);
    font-size: 14px;
    text-align: right;
  }
  .rain.none {
    color: var(--faint);
  }
  .sunh {
    color: var(--muted);
    font-size: 14px;
    text-align: right;
  }
  .kwh {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.2;
  }
  .v {
    font-weight: 600;
    white-space: nowrap;
  }
  .approx {
    font-weight: 400;
    color: var(--muted);
    margin-right: 1px;
  }
  .r {
    font-size: var(--small);
    color: var(--muted);
  }

  @media (max-width: 600px) {
    li {
      grid-template-columns: 52px 24px 30px minmax(40px, 1fr) 30px 84px;
      gap: 8px;
      min-height: 56px;
      position: relative;
    }
    .sunh {
      display: none;
    }
    .rain {
      position: absolute;
      left: 0;
      bottom: 4px;
      text-align: left;
    }
    .rain.none {
      display: none;
    }
  }
</style>
