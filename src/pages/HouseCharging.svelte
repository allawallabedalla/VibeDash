<script lang="ts">
  /**
   * "Laden" from the house's own records (read-only): the charge now, the plan
   * of the house's charge planner (today, tomorrow, blocks) and past charges
   * per day with a table below. Nothing here switches anything.
   */
  import { onMount } from 'svelte';
  import { currentData } from '../app/data.svelte';
  import Card from '../components/Card.svelte';
  import DataTable, { type Column, type Row } from '../components/DataTable.svelte';
  import DayBars from '../components/DayBars.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { i18n, num, t, time } from '../i18n/index.svelte';
  import { addDays, localDateKey, localMidnight } from '../model/time';
  import PageHead from './PageHead.svelte';

  interface Session {
    start: number;
    end: number | null;
    kwh: number | null;
    source: 'auto' | 'app' | 'card' | null;
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
    /** end of the power scale (mapping.charging.maxKw); null = no scale */
    maxKw: number | null;
    /** what the plan's two day numbers mean (mapping.charging.plan.span) */
    span: 'quantiles' | 'cautious-good' | null;
  }

  const house = currentData();
  const tz = house.timeZone;
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

  const who = (s: Session['source']) =>
    s === 'auto'
      ? t('hc.src.auto')
      : s === 'app'
        ? t('hc.src.app')
        : s === 'card'
          ? t('hc.src.rfid')
          : t('hc.src.unknown');

  const today = localMidnight(house.now, tz);
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

  const tiles = $derived.by<TileProps[]>(() => {
    if (view.s !== 'ready') return [];
    const { now, sessions, plan, span, maxKw } = view.a;
    const doneToday = sessions
      .filter((s) => localDateKey(s.start, tz) === localDateKey(house.now, tz))
      .reduce((a, s) => a + (s.kwh ?? 0), 0);
    const kw = now.powerW !== null ? now.powerW / 1000 : null;
    const day = (i: number, label: string): TileProps => {
      const d = plan?.days[i];
      return {
        label,
        icon: 'forecast',
        color: 'var(--battery)',
        approx: d?.kwh !== null && d?.kwh !== undefined,
        value: d?.kwh !== null && d?.kwh !== undefined ? num(d.kwh) : '–',
        unit: d?.kwh !== null && d?.kwh !== undefined ? 'kWh' : undefined,
        sub: spanOf(d) ?? (plan ? t('hc.noCharge') : t('hc.noPlan')),
        info: {
          what: span === 'cautious-good' ? t('hc.span.what') : t('hc.range.what'),
          source: t('hc.span.source'),
        },
        ...(d && d.kwh !== null && d.high !== null
          ? {
              graphic: {
                kind: 'scale' as const,
                value: d.kwh,
                min: 0,
                max: Math.max(10, Math.ceil((d.high ?? d.kwh) / 10) * 10 + 10),
                band: { low: d.low ?? d.kwh, high: d.high },
              },
            }
          : {}),
      };
    };
    return [
      {
        label: t('hc.now'),
        icon: 'bolt',
        color: 'var(--battery)',
        value: now.running && kw !== null ? num(kw, 1) : now.running ? '…' : '0',
        unit: 'kW',
        sub: now.running
          ? t('hc.since', { time: time(now.since!, tz), who: who(now.source) })
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
      day(0, t('hc.planToday')),
      day(1, t('hc.planTomorrow')),
    ];
  });

  // plan blocks of today and tomorrow on a 0–24 h lane each
  const lanes = $derived.by(() => {
    if (view.s !== 'ready' || !view.a.plan) return [];
    const blocks = view.a.plan.blocks;
    return [0, 1].map((k) => {
      const d0 = addDays(today, k, tz);
      const d1 = addDays(d0, 1, tz);
      const len = d1 - d0;
      return {
        label: k === 0 ? t('days.today') : t('hc.tomorrow'),
        blocks: blocks
          .filter((b) => b.end > d0 && b.start < d1)
          .map((b) => ({
            left: (100 * (Math.max(b.start, d0) - d0)) / len,
            width: (100 * (Math.min(b.end, d1) - Math.max(b.start, d0))) / len,
            text: `${time(b.start, tz)}–${time(b.end, tz)} · ${b.amps ?? '–'} A · ${num(b.kwh ?? 0, 1)} kWh${b.reason ? ` · ${b.reason}` : ''}`,
          })),
        now: k === 0 ? (100 * (house.now - d0)) / len : null,
      };
    });
  });

  const perDay = $derived(
    view.s === 'ready'
      ? days.map((d) => {
          const key = localDateKey(d, tz);
          const v =
            view.s === 'ready'
              ? view.a.sessions
                  .filter((s) => localDateKey(s.start, tz) === key)
                  .reduce((a, s) => a + (s.kwh ?? 0), 0)
              : 0;
          return v > 0 ? v : null;
        })
      : [],
  );

  const columns: Column[] = $derived([
    { key: 'start', label: t('hc.col.start') },
    { key: 'dur', label: t('hc.col.duration'), align: 'right' },
    { key: 'kwh', label: 'kWh', align: 'right' },
    { key: 'grid', label: t('hc.col.grid'), align: 'right' },
    { key: 'who', label: t('hc.col.who'), phone: false },
  ]);
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
        }))
      : [],
  );
