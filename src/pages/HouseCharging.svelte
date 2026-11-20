<script lang="ts">
  /**
   * "Laden" from the house's own records (read-only): the charge now, the plan
   * of the house's charge planner (today, tomorrow, blocks) and past charges
   * per day with a table below. Nothing here switches anything. A board with
   * onPage "charging" (e.g. the car module) is shown here too, its sections
   * placed by slot: top above, plan after the plan, the rest at the end.
   */
  import { tc } from '../i18n/charge';
  import { onMount } from 'svelte';
  import { currentData } from '../app/data.svelte';
  import BoardSections, { chargingBoard } from './BoardSections.svelte';
  import Card from '../components/Card.svelte';
  import DataTable, { type Column, type Row } from '../components/DataTable.svelte';
  import DayBars from '../components/DayBars.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { i18n, num, t, time } from '../i18n/index.svelte';
  import { addDays, localDateKey, localMidnight } from '../model/time';
  import ChargeTrace from './ChargeTrace.svelte';
  import Icon from '../components/Icon.svelte';
  import PageHead from './PageHead.svelte';
  import { carNext } from '../model/outlook';
  import ChargeOrigin from '../components/ChargeOrigin.svelte';
  import { originShares, originStack, type OriginDay } from '../model/charge-origin';
  import ChargeOutlook from '../components/ChargeOutlook.svelte';
  import { houseOutlook } from '../app/house-outlook';

  interface Session {
    start: number;
    end: number | null;
    kwh: number | null;
    source: 'auto' | 'app' | 'card' | 'force' | null;
    gridKwh: number | null;
  }
  interface Plan {
    text: string | null;
    madeAt: number | null;
    days: { kwh: number | null; low: number | null; high: number | null }[];
    socNow: number | null;
    socMin: number | null;
    blocks: {
      start: number;
      end: number;
      amps: number | null;
      kwh: number | null;
      reason: string | null;
    }[];
  }
  interface Answer {
    now: {
      running: boolean;
      since: number | null;
      source: Session['source'];
      powerW: number | null;
      kwhSoFar: number | null;
    };
    sessions: Session[];
    plan: Plan | null;
    /** series id of the car's power (mapping.charging.power), for the course */
    powerSeries: string | null;
    /** end of the power scale (mapping.charging.maxKw); null = no scale */
    maxKw: number | null;
    /** what the plan's two day numbers mean (mapping.charging.plan.span) */
    span: 'quantiles' | 'cautious-good' | null;
    /** the car's energy per day by origin (mapping.charging.origin); absent = one colour */
    origin?: OriginDay[];
  }

  const house = $derived(currentData());
  const tz = $derived(house.timeZone);
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  let view = $state<{ s: 'loading' } | { s: 'error' } | { s: 'ready'; a: Answer }>({
    s: 'loading',
  });

  onMount(async () => {
    try {
      const r = await fetch('/api/charging?days=31', { signal: AbortSignal.timeout(20_000) });
      view = r.ok ? { s: 'ready', a: (await r.json()) as Answer } : { s: 'error' };
    } catch {
      view = { s: 'error' };
    }
  });

  // the embedded board (if any)
  const emb = chargingBoard();
  const cb = $derived(emb.tab);

  const who = (s: Session['source']) =>
    s === 'auto'
      ? t('hc.src.auto')
      : s === 'app'
        ? t('hc.src.app')
        : s === 'card'
          ? t('hc.src.rfid')
          : s === 'force'
            ? t('hc.src.force')
            : t('hc.src.unknown');

  const today = $derived(localMidnight(house.now, tz));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13, tz));
  const dayLabel = (d: number) =>
    d === today
      ? t('days.today')
      : new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric' }).format(
          d + 12 * 3_600_000,
        );

  // What the two day numbers mean comes from the mapping (P-30): a 10–90 %
  // range, or the cautious plan and what good weather allows.
  const spanOf = (d: Plan['days'][number] | undefined) =>
    d && d.low !== null && d.high !== null && d.high > d.low && view.s === 'ready'
      ? view.a.span === 'cautious-good'
        ? t('hc.span', { high: num(d.high) })
        : t('hc.range', { low: num(d.low), high: num(d.high) })
      : undefined;

  // what comes next: the end of the running plan block (or "outside the plan")
  const untilText = $derived.by(() => {
    if (view.s !== 'ready' || !view.a.now.running) return '';
    const c = carNext(Date.now(), true, view.a.plan?.blocks ?? []);
    return c?.kind === 'until'
      ? ` · ${t('hc.until', { time: time(c.at, tz) })}`
      : c?.kind === 'outside'
        ? ` · ${t('hc.outsidePlan')}`
        : '';
  });

  const tiles = $derived.by<TileProps[]>(() => {
    if (view.s !== 'ready') return [];
    const { now, sessions, plan, maxKw } = view.a;
    const doneToday = sessions
      .filter((s) => localDateKey(s.start, tz) === localDateKey(house.now, tz))
      .reduce((a, s) => a + (s.kwh ?? 0), 0);
    const kw = now.powerW !== null ? now.powerW / 1000 : null;
    return [
      {
        label: t('hc.now'),
        icon: 'bolt',
        color: 'var(--battery)',
        value: now.running && kw !== null ? num(kw, 1) : now.running ? '…' : '0',
        unit: 'kW',
        sub: now.running
          ? t('hc.since', { time: time(now.since!, tz), who: who(now.source) }) + untilText
          : t('hc.notCharging'),
        ...(maxKw
          ? {
              graphic: {
                kind: 'scale' as const,
                value: kw ?? 0,
                min: 0,
                max: maxKw,
                color: 'var(--battery)',
                ends: ['0', `${num(maxKw)} kW`] as [string, string],
              },
            }
          : {}),
      },
      {
        label: t('hc.today'),
        icon: 'battery',
        color: 'var(--battery)',
        approx: now.running && now.kwhSoFar !== null,
        value: num(doneToday + (now.running ? (now.kwhSoFar ?? 0) : 0), 1),
        unit: 'kWh',
        sub:
          now.running && now.kwhSoFar !== null
            ? t('hc.todayRunning', { kwh: num(now.kwhSoFar, 1) })
            : t('hc.todayDone'),
      },
      nextTile(plan),
      ...(shares
        ? [
            {
              label: tc('out.noGrid'),
              icon: 'target' as const,
              color: 'var(--battery)',
              value: num(shares.sun + shares.battery),
              unit: '%',
              sub: tc('out.noGridSub', { n: shares.n }),
              graphic: { kind: 'ring' as const, value: (shares.sun + shares.battery) / 100 },
              info: { what: tc('co.info.what'), source: tc('co.info.source') },
            },
          ]
        : []),
    ];
  });

  /** the next planned charge within the window (Audit05 I-5: replaces the tiles plan today/tomorrow) */
  const nextTile = (plan: Plan | null): TileProps => {
    const b = plan?.blocks.find((x) => x.start > house.now && x.start - house.now < 48 * 3_600_000);
    const d = b ? localMidnight(b.start, tz) : null;
    return {
      label: tc('out.next'),
      icon: 'clock',
      color: 'var(--battery)',
      value: b ? time(b.start, tz) : plan ? tc('out.none') : '–',
      sub: b
        ? `${d === today ? t('days.today') : dayLabel(d!)}${b.kwh !== null ? ` · ≈ ${num(b.kwh, 1)} kWh` : ''}`
        : plan
          ? tc('out.noneSub')
          : t('hc.noPlan'),
      info: { what: tc('out.info.what'), source: t('hc.span.source') },
    };
  };

  // the next 48 hours: sun fan, usual load, charge windows, battery strip (Audit05 I-5)
  const blocksKw = $derived(
    view.s === 'ready' && view.a.plan
      ? view.a.plan.blocks.map((b) => ({
          start: b.start,
          end: b.end,
          kw:
            b.kwh !== null
              ? b.kwh / ((b.end - b.start) / 3_600_000)
              : b.amps !== null
                ? (b.amps * 230 * 3) / 1000
                : null,
        }))
      : [],
  );
  const outlook = $derived(
    view.s === 'ready' && view.a.plan ? houseOutlook(house, blocksKw, view.a.maxKw ?? 11) : null,
  );
  /** the planner's own numbers for today and tomorrow, with what they mean */
  const dayNotes = $derived.by(() => {
    if (view.s !== 'ready' || !view.a.plan || !outlook) return [];
    const plan = view.a.plan;
    const first = localMidnight(outlook.hours[0]!, tz);
    return [0, 1, 2].map((k) => {
      const d = plan.days[k + Math.round((first - today) / 86_400_000)];
      if (!d || d.kwh === null) return null;
      const sp = spanOf(d);
      return `${tc('out.dayCar', { kwh: num(d.kwh) })}${sp ? ` · ${sp}` : ''}`;
    });
  });

  /** kWh of the finished charges started on each day (0 = none; the records cover the 31 days) */
  const chargedOn = (list: number[]) =>
    view.s === 'ready'
      ? list.map((d) => {
          const key = localDateKey(d, tz);
          const v =
            view.s === 'ready'
              ? view.a.sessions
                  .filter((s) => localDateKey(s.start, tz) === key)
                  .reduce((a, s) => a + (s.kwh ?? 0), 0)
              : 0;
          return v;
        })
      : [];
  // the old one-colour bars draw 0 as a dash
  const perDay = $derived(chargedOn(days).map((v) => (v > 0 ? v : null)));

  // with the origin of the car's energy: 30 days stacked sun / battery / grid (Audit05 I-2)
  const days30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29, tz));
  const originBars = $derived(
    view.s === 'ready' && view.a.origin
      ? originStack(days30, view.a.origin, chargedOn(days30))
      : null,
  );
  const shares = $derived(originBars ? originShares(originBars) : null);
  const shortDay = (d: number) =>
    d === today
      ? t('days.today')
      : new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric', month: 'numeric' }).format(
          d + 12 * 3_600_000,
        );

  const columns: Column[] = $derived([
    { key: 'start', label: t('hc.col.start') },
    // on the phone the starter is worth more than the duration (Audit04 EM-12)
    { key: 'dur', label: t('hc.col.duration'), align: 'right', phone: false },
    { key: 'kwh', label: 'kWh', align: 'right' },
    { key: 'grid', label: t('hc.col.grid'), align: 'right', phone: false }, // the bar's purple part on the phone
    { key: 'who', label: t('hc.col.who') },
  ]);
  // records may start later than the 31-day window – then say since when (Audit04 EM-18)
  const tableTitle = $derived.by(() => {
    const first = view.s === 'ready' ? view.a.sessions[0]?.start : undefined;
    return first !== undefined && first - (house.now - 31 * 86_400_000) > 2 * 86_400_000
      ? t('hc.tableSince', {
          date: new Intl.DateTimeFormat(locale, {
            timeZone: tz,
            day: 'numeric',
            month: 'numeric',
          }).format(first),
        })
      : t('hc.table');
  });
  const rows = $derived<Row[]>(
    view.s === 'ready'
      ? [...view.a.sessions].reverse().map((s) => ({
          id: String(s.start),
          cells: {
            start: new Intl.DateTimeFormat(locale, {
              timeZone: tz,
              weekday: 'short',
              day: 'numeric',
              month: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(s.start),
            dur: s.end ? `${num((s.end - s.start) / 60_000)} min` : '–',
            kwh: s.kwh === null ? '–' : num(s.kwh, 1),
            grid: s.gridKwh === null ? '–' : num(s.gridKwh, 1),
            who: who(s.source),
          },
          // the house's grid draw during the charge, at most the charge itself (Audit05 I-8)
          chart: {
            value: s.kwh,
            ...(s.kwh !== null && s.gridKwh !== null ? { part: Math.min(s.gridKwh, s.kwh) } : {}),
          },
        }))
      : [],
  );
</script>

<div class="page">
  <PageHead title={cb?.title ?? t('page.charging')} />

  {#if cb && emb.board}
    <BoardSections id={cb.id} sections={emb.board.sections} slot="top" onchanged={emb.load} />
  {/if}

  {#if view.s === 'loading'}
    <p class="muted-note">{t('state.loading')}</p>
  {:else if view.s === 'error'}
    <p class="muted-note">{t('hc.error')}</p>
  {:else}
    <h2>{cb ? t('charge.wallbox') : t('hc.nowTitle')}</h2>
    <TileRow count={tiles.length}>
      {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
    </TileRow>

    {#if view.a.powerSeries}
      <div class="row-gap"></div>
      <ChargeTrace
        powerSeries={view.a.powerSeries}
        since={view.a.now.running ? view.a.now.since : null}
        timeZone={tz}
      />
    {/if}

    {#if view.a.plan}
      <h2>{t('hc.planTitle')}</h2>
      <Card
        title={view.a.plan.text ?? t('hc.planTitle')}
        icon="calendar"
        color="var(--battery)"
        info={{ what: tc('out.info.what'), source: tc('out.info.source') }}
        note={t('hc.planNote', {
          made: view.a.plan.madeAt ? time(view.a.plan.madeAt, tz) : '–',
          soc: view.a.plan.socNow === null ? '–' : num(view.a.plan.socNow),
          min: view.a.plan.socMin === null ? '–' : num(view.a.plan.socMin),
        }) + (outlook ? ` · ${tc('out.noteLoad', { n: outlook.nLoad })}` : '')}
      >
        {#if outlook}
          <ChargeOutlook
            hours={outlook.hours}
            pv={outlook.pv}
            load={outlook.load}
            blocks={blocksKw}
            car={outlook.car}
            soc={outlook.soc}
            floorPct={outlook.floorPct}
            now={house.now}
            timeZone={tz}
            {locale}
            {dayNotes}
          />
        {/if}
      </Card>
    {/if}

    {#if cb && emb.board}
      <div class="row-gap"></div>
      <BoardSections id={cb.id} sections={emb.board.sections} slot="plan" onchanged={emb.load} />
    {/if}

    <h2>{t('hc.pastTitle')}</h2>
    {#if originBars}
      <ChargeOrigin bars={originBars} labels={days30.map(shortDay)} partial={29} />
    {:else}
      <Card title={t('hc.perDay')} icon="battery" color="var(--battery)">
        <DayBars
          values={perDay}
          labels={days.map(dayLabel)}
          color="var(--battery)"
          unit="kWh"
          partial={13}
          label={t('hc.perDay')}
        />
      </Card>
    {/if}
    <div class="row-gap"></div>
    <!-- the list of charges is the second level: folded below the graphic (Audit05 I-2) -->
    <details class="more">
      <summary
        ><span class="chev" aria-hidden="true"><Icon name="chevron" size={18} /></span>{tableTitle}
        · {rows.length}</summary
      >
      <Card
        title={tableTitle}
        icon="clock"
        color="var(--muted)"
        note={rows.length ? t('hc.gridNote') : undefined}
      >
        {#if rows.length}
          <DataTable
            {columns}
            {rows}
            caption={tableTitle}
            chart={{
              kind: 'bar',
              label: t('hc.chart'),
              unit: 'kWh',
              color: 'var(--battery)',
              partColor: 'var(--import)',
            }}
          />
        {:else}
          <p class="muted-note">{t('hc.noSessions')}</p>
        {/if}
      </Card>
    </details>
  {/if}

  {#if cb && emb.board}
    <div class="row-gap"></div>
    <BoardSections id={cb.id} sections={emb.board.sections} slot="rest" onchanged={emb.load} />
  {/if}
</div>

<style>
  .more > summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 18px;
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }
  .more > summary::-webkit-details-marker {
    display: none;
  }
  .chev {
    display: inline-flex;
    transform: rotate(90deg);
    transition: transform 0.2s;
  }
  .more[open] .chev {
    transform: rotate(-90deg);
  }
  .more[open] > summary {
    margin-bottom: 10px;
  }
</style>
