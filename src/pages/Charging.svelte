<script lang="ts">
  /**
   * Charging (evcc): now first, then the charging history evcc stores itself.
   * Solar share is weighted by energy; sessions without a recorded share are
   * left out and counted. Never loads forever.
   */
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import DataTable, { type Column, type Row } from '../components/DataTable.svelte';
  import Segmented from '../components/Segmented.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import type { TileProps } from '../components/Tile.svelte';
  import { solarShare, type EvccNow, type EvccSession } from '../adapters/evcc';
  import { i18n, num, t } from '../i18n/index.svelte';

  type View =
    | { s: 'loading' }
    | { s: 'error'; reason: 'timeout' | 'upstream' | 'network' }
    | { s: 'ready'; now: EvccNow | null; sessions: EvccSession[] };
  let view = $state<View>({ s: 'loading' });
  let span = $state<'30' | '365'>('30');

  async function get(url: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        return { status: 0, body: {} as Record<string, unknown> };
      }
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } catch (e) {
      return { status: (e as Error).name === 'TimeoutError' ? 504 : 0, body: {} };
    }
  }

  async function load() {
    view = { s: 'loading' };
    const year = new Date().getFullYear();
    const [now, thisYear, lastYear] = await Promise.all([
      get('/api/evcc/now'),
      get(`/api/evcc/sessions?year=${year}`),
      get(`/api/evcc/sessions?year=${year - 1}`),
    ]);
    if (thisYear.status !== 200) {
      const code = thisYear.body.error;
      view = {
        s: 'error',
        reason: code === 'timeout' ? 'timeout' : thisYear.status ? 'upstream' : 'network',
      };
      return;
    }
    const sessions = [
      ...((thisYear.body.sessions as EvccSession[]) ?? []),
      ...(lastYear.status === 200 ? ((lastYear.body.sessions as EvccSession[]) ?? []) : []),
    ].sort((a, b) => b.start - a.start);
    view = {
      s: 'ready',
      now: now.status === 200 ? (now.body as unknown as EvccNow) : null,
      sessions,
    };
  }

  onMount(() => void load());

  const DAY = 86_400_000;
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  const tiles = $derived.by<TileProps[]>(() => {
    if (view.s !== 'ready') return [];
    const lp = view.now?.loadpoints[0];
    const nowMs = Date.now();
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = view.sessions.filter(
      (s) => new Date(s.start).toISOString().slice(0, 7) === month,
    );
    const last30 = view.sessions.filter((s) => s.start >= nowMs - 30 * DAY);
    const share = solarShare(last30);
    const monthKWh = thisMonth.reduce((a, s) => a + s.energyKWh, 0);
    const state = !lp
      ? t('state.noData')
      : lp.charging
        ? t('charge.charging')
        : lp.connected
          ? t('charge.connected')
          : t('charge.free');
    return [
      {
        label: lp?.title && !lp.title.startsWith('#') ? lp.title : t('charge.wallbox'),
        icon: 'plugCar',
        color: 'var(--battery)',
        value: lp?.chargePowerW == null ? '–' : num(lp.chargePowerW / 1000, 1),
        unit: lp?.chargePowerW == null ? undefined : 'kW',
        sub: state,
        info: { what: t('charge.info.now.what'), source: t('charge.info.now.source') },
      },
      {
        label: t('charge.session'),
        icon: 'battery',
        color: 'var(--battery)',
        value: lp?.sessionEnergyKWh == null ? '–' : num(lp.sessionEnergyKWh, 1),
        unit: lp?.sessionEnergyKWh == null ? undefined : 'kWh',
        sub:
          lp?.vehicleSoc != null
            ? t('charge.vehicleSoc', { soc: num(lp.vehicleSoc) })
            : t('sub.now'),
        info: { what: t('charge.info.session.what'), source: t('charge.info.now.source') },
      },
      {
        label: t('charge.month'),
        icon: 'clock',
        color: 'var(--home)',
        value: num(monthKWh, 1),
        unit: 'kWh',
        sub: t('charge.sessions', { n: thisMonth.length }),
        info: { what: t('charge.info.month.what'), source: t('charge.info.sessions.source') },
      },
      {
        label: t('charge.solar'),
        icon: 'sun',
        color: 'var(--sun)',
        value: share.pct === null ? '–' : num(share.pct),
        unit: share.pct === null ? undefined : '%',
        sub:
          share.pct === null
            ? t('state.noData')
            : t('charge.solarSub', { n: share.n }) +
              (share.withoutShare
                ? ` · ${t('charge.withoutShare', { n: share.withoutShare })}`
                : ''),
        graphic: share.pct === null ? undefined : { kind: 'ring', value: share.pct / 100 },
        info: { what: t('charge.info.solar.what'), source: t('charge.info.sessions.source') },
      },
    ];
  });

  const columns = $derived<Column[]>([
    { key: 'day', label: t('review.day') },
    { key: 'vehicle', label: t('charge.vehicle'), phone: false },
    { key: 'kwh', label: 'kWh', align: 'right' },
    { key: 'solar', label: t('charge.solarCol'), align: 'right' },
    { key: 'duration', label: t('charge.duration'), align: 'right', phone: false },
  ]);

  const rows = $derived.by<Row[]>(() => {
    if (view.s !== 'ready') return [];
    const from = Date.now() - Number(span) * DAY;
    const fmt = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return view.sessions
      .filter((s) => s.start >= from)
      .map((s, i) => ({
        id: `${s.start}-${i}`,
        cells: {
          day: fmt.format(s.start),
          vehicle: s.vehicle || '–',
          kwh: num(s.energyKWh, 1),
          solar: s.solarPct === null ? '–' : `${num(s.solarPct)} %`,
          duration:
            s.end === null ? t('charge.running') : `${num((s.end - s.start) / 3_600_000, 1)} h`,
        },
      }));
  });
</script>

<div class="page">
  <h1>{t('page.charging')}</h1>
  <p class="lead">{t('charge.lead')}</p>
  <div class="row-gap"></div>

  {#if view.s === 'loading'}
    <p class="muted-note" role="status">{t('state.loading')}</p>
  {:else if view.s === 'error'}
    <Card title={t('state.errorTitle')} icon="info" color="var(--fair)">
      <p class="muted-note">{t(`reason.${view.reason}`)}</p>
      <button type="button" class="retry" onclick={load}>{t('state.retry')}</button>
    </Card>
  {:else}
    <TileRow count={4}>
      {#each tiles as tile (tile.label)}<Tile {...tile} />{/each}
    </TileRow>

    <h2>{t('charge.history')}</h2>
    <Card
      title={t('charge.history')}
      icon="clock"
      color="var(--muted)"
      note={t('charge.tableNote')}
    >
      {#snippet actions()}
        <Segmented
          options={[
            { id: '30', label: t('ts.month') },
            { id: '365', label: t('charge.year') },
          ]}
          bind:value={span}
          label={t('ts.periods')}
        />
      {/snippet}
      {#if rows.length}
        <DataTable {columns} {rows} caption={t('charge.history')} />
      {:else}
        <p class="muted-note">{t('charge.none')}</p>
      {/if}
    </Card>
  {/if}
</div>

<style>
  .retry {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    cursor: pointer;
    align-self: flex-start;
  }
</style>