</script>

<div class="page">
  <PageHead title={t('page.charging')} />

  {#if view.s === 'loading'}
    <p class="muted-note">{t('state.loading')}</p>
  {:else if view.s === 'error'}
    <p class="muted-note">{t('hc.error')}</p>
  {:else}
    <h2>{t('hc.nowTitle')}</h2>
    <TileRow count={4}>
      {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
    </TileRow>

    {#if view.a.plan}
      <h2>{t('hc.planTitle')}</h2>
      <Card
        title={view.a.plan.text ?? t('hc.planTitle')}
        icon="calendar"
        color="var(--battery)"
        note={t('hc.planNote', {
          made: view.a.plan.madeAt ? time(view.a.plan.madeAt, tz) : '–',
          soc: view.a.plan.socNow === null ? '–' : num(view.a.plan.socNow),
          min: view.a.plan.socMin === null ? '–' : num(view.a.plan.socMin),
        })}
      >
        <div class="lanes">
          {#each lanes as l (l.label)}
            <div class="lane">
              <span class="lname">{l.label}</span>
              <div class="track">
                {#each [6, 12, 18] as h (h)}<span class="tick" style:left="{(h / 24) * 100}%"
                  ></span>{/each}
                {#each l.blocks as b (b.left)}
                  <span class="block" style:left="{b.left}%" style:width="{b.width}%" title={b.text}
                  ></span>
                {/each}
                {#if l.now !== null}<span class="now" style:left="{l.now}%"></span>{/if}
              </div>
            </div>
            <ul class="blist">
              {#each l.blocks as b (b.left)}<li>{b.text}</li>{/each}
              {#if !l.blocks.length}<li class="muted">{t('hc.noCharge')}</li>{/if}
            </ul>
          {/each}
          <div class="axis">
            <span></span><span>6</span><span>12</span><span>18</span><span></span>
          </div>
        </div>
      </Card>
    {/if}

    <h2>{t('hc.pastTitle')}</h2>
    <Card title={t('hc.perDay')} icon="battery" color="var(--battery)" note={t('hc.gridNote')}>
      <DayBars
        values={perDay}
        labels={days.map(dayLabel)}
        color="var(--battery)"
        unit="kWh"
        partial={13}
        label={t('hc.perDay')}
      />
    </Card>
    <div class="row-gap"></div>
    <Card title={t('hc.table')} icon="clock" color="var(--muted)">
      {#if rows.length}
        <DataTable {columns} {rows} caption={t('hc.table')} />
      {:else}
        <p class="muted-note">{t('hc.noSessions')}</p>
      {/if}
    </Card>
  {/if}
</div>

<style>
  .lanes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lane {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 10px;
  }
  .lname {
    font-size: 14px;
    font-weight: 600;
  }
  .track {
    position: relative;
    height: 22px;
    border-radius: 6px;
    background: var(--track);
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
  }
  .block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--battery) 45%, var(--surface));
    box-shadow: inset -3px 0 0 var(--battery);
  }
  .now {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
  }
  .blist {
    list-style: none;
    margin: 0 0 8px 74px;
    padding: 0;
    font-size: var(--small);
    color: var(--text-2);
  }
  .blist .muted {
    color: var(--muted);
  }
  .axis {
    display: grid;
    grid-template-columns: 74px repeat(4, 1fr);
    font-size: var(--small);
    color: var(--muted);
  }
  @media (max-width: 600px) {
    .lane {
      grid-template-columns: 52px 1fr;
    }
    .blist {
      margin-left: 62px;
    }
    .axis {
      grid-template-columns: 62px repeat(4, 1fr);
    }
  }
</style>
