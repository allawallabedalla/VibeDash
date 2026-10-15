<script lang="ts" module>
  export interface WeatherCardDay {
    label: string;
    /** past = measured, today, ahead = forecast */
    when: 'past' | 'today' | 'ahead';
    tempHigh: number | null;
    tempLow: number | null;
    rainMm: number | null;
    sunHours: number | null;
    pv: { value: number; low?: number; high?: number; approx: boolean } | null;
    pvSoFar?: number | null;
  }
</script>

<script lang="ts">
  /**
   * Days as small cards: three measured, today, three ahead – sky, high/low,
   * sun hours and rain, and the solar yield (measured or expected with span).
   * Phone: four per row, today first, then the days ahead, then the past.
   */
  import { num, t } from '../i18n/index.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let { days }: { days: WeatherCardDay[] } = $props();

  const sky = (d: WeatherCardDay): IconName =>
    d.rainMm !== null && d.rainMm >= 2 && (d.sunHours === null || d.sunHours < 4)
      ? 'rain'
      : d.rainMm !== null && d.rainMm >= 0.5
        ? 'rain'
        : d.sunHours === null
          ? 'cloud'
          : d.sunHours >= 6
            ? 'sun'
            : d.sunHours >= 2
              ? 'cloudSun'
              : 'cloud';
  const deg = (v: number | null) => (v === null ? '–' : `${num(v)}°`);
</script>

<div class="days">
  {#each days as d (d.label)}
    <article class="day {d.when}">
      <header>
        <b>{d.label}</b>
        <span class="kind">{d.when === 'past' ? t('wd.measured') : t('wd.forecast')}</span>
      </header>
      <div class="middle">
        <span class="sky" class:sunny={sky(d) === 'sun'}><Icon name={sky(d)} size={24} /></span>
        <span class="temp"><b>{deg(d.tempHigh)}</b><small>{deg(d.tempLow)}</small></span>
      </div>
      <div class="line">
        {d.sunHours === null ? '–' : num(d.sunHours)} h {t('wd.sun')} · {d.rainMm === null
          ? '–'
          : num(d.rainMm, 1)} mm
      </div>
      <div class="pv">
        <Icon name="sun" size={14} />
        {#if d.pv}
          <span
            >{t('wd.pv')}
            {d.pv.approx ? '≈ ' : ''}{num(d.pv.value)} kWh</span
          >
        {:else}
          <span>{t('wd.pv')} –</span>
        {/if}
      </div>
      {#if d.pv?.approx && d.pv.low !== undefined && d.pv.high !== undefined && d.pv.high > d.pv.low}
        <div class="span">{num(d.pv.low)}–{num(d.pv.high)} kWh</div>
      {/if}
      {#if d.when === 'today' && d.pvSoFar !== null && d.pvSoFar !== undefined}
        <div class="span">{t('wd.soFar', { v: num(d.pvSoFar) })}</div>
      {/if}
    </article>
  {/each}
</div>

<style>
  .days {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
  .day {
    background: var(--surface-2);
    border-radius: 14px;
    padding: 9px 11px 9px;
    min-width: 0;
    border: 1.5px solid transparent;
  }
  .day.ahead {
    background: transparent;
    border: 1.5px dashed var(--line);
  }
  .day.today {
    background: var(--surface);
    border: 1.5px solid #ff9f0a;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    font-size: 14px;
    white-space: nowrap;
  }
  .kind {
    font-size: var(--small);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .middle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .sky {
    display: inline-flex;
    color: var(--text-2);
  }
  .sky.sunny {
    color: var(--sun);
  }
  .temp b {
    display: block;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.05;
  }
  .temp small {
    display: block;
    font-size: var(--small);
    color: var(--muted);
  }
  .line {
    margin-top: 6px;
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pv {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 14px;
    font-weight: 700;
    color: var(--fair-text);
    white-space: nowrap;
  }
  :global(:root[data-theme='dark']) .pv {
    color: var(--sun);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .pv {
      color: var(--sun);
    }
  }
  .span {
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
  }

  @media (max-width: 1000px) {
    .days {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .day.ahead {
      order: -1;
    }
    .day.today {
      order: -2;
    }
  }
  @media (max-width: 600px) {
    .days {
      gap: 6px;
    }
    .day {
      padding: 7px 8px;
    }
    .kind,
    .line {
      display: none;
    }
    .middle {
      gap: 4px;
      margin-top: 3px;
    }
    .temp b {
      font-size: 18px;
    }
  }
</style>
