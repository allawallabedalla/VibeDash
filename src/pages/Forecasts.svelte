<script lang="ts">
  /** Forecasts: accuracy per model first, then the forecast itself and the next days. */
  import { currentData, currentSource } from '../app/data.svelte';
  import { tomorrowTile, yieldTodayTile } from '../app/tiles';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import Card from '../components/Card.svelte';
  import DayList, { type DayRow } from '../components/DayList.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import {
    accuracy,
    checkForecasts,
    dayAheadForecasts,
    dayAheadLoad,
    mulberry32,
    outlook,
    pvTimeSeries,
    type Period,
  } from '../demo';
  import { i18n, num, t } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';
  import WeatherCard from './WeatherCard.svelte';
  import ServiceForecasts from './ServiceForecasts.svelte';

  const house = currentData();

  const tz = house.timeZone;
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  const sun = accuracy(checkForecasts(house, dayAheadForecasts(house), 'pv_energy'));
  const load = accuracy(checkForecasts(house, dayAheadLoad(house), 'load_energy'));
  const loadTomorrow = dayAheadLoad(house).find((f) => f.day === 'tomorrow')?.energy;

  const tiles = $derived([
    yieldTodayTile(house),
    tomorrowTile(house),
    loadTomorrow
      ? {
          label: t('tile.loadTomorrow'),
          icon: 'home' as const,
          color: 'var(--home)',
          approx: true,
          value: num(loadTomorrow.value),
          unit: 'kWh',
          sub: t('sub.range', {
            low: num(loadTomorrow.low),
            high: num(loadTomorrow.high),
            n: loadTomorrow.n,
          }),
          graphic: {
            kind: 'scale' as const,
            value: loadTomorrow.value,
            min: 0,
            max: Math.ceil(loadTomorrow.high / 10) * 10 + 10,
            band: { low: loadTomorrow.low, high: loadTomorrow.high },
          },
          info: {
            what: t('info.loadTomorrow.what'),
            source: t('info.loadTomorrow.source', { n: loadTomorrow.n }),
          },
        }
      : {
          label: t('tile.loadTomorrow'),
          icon: 'home' as const,
          color: 'var(--home)',
          value: '–',
          sub: t('state.noData'),
        },
  ]);

  let period = $state<Period>('month');
  // The weather outlook is made up; it only exists for the demo household.
  const showOutlook = currentSource() === 'demo';
  // With a forecasting service, its cards replace the built-in models.
  let serviceActive = $state(false);
  const tsData = $derived(pvTimeSeries(house, period));

  const days = showOutlook ? outlook(house, mulberry32(7)) : [];
  const dayRows = $derived<DayRow[]>(
    days.map((d) => ({
      label:
        d.offset === 0
          ? t('days.today')
          : new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(
              d.start + 12 * 3_600_000,
            ),
      sky: d.sky,
      skyLabel: t(`sky.${d.sky}`),
      tempLow: d.tempLow,
      tempHigh: d.tempHigh,
      rainMm: d.rainMm,
      sunHours: d.sunHours,
      energy: d.energy,
    })),
  );
</script>

<div class="page">
  <PageHead title={t('page.forecasts')} />
  <div class="row-gap"></div>

  <TileRow count={3}>
    {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  {#if !showOutlook}<ServiceForecasts bind:active={serviceActive} />{/if}
  {#if !serviceActive}
    <h2>{t('page.models')}</h2>
    <div class="cards">
      <AccuracyCard label={t('model.sun')} pct={sun.pct} n={sun.n} history={sun.history} />
      <AccuracyCard label={t('model.load')} pct={load.pct} n={load.n} history={load.history} />
    </div>
    <p class="muted-note">{t('page.method')}</p>
  {/if}

  <h2>{t('gallery.timeseries')}</h2>
  <Card title={t('ts.title')} icon="sun" color="var(--sun)">
    <SoftTimeSeries
      data={tsData}
      periods={[
        { id: 'day', label: t('ts.day') },
        { id: 'week', label: t('ts.week') },
        { id: 'month', label: t('ts.month') },
      ]}
      bind:period={() => period, (v) => (period = v as Period)}
      labels={{
        actual: t('ts.actual'),
        forecast: t('ts.forecast'),
        band: t('ts.band'),
        periods: t('ts.periods'),
        empty: t('state.noData'),
      }}
      unit={tsData.unit === 'kW' ? 'kW' : t('ts.perDay')}
      timeZone={tz}
      {locale}
    />
  </Card>

  {#if showOutlook}
    <h2>{t('days.title')}</h2>
    <Card
      title={t('days.title')}
      icon="cloudSun"
      color="var(--sun)"
      note={t('days.note', { n: days[0]?.energy.n ?? 0 })}
    >
      <DayList days={dayRows} />
    </Card>
  {:else}
    <WeatherCard timeZone={tz} />
  {/if}
</div>
