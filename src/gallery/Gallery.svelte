<script lang="ts">
  import {
    batteryTile,
    gridTile,
    humidityTile,
    loadTile,
    sunTile,
    tempTile,
    yieldTodayTile,
  } from '../app/tiles';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import DayList, { type DayRow } from '../components/DayList.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import SourceArc from '../components/SourceArc.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import Tabs from '../components/Tabs.svelte';
  import TileRow from '../components/TileRow.svelte';
  import Card from '../components/Card.svelte';
  import Progress from '../components/Progress.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tile from '../components/Tile.svelte';
  import {
    accuracy,
    generateDemo,
    checkForecasts,
    mulberry32,
    outlook,
    pvTimeSeries,
    sourcesAt,
    type Period,
    last24h,
    typicalProfile,
  } from '../demo';
  import { i18n, num, t, time } from '../i18n/index.svelte';
  import { localMidnight } from '../model/time';

  // The gallery always shows the synthetic demo household.
  const demo = generateDemo();
  const tz = demo.timeZone;

  const kw = (w: number | null) => (w === null ? null : w / 1000);

  const pv24 = last24h(demo, 'pv_power').map(kw);
  const load24 = last24h(demo, 'load_power').map(kw);
  const grid24 = last24h(demo, 'grid_power').map(kw);
  const temp24 = last24h(demo, 'living_temp');
  const loadBand = typicalProfile(demo, 'load_power');
  const loadBandKw = { low: loadBand.low.map(kw), high: loadBand.high.map(kw) };

  const sensorGap = demo.issues.find(
    (i) => i.kind === 'gap' && i.entityIds.includes('living_temp'),
  )!;

  const row1 = $derived([sunTile(demo), loadTile(demo), batteryTile(demo), gridTile(demo)]);
  const row2 = $derived([tempTile(demo), humidityTile(demo), yieldTodayTile(demo)]);

  const sunAccuracy = accuracy(checkForecasts(demo));
  const days = outlook(demo, mulberry32(7));
  const dayRows = $derived<DayRow[]>(
    days.map((d) => ({
      label:
        d.offset === 0
          ? t('days.today')
          : new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
              timeZone: tz,
              weekday: 'short',
            }).format(d.start + 12 * 3_600_000),
      sky: d.sky,
      skyLabel: t(`sky.${d.sky}`),
      tempLow: d.tempLow,
      tempHigh: d.tempHigh,
      rainMm: d.rainMm,
      sunHours: d.sunHours,
      energy: d.energy,
    })),
  );

  // Two moments with mixed sources: yesterday evening (sun + battery), this morning (sun + grid).
  const arcMoments = [demo.now - 19 * 3_600_000, demo.now - 7.5 * 3_600_000].map((at) => ({
    at,
    src: sourcesAt(demo, at),
  }));
  const srcParts = (s: NonNullable<ReturnType<typeof sourcesAt>>) => [
    { label: t('sources.sun'), value: s.sun, color: 'var(--sun)' },
    { label: t('sources.battery'), value: s.battery, color: 'var(--battery)' },
    { label: t('sources.grid'), value: s.grid, color: 'var(--import)' },
  ];

  let period = $state<Period>('day');
  const tsData = $derived(pvTimeSeries(demo, period));

  let tab = $state('overview');
  const tabs = $derived([
    { id: 'overview', label: t('tabs.overview'), icon: 'overview' as const },
    { id: 'now', label: t('tabs.now'), icon: 'bolt' as const },
    { id: 'maintenance', label: t('tabs.maintenance'), icon: 'wrench' as const },
    { id: 'garden', label: t('tabs.garden'), icon: 'leaf' as const },
    { id: 'devices', label: t('tabs.devices'), icon: 'clock' as const },
    { id: 'forecasts', label: t('tabs.forecasts'), icon: 'forecast' as const },
  ]);

  // Sample ratings (synthetic, for the gallery only).
  const ratings = [
    { key: 'sample.good', pct: 82, n: 28 },
    { key: 'sample.fair', pct: 61, n: 28 },
    { key: 'sample.open', pct: null, n: 2, from: 'model.batteryFrom' },
  ] as const;
