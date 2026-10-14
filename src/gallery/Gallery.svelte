<script lang="ts">
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import DayList, { type DayRow } from '../components/DayList.svelte';
  import Icon from '../components/Icon.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import SourceArc from '../components/SourceArc.svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import Tabs from '../components/Tabs.svelte';
  import TileRow from '../components/TileRow.svelte';
  import Card from './Card.svelte';
  import Progress from '../components/Progress.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tile from '../components/Tile.svelte';
  import {
    accuracy,
    BATTERY_CAPACITY_WH,
    checkForecasts,
    mulberry32,
    outlook,
    pvTimeSeries,
    sourcesAt,
    type Period,
    daily,
    generateDemo,
    last24h,
    latest,
    typicalDay,
    typicalProfile,
  } from '../demo';
  import { i18n, num, t, time } from '../i18n/index.svelte';

  const demo = generateDemo();
  const tz = demo.timeZone;

  const kw = (w: number | null) => (w === null ? null : w / 1000);
  const now = (id: string) => latest(demo, id)?.v ?? NaN;

  const pv = now('pv_power');
  const load = now('load_power');
  const soc = now('battery_soc');
  const grid = now('grid_power');
  const temp = now('living_temp');
  const humidity = now('living_humidity');

  const pv24 = last24h(demo, 'pv_power').map(kw);
  const load24 = last24h(demo, 'load_power').map(kw);
  const grid24 = last24h(demo, 'grid_power').map(kw);
  const temp24 = last24h(demo, 'living_temp');
  const loadBand = typicalProfile(demo, 'load_power');
  const loadBandKw = { low: loadBand.low.map(kw), high: loadBand.high.map(kw) };

  const yieldEst = typicalDay(demo, 'pv_energy');
  const yieldSoFar = daily(demo, 'pv_energy').at(-1)!.value;

  const sensorGap = demo.issues.find(
    (i) => i.kind === 'gap' && i.entityIds.includes('living_temp'),
  )!;

  const signed = (v: number, digits: number) =>
    `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), digits)}`;

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

  function toggleTheme() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
  }
</script>

