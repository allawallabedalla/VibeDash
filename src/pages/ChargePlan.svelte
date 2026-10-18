<script lang="ts">
  /**
   * Charge plan, stage A (LADESTEUERUNG.md §5): how much the car can take without grid
   * power – now, tonight and tomorrow. Tiles first, then the hour chart, then
   * "what if …?". Plans and shows only; nothing is switched.
   */
  import Card from '../components/Card.svelte';
  import PlanChart from '../components/PlanChart.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import type { TileProps } from '../components/Tile.svelte';
  import type { PlanView } from '../app/plan';
  import { ampsToKw, kwToAmps, whatIf, ALPHA } from '../model/plan';
  import { i18n, num, t } from '../i18n/index.svelte';

  let { plan, timeZone }: { plan: PlanView; timeZone: string } = $props();

  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  const hourFmt = $derived(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }),
  );
  /** Local hour as a number (0–23). */
  const hourOf = (ms: number) => Number(hourFmt.format(ms));
  const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(ms);

  /** Charging blocks as "11–16" (plus "tomorrow" when on the next day). */
  const windows = $derived.by(() => {
    const blocks: { from: number; to: number }[] = [];
    plan.carKw.forEach((kw, i) => {
      if (kw <= 0) return;
      const last = blocks[blocks.length - 1];
      if (last && last.to === i) last.to = i + 1;
      else blocks.push({ from: i, to: i + 1 });
    });
    const today = dayKey(plan.hours[0]!);
    return blocks.map((b) => {
      const start = plan.hours[b.from]!;
      const end = plan.hours[b.to - 1]! + 3_600_000;
      const text = `${hourOf(start)}–${hourOf(end) || 24}`;
      return dayKey(start) === today ? text : `${t('plan.tomorrow')} ${text}`;
    });
  });

  const maxAmps = $derived(Math.round(kwToAmps(Math.max(0, ...plan.carKw), plan.car.phases)));

  /** Battery tomorrow 06:00 local (median, 10–90 %). */
  const morning = $derived.by(() => {
    const today = dayKey(plan.hours[0]!);
    const i = plan.hours.findIndex((h) => dayKey(h) !== today && hourOf(h) === 6);
    if (i < 0) return null;
    const pct = (v: number) => (v / plan.battery.capacityKwh) * 100;
    return { p50: pct(plan.soc.p50[i]!), p10: pct(plan.soc.p10[i]!), p90: pct(plan.soc.p90[i]!) };
  });

  const n = $derived(plan.scenarios.pv.length);

  const tiles = $derived<TileProps[]>([
    {
      label: t('plan.car'),
      icon: 'plugCar',
      color: 'var(--battery)',
      value: num(plan.kwh, plan.kwh < 10 ? 1 : 0),
      unit: 'kWh',
      approx: true,
      sub: t('plan.rangeN', { lo: num(plan.range[0]), hi: num(plan.range[1]), n }),
      graphic: {
        kind: 'spark',
        values: plan.carKw,
        color: 'var(--battery)',
        min: 0,
        // hourly slots, each at its middle
        ...(plan.hours.length > 1
          ? { span: { from: plan.hours[0]! + 1_800_000, to: plan.hours.at(-1)! + 1_800_000 } }
          : {}),
      },
      info: { what: t('plan.info.car.what'), source: t('plan.info.car.source') },
    },
    {
      label: t('plan.window'),
      icon: 'clock',
      color: 'var(--battery)',
      value: windows.length ? windows[0]! : '–',
      unit: windows.length ? t('plan.oClock') : undefined,
      sub:
        windows.length > 1
          ? `${windows.slice(1).join(' · ')} · ${maxAmps} A`
          : windows.length
            ? `${maxAmps} A · ${t(`plan.reason.${plan.reason}`)}`
            : t(`plan.reason.${plan.reason}`),
      info: { what: t('plan.info.window.what'), source: t('plan.info.window.source') },
    },
    {
      label: t('plan.morning'),
      icon: 'battery',
      color: 'var(--battery)',
      value: morning ? num(morning.p50) : '–',
      unit: morning ? '%' : undefined,
      approx: Boolean(morning),
      sub: morning
        ? t('plan.rangeN', { lo: num(morning.p10), hi: num(morning.p90), n })
        : t('state.noData'),
      graphic: morning ? { kind: 'ring', value: morning.p50 / 100 } : undefined,
      info: { what: t('plan.info.morning.what'), source: t('plan.info.car.source') },
    },
  ]);

  // "What if I charge now with … A for … h?"
  const ampsOptions = $derived(
    [
      ...new Set([plan.car.minA, Math.round((plan.car.minA + plan.car.maxA) / 2), plan.car.maxA]),
    ].map((a) => ({ id: String(a), label: `${a} A` })),
  );
  let amps = $state(String(16));
  let hoursPick = $state('2');
  const answer = $derived.by(() => {
    const a = Number(amps);
    const kw = ampsToKw(a, plan.car.phases);
    const h = Number(hoursPick);
    const car = plan.carKw.map((_, i) => (i < h ? kw : 0));
    const w = whatIf(plan.scenarios, plan.battery, plan.soc0Kwh, car);
    return { ...w, kwh: kw * Math.min(h, plan.carKw.length) };
  });
  const noGrid = $derived(answer.sharePct <= ALPHA * 100);
