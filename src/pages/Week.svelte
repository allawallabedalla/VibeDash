<script lang="ts">
  /**
   * "Week": now, the last seven days, weather, solar against forecast, battery
   * and consumption per day, and where the energy went.
   */
  import { currentData, currentSource } from '../app/data.svelte';
  import { batteryNowTile, gridNowTile, loadNowTile, sunNowTile } from '../app/tiles';
  import { weekNumbers } from '../app/week';
  import Card from '../components/Card.svelte';
  import DayBars from '../components/DayBars.svelte';
  import DayRanges from '../components/DayRanges.svelte';
  import FlowBars from '../components/FlowBars.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { pvTimeSeries } from '../demo';
  import { i18n, num, t, time } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';
  import WeatherCard from './WeatherCard.svelte';
  import WeatherDaysCard from './WeatherDaysCard.svelte';
  import { hasWeatherDays } from '../app/weather-days';

  const house = currentData();
  const tz = house.timeZone;
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  const w = weekNumbers(house);
  // charts: the seven completed days, then today (lighter, apart from the sums)
  const today = w.days.length;

  const labels = $derived([
    ...w.days.map((d) =>
      new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(
        d.start + 12 * 3_600_000,
      ),
    ),
    t('days.today'),
  ]);
  const dm = (ms: number) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, day: '2-digit', month: '2-digit' }).format(
      ms + 12 * 3_600_000,
    );
  // "07.–13.10." (both days, the month once when it is the same)
  const period = $derived.by(() => {
    const a = dm(w.days[0]!.start);
    const b = dm(w.days.at(-1)!.start);
    return i18n.locale === 'de' && a.slice(3) === b.slice(3)
      ? `${a.slice(0, 3)}–${b}`
      : `${a}–${b}`;
  });
  const until = $derived(t('week.todayUntil', { time: time(house.now, tz) }));
  const periodNote = $derived(`${period}, ${until}`);

  const nowTiles = $derived([
    sunNowTile(house),
    loadNowTile(house),
    batteryNowTile(house),
    gridNowTile(house),
  ]);

  const kwh = (v: number | null) => (v === null ? '–' : num(v, v < 100 ? 1 : 0));
  const known = (v: (number | null)[]) => v.filter((x): x is number => x !== null);
  const socs = w.soc.filter((x) => x !== null);
  const socLow = socs.length ? Math.min(...socs.map((x) => x.low)) : null;
  const socHigh = socs.length ? Math.max(...socs.map((x) => x.high)) : null;
  const nights = known(w.night);
  const nightMean = nights.length ? nights.reduce((s, x) => s + x, 0) / nights.length : null;

  const weekTiles = $derived<TileProps[]>([
    {
      label: t('week.sun'),
      icon: 'sun',
      color: 'var(--sun)',
      value: kwh(w.total.pv),
      unit: 'kWh',
      sub: w.before.pv === null ? undefined : t('week.before', { v: kwh(w.before.pv) }),
      graphic: { kind: 'spark', values: w.pv, min: 0 },
    },
    {
      label: t('week.own'),
      icon: 'target',
      color: 'var(--battery)',
      value: w.autarky === null ? '–' : num(w.autarky * 100),
      unit: w.autarky === null ? undefined : '%',
      sub:
        w.total.imp === null || w.total.load === null
          ? undefined
          : t('week.ownSub', { imp: kwh(w.total.imp), load: kwh(w.total.load) }),
      graphic: w.autarky === null ? undefined : { kind: 'ring', value: w.autarky },
    },
    {
      label: t('week.import'),
      icon: 'grid',
      color: 'var(--import)',
      value: kwh(w.total.imp),
      unit: 'kWh',
      sub: w.before.imp === null ? undefined : t('week.before', { v: kwh(w.before.imp) }),
      graphic: { kind: 'spark', values: w.imp, min: 0 },
    },
    {
      label: t('week.night'),
      icon: 'moon',
      color: 'var(--climate)',
      value: nightMean === null ? '–' : num(nightMean),
      unit: nightMean === null ? undefined : 'W',
      sub: t('week.nightSub'),
      graphic: { kind: 'spark', values: w.night, min: 0 },
    },
    {
      label: t('week.battery'),
      icon: 'battery',
      color: 'var(--battery)',
      value: socLow === null || socHigh === null ? '–' : `${num(socLow)}–${num(socHigh)}`,
      unit: socLow === null ? undefined : '%',
      sub: t('week.batterySub'),
      graphic:
        socLow === null || socHigh === null
          ? undefined
          : {
              kind: 'scale',
              min: 0,
              max: 100,
              range: { low: socLow, high: socHigh },
              ends: ['0 %', '100 %'],
            },
    },
  ]);

  // Where the solar power went and where the house power came from (week sums).
  const charged = w.battery?.charged ?? null;
  const discharged = w.battery?.discharged ?? null;
  const direct =
    w.total.pv === null || w.total.feed === null
      ? null
      : Math.max(0, w.total.pv - w.total.feed - (charged ?? 0));
  const whereTo = $derived([
    { label: t('week.toHouse'), value: direct, color: 'var(--sun-soft)', approx: charged !== null },
    { label: t('week.toBattery'), value: charged, color: 'var(--battery)', approx: true },
    { label: t('week.toGrid'), value: w.total.feed, color: 'var(--feed)' },
  ]);
  const whereFrom = $derived([
    { label: t('week.fromSun'), value: direct, color: 'var(--sun-soft)', approx: charged !== null },
    { label: t('week.fromBattery'), value: discharged, color: 'var(--battery)', approx: true },
    { label: t('week.fromGrid'), value: w.total.imp, color: 'var(--import)' },
  ]);

  const tsData = pvTimeSeries(house, 'week');
  // The made-up weather only exists for the demo household.
  const demo = currentSource() === 'demo';
