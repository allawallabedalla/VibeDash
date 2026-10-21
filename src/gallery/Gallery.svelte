<script lang="ts">
  import { sourcesAt } from '../app/sources';
  import {
    batteryNowTile,
    batteryTile,
    gridNowTile,
    gridTile,
    loadNowTile,
    sunNowTile,
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
  import FlowBars from '../components/FlowBars.svelte';
  import RoomRanges from '../components/RoomRanges.svelte';
  import Progress from '../components/Progress.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import {
    accuracy,
    generateDemo,
    checkForecasts,
    mulberry32,
    outlook,
    pvTimeSeries,
    type Period,
    last24h,
    last24hEnergy,
    typicalProfile,
  } from '../demo';
  import GridCard from '../pages/GridCard.svelte';
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
  const rowNow = $derived([
    sunNowTile(demo),
    loadNowTile(demo),
    batteryNowTile(demo),
    gridNowTile(demo),
  ]);
  // The small graphics a tile can carry beyond the house tiles above.
  const rowKinds = $derived<TileProps[]>([
    {
      label: t('tile.autarky'),
      icon: 'target',
      color: 'var(--battery)',
      value: num(82),
      unit: '%',
      sub: t('gallery.kind.ring'),
      graphic: { kind: 'ring', value: 0.82 },
    },
    {
      label: t('gallery.kind.dryDays'),
      icon: 'cloudSun',
      color: 'var(--climate)',
      value: '5 / 7',
      sub: t('gallery.kind.share'),
      graphic: { kind: 'share', have: 5, of: 7 },
    },
    {
      label: t('gallery.kind.manual'),
      icon: 'bolt',
      color: 'var(--fair)',
      value: num(3),
      sub: t('gallery.kind.dots'),
      graphic: { kind: 'dots', value: 3, max: 10 },
    },
    {
      label: t('gallery.kind.week'),
      icon: 'forecast',
      color: 'var(--sun)',
      value: num(41),
      unit: 'kWh',
      sub: t('gallery.kind.compare'),
      graphic: { kind: 'compare', now: 41, before: 35 },
    },
    {
      label: t('gallery.kind.inside'),
      icon: 'thermometer',
      color: 'var(--climate)',
      value: `${num(21)}–${num(23)}`,
      unit: '°C',
      sub: t('gallery.kind.range'),
      graphic: {
        kind: 'scale',
        min: 16,
        max: 28,
        zone: { low: 20, high: 23 },
        range: { low: 21, high: 23.4 },
        temperature: true,
        ends: ['16°', '28°'],
      },
    },
  ]);

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
      when: d.offset === 0 ? 'today' : d.offset < 0 ? 'past' : 'forecast',
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

  <h2>{t('gallery.nowTiles')}</h2>
  <TileRow count={4}>
    {#each rowNow as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('gallery.kinds')}</h2>
  <TileRow count={5}>
    {#each rowKinds as tile (tile.label)}<Tile {...tile} />{/each}
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
    <GridCard
      values={grid24}
      importKwh={last24hEnergy(demo, 'import_energy')}
      feedKwh={last24hEnergy(demo, 'feed_in_energy')}
    />
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
        forecast: t(`ts.fc.${tsData.kind}`),
        recomputed: t('ts.fc.recomputed'),
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
      label={t('model.sunRule')}
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

  {#await import('../pages/YearSection.svelte') then { default: YearSection }}<YearSection
      house={demo}
    />{/await}

  <h2>{t('week.house')}</h2>
  <div class="cards">
    <Card
      title={t('week.rooms')}
      icon="thermometer"
      color="var(--climate)"
      note={t('week.roomsNote')}
    >
      <RoomRanges
        label={t('week.rooms')}
        rooms={[
          { name: t('gallery.room.living'), low: 20.4, high: 23.1, mean: 22.0 },
          { name: t('gallery.room.office'), low: 22.1, high: 24.6, mean: 23.4 },
          { name: t('gallery.room.bath'), low: 21.2, high: 24.0, mean: 23.1 },
          { name: t('gallery.room.bedroom'), low: 18.9, high: 21.7, mean: 20.4 },
        ]}
      />
    </Card>
    <Card title={t('week.whereTo')} icon="sun" color="var(--sun)">
      <FlowBars
        flows={[
          {
            label: t('week.toHouse'),
            value: 62,
            color: 'var(--sun-soft)',
            textColor: 'var(--sun-text)',
          },
          {
            label: t('week.toBattery'),
            value: 103,
            color: 'var(--battery)',
            textColor: 'var(--good-text)',
          },
          {
            label: t('week.toGrid'),
            value: 108,
            color: 'var(--feed)',
            textColor: 'var(--feed-text)',
          },
        ]}
      />
    </Card>
  </div>

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
