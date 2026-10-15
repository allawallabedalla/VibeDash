<script lang="ts">
  /**
   * Days as rows, like a weather app: day · sky · rain · low ▬▬ high · sun
   * hours · expected yield with range. The bar takes the colour of its
   * temperatures on one shared scale, a blue mark shows 0 °C on frosty days.
   * Phone: sun hours drop out.
   */
  import type { Estimate } from '../model/types';
  import { num, t } from '../i18n/index.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  export interface DayRow {
    label: string;
    sky: IconName;
    skyLabel: string;
    tempLow: number;
    tempHigh: number;
    rainMm: number | null;
    sunHours: number | null;
    /** Expected yield with range; omitted when there is no forecast for it. */
    energy?: Estimate;
    /** Today is set off; past days are measured, the rest forecast. */
    when?: 'past' | 'today' | 'forecast';
  }
  let { days }: { days: DayRow[] } = $props();

  const lo = $derived(Math.floor(Math.min(...days.map((d) => d.tempLow)) - 1));
  const hi = $derived(Math.ceil(Math.max(...days.map((d) => d.tempHigh)) + 1));
  const pos = (v: number) => ((v - lo) / Math.max(hi - lo, 1)) * 100;
  // cold blue → green → yellow → orange → red, like a weather app
  const STOPS: [number, string][] = [
    [-5, '#2a78d6'],
    [3, '#5fb3e8'],
    [10, '#5cc28a'],
    [16, '#e9c43b'],
    [22, '#f08a2c'],
    [28, '#d03b3b'],
  ];
  const tone = (v: number) => STOPS.reduce((c, [g, col]) => (v >= g ? col : c), STOPS[0]![1]);
</script>

<div class="row head" aria-hidden="true">
  <span>{t('days.day')}</span><span></span><span class="rain">{t('days.rain')}</span>
  <span class="temp">{t('days.low')}</span><span></span><span class="temp high"
    >{t('days.high')}</span
  >
  <span class="sunh">{t('days.sun')}</span><span class="kwh">kWh</span>
</div>
<ul class="days">
  {#each days as d (d.label)}
    <li class="row {d.when ?? ''}">
      <span class="day">{d.label}</span>
      <span class="sky" role="img" aria-label={d.skyLabel}><Icon name={d.sky} /></span>
      <span class="rain"
        >{#if d.rainMm && d.rainMm >= 0.5}{num(d.rainMm, 1)} mm{/if}</span
      >
      <span class="temp low" class:frost={d.tempLow < 0}>{num(d.tempLow)}°</span>
      <span class="range" aria-hidden="true">
        <span
          class="fill"
          style:left="{pos(d.tempLow)}%"
          style:width="{Math.max(2, pos(d.tempHigh) - pos(d.tempLow))}%"
          style:background="linear-gradient(90deg, {tone(d.tempLow)}, {tone(d.tempHigh)})"
        ></span>
        {#if lo < 0 && hi > 0 && d.tempLow < 3}<span class="zero" style:left="{pos(0)}%"
          ></span>{/if}
      </span>
      <span class="temp high">{num(d.tempHigh)}°</span>
      <span class="sunh">{d.sunHours === null ? '–' : `${num(d.sunHours)} h`}</span>
      <span class="kwh">
        {#if d.energy}
          <span class="v"><span class="approx">≈</span>{num(d.energy.value)}</span>
          <span class="r">{num(d.energy.low)}–{num(d.energy.high)}</span>
        {:else}
          <span class="r">–</span>
        {/if}
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
  .row {
    display: grid;
    grid-template-columns: 64px 26px 64px 40px minmax(60px, 1fr) 40px 48px 64px;
    align-items: center;
    column-gap: 10px;
    min-height: 44px;
    padding: 0 6px;
    border-top: 1px solid var(--line);
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }
  .head {
    min-height: 26px;
    border-top: 0;
    font-size: var(--small);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .head .kwh {
    text-transform: none;
  }
  li.today {
    font-weight: 700;
    background: var(--surface-2);
    border-radius: 8px;
    border-top-color: transparent;
  }
  li.today + li {
    border-top-color: transparent;
  }
  li.past .day {
    color: var(--text-2);
  }
  .day {
    white-space: nowrap;
  }
  .sky {
    display: inline-flex;
    justify-content: center;
    color: var(--text-2);
  }
  .temp {
    text-align: right;
  }
  .low {
    color: var(--text-2);
  }
  .low.frost {
    color: var(--rain);
    font-weight: 700;
  }
  .range {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--track);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
  }
  .zero {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: #2a78d6;
    opacity: 0.7;
  }
  .rain {
    color: var(--rain);
    font-size: 14px;
    white-space: nowrap;
  }
  .head .rain {
    color: var(--muted);
    font-size: var(--small);
  }
  .sunh,
  .kwh {
    text-align: right;
    font-size: 14px;
    white-space: nowrap;
  }
  .sunh {
    color: var(--text-2);
  }
  .kwh {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.15;
  }
  .head .sunh,
  .head .kwh {
    font-size: var(--small);
    color: var(--muted);
  }
  li.today .kwh,
  li.forecast .kwh {
    color: var(--text-2);
  }
  .approx {
    font-weight: 400;
    color: var(--muted);
    margin-right: 2px;
  }
  .r {
    font-size: var(--small);
    font-weight: 400;
    color: var(--muted);
  }

  @media (max-width: 600px) {
    .row {
      grid-template-columns: 46px 22px 50px 30px minmax(30px, 1fr) 30px 54px;
      column-gap: 6px;
      padding: 0 4px;
      font-size: 14px;
    }
    .sunh {
      display: none;
    }
  }
</style>
