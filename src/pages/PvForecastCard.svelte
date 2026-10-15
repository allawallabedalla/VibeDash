<script lang="ts">
  /**
   * Hourly PV forecast (M11) from the forecasting service, via the VibeDash
   * server: today/tomorrow per hour with p10–p90 band, day total with range
   * and n, and the honest accuracy of the model. Clear end states.
   */
  import { onMount } from 'svelte';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import Card from '../components/Card.svelte';
  import SoftTimeSeries from '../components/SoftTimeSeries.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import type { TileProps } from '../components/Tile.svelte';
  import { i18n, num, t } from '../i18n/index.svelte';

  let { timeZone }: { timeZone: string } = $props();

  interface Day {
    tag: string;
    stunden: string[];
    p10: number[];
    p50: number[];
    p90: number[];
    summe: [number, number, number];
    n_analog: number;
    hinweis: string | null;
  }
  interface Guete {
    zustand: string;
    n: number;
    korrekt_pct?: number;
    verlauf?: (number | null)[];
    im_band_pct?: number;
    schlaegt_faustregel_pct?: number;
  }
  type View =
    | { s: 'loading' }
    | { s: 'error'; reason: 'timeout' | 'upstream' | 'network' }
    | { s: 'collecting'; have: number; need: number }
    | { s: 'ready'; days: Day[]; guete: Guete | null };
  let view = $state<View>({ s: 'loading' });
  let pick = $state(0);

  async function get(url: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!(res.headers.get('content-type') ?? '').includes('application/json'))
        return { status: 0, body: {} as Record<string, unknown> };
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } catch (e) {
      return { status: (e as Error).name === 'TimeoutError' ? 504 : 0, body: {} };
    }
  }

  onMount(async () => {
    const st = await get('/api/pv/status');
    if (st.status !== 200) {
      view = {
        s: 'error',
        reason: st.status === 504 ? 'timeout' : st.status ? 'upstream' : 'network',
      };
      return;
    }
    if (st.body.zustand === 'sammelt') {
      view = {
        s: 'collecting',
        have: Number(st.body.tage ?? 0),
        need: Number(st.body.benoetigt ?? 16),
      };
      return;
    }
    const [p, g] = await Promise.all([get('/api/pv/prognose'), get('/api/pv/guete')]);
    view = {
      s: 'ready',
      days: p.status === 200 ? ((p.body.prognosen as Day[]) ?? []) : [],
      guete: g.status === 200 ? (g.body as unknown as Guete) : null,
    };
  });

  const dayLabel = (iso: string, i: number) =>
    i === 0 && iso === new Intl.DateTimeFormat('en-CA', { timeZone }).format(Date.now())
      ? t('days.today')
      : new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
          weekday: 'long',
          timeZone: 'UTC',
        }).format(new Date(`${iso}T12:00:00Z`));

  const tiles = $derived<TileProps[]>(
    view.s === 'ready'
      ? view.days.map((d, i) => ({
          label: `${t('tile.sun')} ${i === 0 && dayLabel(d.tag, i) === t('days.today') ? t('pv.today') : dayLabel(d.tag, i)}`,
          icon: 'sun' as const,
          color: 'var(--sun)',
          approx: true,
          value: num(d.summe[1]),
          unit: 'kWh',
          sub: t('sub.range', { low: num(d.summe[0]), high: num(d.summe[2]), n: d.n_analog }),
          ...(d.hinweis ? { pending: d.hinweis } : {}),
          graphic: {
            kind: 'scale' as const,
            value: d.summe[1],
            min: 0,
            max: Math.ceil(d.summe[2] / 10) * 10 + 10,
            band: { low: d.summe[0], high: d.summe[2] },
          },
          info: { what: t('pv.info.what'), source: t('pv.info.source') },
        }))
      : [],
  );

  const chart = $derived.by(() => {
    if (view.s !== 'ready' || !view.days[pick]) return null;
    const d = view.days[pick]!;
    return {
      x: d.stunden.map((h) => Date.parse(h)),
      actual: d.stunden.map(() => null),
      forecast: d.p50,
      low: d.p10,
      high: d.p90,
    };
  });
</script>

<h2>{t('pv.title')}</h2>
{#if view.s === 'loading'}
  <p class="muted-note" role="status">{t('state.loading')}</p>
{:else if view.s === 'error'}
  <p class="muted-note">{t('state.noData')} · {t(`reason.${view.reason}`)}</p>
{:else if view.s === 'collecting'}
  <div class="cards">
    <AccuracyCard
      label={t('pv.model')}
      pct={null}
      n={0}
      history={[]}
      collecting={{ have: view.have, need: view.need, from: '–' }}
    />
  </div>
{:else}
  {#if tiles.length}
    <TileRow count={Math.max(2, tiles.length)}>
      {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
    </TileRow>
    <div class="row-gap"></div>
  {/if}
  <div class="cards wide-left">
    <Card title={t('pv.hourly')} icon="sun" color="var(--sun)" note={t('pv.note')}>
      {#if chart}
        <SoftTimeSeries
          data={chart}
          periods={view.days.map((d, i) => ({ id: String(i), label: dayLabel(d.tag, i) }))}
          bind:period={() => String(pick), (v) => (pick = Number(v))}
          labels={{
            actual: t('ts.actual'),
            forecast: t('ts.fc.latest'),
            band: t('ts.band'),
            periods: t('ts.periods'),
            empty: t('state.noData'),
          }}
          unit={t('pv.unit')}
          {timeZone}
          locale={i18n.locale === 'de' ? 'de-DE' : 'en-GB'}
        />
      {:else}
        <p class="muted-note">{t('state.noData')}</p>
      {/if}
    </Card>
    <AccuracyCard
      label={t('pv.model')}
      pct={view.guete?.zustand === 'bewertbar' ? (view.guete.korrekt_pct ?? null) : null}
      n={view.guete?.n ?? 0}
      history={view.guete?.verlauf ?? []}
      note={view.guete?.zustand === 'bewertbar'
        ? `${t('acc.backtest')} · ${t('pv.inBand', { pct: num(view.guete.im_band_pct ?? 0) })}${view.guete.schlaegt_faustregel_pct ? ` · ${t('acc.beats', { pct: num(view.guete.schlaegt_faustregel_pct) })}` : ''}`
        : undefined}
    />
  </div>
{/if}