</script>

<div class="page">
  <PageHead title={t('page.week')} />

  {#if demo || hasWeatherDays(house)}
    <WeatherDaysCard {house} />
  {:else}
    <WeatherCard timeZone={tz} />
  {/if}

  <h2>{t('week.now')}</h2>
  <TileRow count={4}>
    {#each nowTiles as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('week.last7')} · {period}</h2>
  <TileRow count={5}>
    {#each weekTiles as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>
  <p class="muted-note">
    {t('week.todayApart', {
      until,
      pv: kwh(w.today.pv),
      load: kwh(w.today.load),
      imp: kwh(w.today.imp),
    })}
  </p>

  <h2>{t('week.sunVsForecast')}</h2>
  <Card title={t('ts.title')} icon="sun" color="var(--sun)">
    <SoftTimeSeries
      data={tsData}
      periods={[{ id: 'week', label: t('ts.week') }]}
      period="week"
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

  <h2>{t('week.batteryLoad')}</h2>
  <div class="cards">
    <Card title={t('week.socRange')} icon="battery" color="var(--battery)" note={periodNote}>
      <DayRanges
        ranges={[...w.soc, w.today.soc]}
        {labels}
        color="var(--battery)"
        unit="%"
        partial={today}
        label={t('week.socRange')}
      />
    </Card>
    <Card title={t('week.loadPerDay')} icon="home" color="var(--home)" note={periodNote}>
      <DayBars
        values={[...w.load, w.today.load]}
        {labels}
        color="var(--home)"
        unit="kWh"
        partial={today}
        label={t('week.loadPerDay')}
      />
    </Card>
  </div>

  <h2>{t('week.flows')} · {period}</h2>
  <div class="cards">
    <Card title={t('week.whereTo')} icon="sun" color="var(--sun)">
      <FlowBars flows={whereTo} />
    </Card>
    <Card title={t('week.whereFrom')} icon="home" color="var(--home)">
      <FlowBars flows={whereFrom} />
    </Card>
  </div>
  <p class="muted-note">{t('week.flowNote')}</p>
</div>
