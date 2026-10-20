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
  import WeatherDaysCard from './WeatherDaysCard.svelte';
  import { hasWeatherDays } from '../app/weather-days';
  import ServiceForecasts from './ServiceForecasts.svelte';
  import PvForecastCard from './PvForecastCard.svelte';
  import PlanAccuracyCard from './PlanAccuracyCard.svelte';
  import { store } from '../app/data.svelte';
  import { houseDayForecasts } from '../app/houseForecast';

  const house = $derived(currentData());

  const tz = $derived(house.timeZone);
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  // the house's own PV forecast is judged when there is one; else the built-in rule (G-13, Audit04 ST-02)
  const own = $derived(houseDayForecasts(house));
  const sun = $derived(
    accuracy(checkForecasts(house, own.length ? own : dayAheadForecasts(house), 'pv_energy')),
  );
  // the house without the car when it has that meter: charging days made the range 19–35 kWh (Audit04 ST-14)
  const loadId = $derived(house.series.home_energy?.samples.length ? 'home_energy' : 'load_energy');
  const load = $derived(accuracy(checkForecasts(house, dayAheadLoad(house, loadId), loadId)));
  const loadTomorrow = $derived(
    dayAheadLoad(house, loadId).find((f) => f.day === 'tomorrow')?.energy,
  );

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
          sub:
            t('sub.range', {
              low: num(loadTomorrow.low),
              high: num(loadTomorrow.high),
              n: loadTomorrow.n,
            }) + (loadId === 'home_energy' ? ` · ${t('sub.noCar')}` : ''),
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

  const days = $derived(showOutlook ? outlook(house, mulberry32(7)) : []);
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
      when: d.offset === 0 ? 'today' : d.offset < 0 ? 'past' : 'forecast',
    })),
  );
</script>

<div class="page">
  <PageHead title={t('page.forecasts')} />
  <div class="row-gap"></div>

  <TileRow count={3}>
    {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  {#if !showOutlook}<ServiceForecasts onactive={(v) => (serviceActive = v)} />{/if}
  {#if !serviceActive}
    <h2>{t('page.models')}</h2>
    <div class="cards">
      <AccuracyCard
        label={own.length ? t('model.sun') : t('model.sunRule')}
        pct={sun.pct}
        n={sun.n}
        interval={sun.interval}
        history={sun.history}
      />
      <AccuracyCard
        label={t('model.load')}
        pct={load.pct}
        n={load.n}
        interval={load.interval}
        history={load.history}
      />
      {#if showOutlook}<PlanAccuracyCard demo />{/if}
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
        forecast: t(`ts.fc.${tsData.kind}`),
        recomputed: t('ts.fc.recomputed'),
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
    {#if store.pv}<PvForecastCard timeZone={tz} />{/if}
    {#if store.plan}
      <div class="cards"><PlanAccuracyCard demo={false} /></div>
    {/if}
    <!-- one weather source per house (G-13, Audit04 DA-03): the house's own weather days when it has them,
         like Overview and Week; else the server's Open-Meteo forecast -->
    {#if hasWeatherDays(house)}
      <WeatherDaysCard {house} />
    {:else}
      <WeatherCard timeZone={tz} />
    {/if}
  {/if}
</div>
