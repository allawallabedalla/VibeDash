<script lang="ts">
  /** M2: first real page. First level tiles, then today, then look-back table, then questions. */
  import { currentData, currentSource } from '../app/data.svelte';
  import { questions } from '../app/questions';
  import { reviewRows } from '../app/review';
  import {
    autarkyTile,
    batteryTile,
    gridTile,
    loadTile,
    sunTile,
    tempTile,
    tomorrowTile,
    yieldTodayTile,
  } from '../app/tiles';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Icon from '../components/Icon.svelte';
  import Segmented from '../components/Segmented.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import SourceArc from '../components/SourceArc.svelte';
  import StatusBar, { type StatusItem } from '../components/StatusBar.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { pvTimeSeries, sourcesAt, type Period } from '../demo';
  import { i18n, num, t } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';

  const house = currentData();

  const tz = house.timeZone;
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  const qs = $derived(questions(house, currentSource()));
  const status = $derived.by<StatusItem[]>(() => {
    const item = (area: 'energy' | 'battery' | 'climate'): StatusItem => {
      const n = qs.filter((q) => q.area === area).length;
      const name = t(`area.${area}`);
      return n === 0
        ? { label: t('area.ok', { area: name }), state: 'ok' }
        : {
            label: t('area.question', {
              area: name,
              count: n === 1 ? t('q.one') : t('q.count', { n }),
            }),
            state: 'look',
          };
    };
    return [item('energy'), item('battery'), item('climate')];
  });

  const row1 = $derived([sunTile(house), loadTile(house), batteryTile(house), gridTile(house)]);
  const row2 = $derived([
    yieldTodayTile(house),
    tomorrowTile(house),
    autarkyTile(house),
    tempTile(house),
  ]);

  let period = $state<Period>('day');
  const tsData = $derived(pvTimeSeries(house, period));

  const src = sourcesAt(house, house.now - 60_000);

  let reviewCount = $state<'7' | '30'>('7');
  const rows = $derived(reviewRows(house, Number(reviewCount)));
  const columns = $derived([
    { key: 'day', label: t('review.day') },
    { key: 'sun', label: t('review.sun'), align: 'right' as const },
    { key: 'load', label: t('review.load'), align: 'right' as const },
    { key: 'feed', label: t('review.feed'), align: 'right' as const, phone: false },
    { key: 'import', label: t('review.import'), align: 'right' as const, phone: false },
    { key: 'autarky', label: t('review.autarky'), align: 'right' as const },
  ]);
</script>

<div class="page">
  <PageHead title={t('page.overview')} />

  <div class="status"><StatusBar label={t('status.label')} items={status} /></div>

  <TileRow count={4}>
    {#each row1 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>
  <div class="row-gap"></div>
  <TileRow count={4}>
    {#each row2 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('page.today')}</h2>
  <div class="cards wide-left">
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
    <Card title={t('page.sources')} icon="home" color="var(--home)">
      {#if src}
        <SourceArc
          parts={[
            { label: t('sources.sun'), value: src.sun, color: 'var(--sun)' },
            { label: t('sources.battery'), value: src.battery, color: 'var(--battery)' },
            { label: t('sources.grid'), value: src.grid, color: 'var(--import)' },
          ]}
          total={num(src.total / 1000, 1)}
          caption={t('tile.home')}
        />
      {:else}
        <p class="muted-note">{t('sources.gap')}</p>
      {/if}
    </Card>
  </div>

  <h2>{t('page.review')}</h2>
  <Card title={t('review.title')} icon="clock" color="var(--muted)" note={t('review.unit')}>
    {#snippet actions()}
      <Segmented
        options={[
          { id: '7', label: t('ts.week') },
          { id: '30', label: t('ts.month') },
        ]}
        bind:value={reviewCount}
        label={t('ts.periods')}
      />
    {/snippet}
    <DataTable {columns} {rows} caption={t('review.title')} />
  </Card>

  {#if qs.length > 0}
    <h2>{t('q.title')}</h2>
    <Card
      title={t('q.open', { count: qs.length === 1 ? t('q.one') : t('q.count', { n: qs.length }) })}
      icon="info"
      color="var(--fair)"
    >
      <ul class="questions">
        {#each qs as q (q.id)}
          <li><span class="qicon"><Icon name="info" size={18} /></span>{q.text}</li>
        {/each}
      </ul>
    </Card>
  {/if}
</div>

<style>
  .status {
    margin: 16px 0 16px;
  }
  .questions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .questions li {
    display: flex;
    gap: 10px;
    line-height: 1.45;
  }
  .qicon {
    flex: none;
    color: var(--fair);
    padding-top: 1px;
  }
</style>
