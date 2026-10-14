<script lang="ts">
  /** Forecasts: accuracy per model first, then the forecast itself and the next days. */
  import { demo } from '../app/data';
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

  const tz = demo.timeZone;
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  const sun = accuracy(checkForecasts(demo, dayAheadForecasts(demo), 'pv_energy'));
  const load = accuracy(checkForecasts(demo, dayAheadLoad(demo), 'load_energy'));
  const loadTomorrow = dayAheadLoad(demo).find((f) => f.day === 'tomorrow')!.energy;

  const tiles = $derived([
    yieldTodayTile(demo),
    tomorrowTile(demo),
    {
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
    },
  ]);

  let period = $state<Period>('month');
  const tsData = $derived(pvTimeSeries(demo, period));

  const days = outlook(demo, mulberry32(7));
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

  <h2>{t('page.models')}</h2>
  <div class="cards">
    <AccuracyCard label={t('model.sun')} pct={sun.pct} n={sun.n} history={sun.history} />
    <AccuracyCard label={t('model.load')} pct={load.pct} n={load.n} history={load.history} />
  </div>
  <p class="muted-note">{t('page.method')}</p>

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
      }}
      unit={tsData.unit === 'kW' ? 'kW' : t('ts.perDay')}
      timeZone={tz}
      {locale}
    />
  </Card>

  <h2>{t('days.title')}</h2>
  <Card
    title={t('days.title')}
    icon="cloudSun"
    color="var(--sun)"
    note={t('days.note', { n: days[0]!.energy.n })}
  >
    <DayList days={dayRows} />
  </Card>
</div>