</script>

<TileRow count={3}>
  {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
</TileRow>

<Card
  title={t('plan.chart')}
  icon="forecast"
  color="var(--sun)"
  note={t('plan.chartNote', { pv: plan.nPv, load: plan.nLoad, n }) +
    (plan.untested ? ` · ${t('plan.untested')}` : '')}
  info={{ what: t('plan.info.chart.what'), source: t('plan.info.car.source') }}
>
  <PlanChart
    hours={plan.hours}
    pv={plan.pv}
    load={plan.load}
    carKw={plan.carKw}
    soc={plan.soc}
    capacityKwh={plan.battery.capacityKwh}
    {timeZone}
    {locale}
    labels={{
      pv: t('plan.legend.pv'),
      band: t('plan.legend.band'),
      load: t('plan.legend.load'),
      car: t('plan.legend.car'),
      battery: t('plan.legend.battery'),
      now: t('plan.now'),
    }}
  />
</Card>

<Card
  title={t('plan.whatIf')}
  icon="plugCar"
  color="var(--battery)"
  info={{ what: t('plan.info.whatIf.what'), source: t('plan.info.whatIf.source') }}
>
  <div class="pick">
    <Segmented options={ampsOptions} bind:value={amps} label={t('plan.amps')} />
    <Segmented
      options={['1', '2', '4', '6'].map((h) => ({ id: h, label: `${h} h` }))}
      bind:value={hoursPick}
      label={t('plan.hours')}
    />
  </div>
  <p class="question">
    {t('plan.whatIfQ', { a: amps, h: hoursPick, kwh: num(answer.kwh, 0) })}
  </p>
  <div class="answer" class:ok={noGrid} role="status" aria-live="polite">
    {#if noGrid}
      <strong>{t('plan.noGrid')}</strong>
      <span>{t('plan.noGridSub', { pct: num(100 - answer.sharePct), n: answer.n })}</span>
    {:else}
      <strong
        >{t('plan.grid', {
          kwh: num(answer.gridKwh[1], 1),
          lo: num(answer.gridKwh[0], 1),
          hi: num(answer.gridKwh[2], 1),
        })}</strong
      >
      <span>
        {answer.firstHour !== null
          ? t('plan.gridFrom', { at: hourOf(plan.hours[answer.firstHour]!) }) + ' · '
          : ''}{t('plan.gridShare', { pct: num(answer.sharePct), n: answer.n })}
      </span>
    {/if}
  </div>
</Card>

<style>
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .question {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .answer {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--surface-2);
    box-shadow: inset 4px 0 0 var(--fair);
  }
  .answer.ok {
    box-shadow: inset 4px 0 0 var(--good);
  }
  .answer strong {
    font-size: 18px;
    font-weight: 600;
  }
  .answer span {
    color: var(--muted);
  }
</style>