</script>

<div class="page">
  <h1>{t('gallery.title')}</h1>
  <p class="lead">{t('gallery.subtitle')}</p>

  <h2>{t('gallery.tabs')}</h2>
  <Tabs items={tabs} bind:active={tab} label={t('tabs.label')} />

  <h2>{t('gallery.status')}</h2>
  <StatusBar
    label={t('status.label')}
    items={[
      { label: t('status.modules'), state: 'ok' },
      { label: t('status.battery'), state: 'ok' },
      { label: t('status.night'), state: 'ok' },
      { label: t('status.humidity'), state: 'look' },
    ]}
  />

  <h2>{t('gallery.tiles')}</h2>
  <TileRow count={4}>
    {#each row1 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>
  <div class="row-gap"></div>
  <TileRow count={3}>
    {#each row2 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('gallery.sources')}</h2>
  <div class="cards">
    {#each arcMoments as a (a.at)}
      {@const title = t(
        a.at < localMidnight(demo.now, tz) ? 'sources.yesterday' : 'sources.today',
        {
          time: time(a.at, tz),
        },
      )}
      <Card {title} icon="home" color="var(--home)">
        {#if a.src}
          <SourceArc
            parts={srcParts(a.src)}
            total={num(a.src.total / 1000, 1)}
            caption={t('tile.home')}
          />
        {:else}
          <p class="muted-note">{t('sources.gap')}</p>
        {/if}
      </Card>
    {/each}
  </div>

  <h2>{t('gallery.sparklines')}</h2>
  <div class="cards">
    <Card title={t('spark.sun')} icon="sun" color="var(--sun)">
      <Sparkline values={pv24} color="var(--sun)" min={0} label={t('spark.sun')} />
    </Card>
    <Card
      title={t('spark.home')}
      icon="home"
      color="var(--home)"
      note={t('spark.homeBand', { n: loadBand.n })}
    >
      <Sparkline
        values={load24}
        band={loadBandKw}
        color="var(--home)"
        min={0}
        label={t('spark.home')}
      />
    </Card>
    <Card title={t('spark.grid')} icon="grid" color="var(--feed)" note={t('spark.gridNote')}>
      <Sparkline values={grid24} signed color="var(--feed)" label={t('spark.grid')} />
    </Card>
    <Card
      title={t('spark.temp')}
      icon="thermometer"
      color="var(--climate)"
      note={t('spark.gap', { from: time(sensorGap.from, tz), to: time(sensorGap.to, tz) })}
    >
      <Sparkline values={temp24} color="var(--climate)" label={t('spark.temp')} />
    </Card>
  </div>

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
      locale={i18n.locale === 'de' ? 'de-DE' : 'en-GB'}
    />
  </Card>

  <h2>{t('gallery.days')}</h2>
  <Card
    title={t('days.title')}
    icon="cloudSun"
    color="var(--sun)"
    note={t('days.note', { n: days[0]!.energy.n })}
  >
    <DayList days={dayRows} />
  </Card>

  <h2>{t('acc.title')}</h2>
  <div class="cards">
    <AccuracyCard
      label={t('model.sun')}
      pct={sunAccuracy.pct}
      n={sunAccuracy.n}
      history={sunAccuracy.history}
    />
    <AccuracyCard
      label={t('model.battery')}
      pct={null}
      n={2}
      history={[null, null]}
      openFrom={t('model.batteryFrom')}
    />
  </div>
  <p class="muted-note">{t('acc.sunNote')}</p>

  <h2>{t('gallery.progress')}</h2>
  <Card
    title={t('gallery.progressCard')}
    icon="target"
    color="var(--muted)"
    note={t('gallery.progressNote')}
  >
    <div class="ratings">
      {#each ratings as r (r.key)}
        <Progress
          label={t(r.key)}
          pct={r.pct}
          n={r.n}
          openFrom={'from' in r ? t(r.from) : undefined}
        />
      {/each}
    </div>
  </Card>
</div>

<style>
  .ratings {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px;
  }
  @media (max-width: 600px) {
    .ratings {
      grid-template-columns: 1fr;
      gap: 18px;
    }
  }
</style>
