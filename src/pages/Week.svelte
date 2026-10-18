<script lang="ts">
  /**
   * "Week": now, the last seven days, weather, solar against forecast, battery
   * and consumption per day, and where the energy went.
   */
  import { currentData, currentSource } from '../app/data.svelte';
  import { batteryNowTile, gridNowTile, loadNowTile, sunNowTile } from '../app/tiles';
  import { roomRanges, weekNumbers } from '../app/week';
  import Card from '../components/Card.svelte';
  import DayBars from '../components/DayBars.svelte';
  import DayRanges from '../components/DayRanges.svelte';
  import FlowBars from '../components/FlowBars.svelte';
  import RoomRanges from '../components/RoomRanges.svelte';
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
  const rooms = roomRanges(house, w.days);
  /** day tiles: one value per day, at the day's middle (for the enlarged time axis) */
  const mid = (d: { start: number; end: number }) => (d.start + d.end) / 2;
  const daySpan = w.days.length ? { from: mid(w.days[0]!), to: mid(w.days.at(-1)!) } : undefined;
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
  // "Woche davor 460 kWh", and how many days the sum covers when not all seven
  const subOf = (n: number | undefined, before: number | undefined) =>
    [
      n !== undefined && n < 7 ? t('week.days', { n }) : '',
      before === undefined ? '' : t('week.before', { v: kwh(before) }),
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
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
      value: kwh(w.total.pv?.value ?? null),
      unit: 'kWh',
      sub: subOf(w.total.pv?.n, w.before.pv?.value),
      graphic: { kind: 'spark', values: w.pv, min: 0, span: daySpan },
    },
    {
      label: t('week.own'),
      icon: 'target',
      color: 'var(--battery)',
      value: w.autarky === null ? '–' : num(w.autarky.share * 100),
      unit: w.autarky === null ? undefined : '%',
      sub:
        w.autarky === null
          ? undefined
          : [
              t('week.ownSub', { imp: kwh(w.autarky.imp), load: kwh(w.autarky.load) }),
              w.autarky.n < 7 ? t('week.days', { n: w.autarky.n }) : '',
            ]
              .filter(Boolean)
              .join(' · '),
      graphic: w.autarky === null ? undefined : { kind: 'ring', value: w.autarky.share },
    },
    {
      label: t('week.import'),
      icon: 'grid',
      color: 'var(--import)',
      value: kwh(w.total.imp?.value ?? null),
      unit: 'kWh',
      sub: subOf(w.total.imp?.n, w.before.imp?.value),
      graphic: { kind: 'spark', values: w.imp, min: 0, span: daySpan },
    },
    {
      label: t('week.night'),
      icon: 'moon',
      color: 'var(--climate)',
      value: nightMean === null ? '–' : num(nightMean),
      unit: nightMean === null ? undefined : 'W',
      sub: t('week.nightSub'),
      graphic: { kind: 'spark', values: w.night, min: 0, span: daySpan },
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
  const f = w.flows;
  const est = f?.source === 'power';
  const whereTo = $derived([
    {
      label: t('week.toHouse'),
      value: f?.direct ?? null,
      color: 'var(--sun-soft)',
      textColor: 'var(--sun-text)',
      approx: est,
    },
    {
      label: t('week.toBattery'),
      value: f?.charged ?? null,
      color: 'var(--battery)',
      textColor: 'var(--good-text)',
      approx: est,
    },
    {
      label: t('week.toGrid'),
      value: f?.feed ?? null,
      color: 'var(--feed)',
      textColor: 'var(--feed-text)',
    },
  ]);
  const whereFrom = $derived([
    {
      label: t('week.fromSun'),
      value: f?.direct ?? null,
      color: 'var(--sun-soft)',
      textColor: 'var(--sun-text)',
      approx: est,
    },
    {
      label: t('week.fromBattery'),
      value: f?.discharged ?? null,
      color: 'var(--battery)',
      textColor: 'var(--good-text)',
      approx: est,
    },
    {
      label: t('week.fromGrid'),
      value: f?.imp ?? null,
      color: 'var(--import)',
      textColor: 'var(--import-text)',
    },
  ]);
  const flowNote = $derived(
    [
      f?.source === 'power' ? t('week.flowNotePower') : t('week.flowNoteMeter'),
      f && f.n < 7 ? t('week.days', { n: f.n }) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

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

  <h2>{t('week.house')} · {period}</h2>
  <div class="cards">
    {#if rooms.length >= 2}
      <Card
        title={t('week.rooms')}
        icon="thermometer"
        color="var(--climate)"
        note={t('week.roomsNote')}
      >
        <RoomRanges {rooms} label={t('week.rooms')} />
      </Card>
    {/if}
    <div class="stack">
      <Card title={t('week.whereTo')} icon="sun" color="var(--sun)">
        <FlowBars flows={whereTo} />
      </Card>
      <Card title={t('week.whereFrom')} icon="home" color="var(--home)">
        <FlowBars flows={whereFrom} />
      </Card>
    </div>
  </div>
  <p class="muted-note">{flowNote}</p>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  @media (max-width: 600px) {
    .stack {
      gap: 10px;
    }
  }
</style>