<div class="page">
  <header class="top">
    <div>
      <h1>VibeDash <span>{t('gallery.title')}</span></h1>
      <p class="subtitle">{t('gallery.subtitle')}</p>
    </div>
    <div class="actions">
      <div class="seg" role="group" aria-label={t('toggle.lang')}>
        {#each ['de', 'en'] as const as l (l)}
          <button type="button" aria-pressed={i18n.locale === l} onclick={() => (i18n.locale = l)}
            >{l.toUpperCase()}</button
          >
        {/each}
      </div>
      <button type="button" class="round" aria-label={t('toggle.theme')} onclick={toggleTheme}>
        <Icon name="contrast" />
      </button>
    </div>
  </header>

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
    <Tile
      label={t('tile.sun')}
      icon="sun"
      color="var(--sun)"
      value={num(pv / 1000, 1)}
      unit="kW"
      sub={t('sub.now')}
      graphic={{ kind: 'spark', values: pv24, min: 0 }}
      info={{ what: t('info.sun.what'), source: t('info.sun.source') }}
    />
    <Tile
      label={t('tile.home')}
      icon="home"
      color="var(--home)"
      value={num(load / 1000, 1)}
      unit="kW"
      sub={t('sub.now')}
      graphic={{ kind: 'spark', values: load24, min: 0 }}
      info={{ what: t('info.home.what'), source: t('info.home.source') }}
    />
    <Tile
      label={t('tile.battery')}
      icon="battery"
      color="var(--battery)"
      value={num(soc)}
      unit="%"
      sub="{num(((soc / 100) * BATTERY_CAPACITY_WH) / 1000, 1)} / {num(
        BATTERY_CAPACITY_WH / 1000,
        0,
      )} kWh"
      graphic={{ kind: 'ring', value: soc / 100 }}
      info={{ what: t('info.battery.what'), source: t('info.battery.source') }}
    />
    <Tile
      label={grid >= 0 ? t('tile.feedIn') : t('tile.import')}
      icon="grid"
      color={grid >= 0 ? 'var(--feed)' : 'var(--import)'}
      value={signed(grid / 1000, 1)}
      unit="kW"
      sub={t('sub.now')}
      graphic={{ kind: 'spark', values: grid24, signed: true, color: 'var(--feed)' }}
      info={{ what: t('info.grid.what'), source: t('info.grid.source') }}
    />
  </TileRow>
  <div class="spacer"></div>
  <TileRow count={3}>
    <Tile
      label={t('tile.temp')}
      icon="thermometer"
      color="var(--climate)"
      value={num(temp, 1)}
      unit="°C"
      sub={t('sub.comfort', { low: num(20), high: num(24) })}
      graphic={{ kind: 'scale', value: temp, min: 16, max: 28, band: { low: 20, high: 24 } }}
      info={{ what: t('info.temp.what'), source: t('info.temp.source') }}
    />
    <Tile
      label={t('tile.humidity')}
      icon="droplet"
      color="var(--climate)"
      value={num(humidity)}
      unit="%"
      sub={t('sub.comfort', { low: num(40), high: num(60) })}
      graphic={{ kind: 'scale', value: humidity, min: 20, max: 80, band: { low: 40, high: 60 } }}
      status="look"
      statusLabel={t('info.humidity.what')}
      info={{ what: t('info.humidity.what'), source: t('info.humidity.source') }}
    />
    <Tile
      label={t('tile.yield')}
      icon="forecast"
      color="var(--sun)"
      approx
      value={num(yieldEst.value)}
      unit="kWh"
      sub={t('sub.range', { low: num(yieldEst.low), high: num(yieldEst.high), n: yieldEst.n })}
      graphic={{
        kind: 'scale',
        value: yieldSoFar,
        min: 0,
        max: Math.ceil(yieldEst.high / 10) * 10 + 10,
        band: { low: yieldEst.low, high: yieldEst.high },
        tick: yieldEst.value,
      }}
      info={{ what: t('info.yield.what'), source: t('info.yield.source', { n: yieldEst.n }) }}
    />
  </TileRow>

  <h2>{t('gallery.sources')}</h2>
  <div class="cards">
    {#each arcMoments as a (a.at)}
      {@const title = t(a.at < demo.now - 14 * 3_600_000 ? 'sources.yesterday' : 'sources.today', {
        time: time(a.at, tz),
      })}
      <Card {title} icon="home" color="var(--home)">
        {#if a.src}
          <SourceArc
            parts={srcParts(a.src)}
            total={num(a.src.total / 1000, 1)}
            caption={t('tile.home')}
          />
        {:else}
          <p class="empty">{t('sources.gap')}</p>
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
  <p class="foot">{t('acc.sunNote')}</p>

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
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 28px 32px 48px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  h1 span {
    font-weight: 400;
    color: var(--muted);
    margin-left: 6px;
  }
  .subtitle {
    margin: 2px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .seg {
    display: flex;
    background: var(--surface);
    border-radius: 22px;
    box-shadow: var(--shadow);
  }
  .seg button {
    min-width: 48px;
    height: 44px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .round {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--muted);
  }
  h2 {
    margin: 32px 0 12px;
    font-size: var(--small);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .spacer {
    height: 16px;
  }
  .empty,
  .foot {
    margin: 0;
    color: var(--muted);
    font-size: var(--small);
  }
  .foot {
    margin-top: 10px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .ratings {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px;
  }

  /* Phone: own layout, not just stacked. */
  @media (max-width: 600px) {
    .page {
      padding: 16px 16px 40px;
    }
    .top {
      align-items: flex-start;
    }
    h1 {
      font-size: 20px;
    }
    h1 span {
      display: block;
      margin: 0;
      font-size: 15px;
    }
    h2 {
      margin: 24px 0 10px;
    }
    .spacer {
      height: 10px;
    }
    .cards {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .ratings {
      grid-template-columns: 1fr;
      gap: 18px;
    }
  }
</style>
