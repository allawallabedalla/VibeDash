<script lang="ts">
  /**
   * A board: a page whose content a house service supplies (mapping.boards),
   * already checked by the server (src/model/board.ts). Each section is drawn
   * with VibeDash's own blocks; all text is shown as text. Refreshed every
   * two minutes while the page is visible.
   */
  import { onMount } from 'svelte';
  import { currentData, store } from '../app/data.svelte';
  import type { Board, BoardColor, BoardTile } from '../model/board';
  import { i18n, t, time } from '../i18n/index.svelte';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import BoardPlan from '../components/BoardPlan.svelte';
  import Card from '../components/Card.svelte';
  import DataTable, { type Column, type Row } from '../components/DataTable.svelte';
  import DayBars from '../components/DayBars.svelte';
  import ItemActions from '../components/ItemActions.svelte';
  import { iconOf } from '../components/Icon.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import PageHead from './PageHead.svelte';

  let { id }: { id: string } = $props();

  const house = currentData();
  const tab = $derived(store.boards.find((b) => b.id === id));
  let view = $state<{ s: 'loading' } | { s: 'error'; reason: string } | { s: 'ready'; b: Board }>({
    s: 'loading',
  });

  async function load() {
    try {
      const r = await fetch(`/api/board/${id}`, { signal: AbortSignal.timeout(25_000) });
      const body = (await r.json().catch(() => ({}))) as Board & { error?: string };
      view = r.ok ? { s: 'ready', b: body } : { s: 'error', reason: body.error ?? 'upstream' };
    } catch (e) {
      if (view.s !== 'ready') {
        view = { s: 'error', reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
      }
    }
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 120_000);
    return () => clearInterval(timer);
  });

  const C: Record<BoardColor, string> = {
    sun: 'var(--sun)',
    battery: 'var(--battery)',
    home: 'var(--home)',
    grid: 'var(--feed)',
    import: 'var(--import)',
    feed: 'var(--feed)',
    climate: 'var(--climate)',
    muted: 'var(--muted)',
  };
  const tileOf = (x: BoardTile): TileProps => ({
    label: x.label,
    icon: iconOf(x.icon ?? 'info'),
    color: C[x.color ?? 'muted'],
    value: x.value,
    ...(x.unit ? { unit: x.unit } : {}),
    ...(x.sub ? { sub: x.sub } : {}),
    ...(x.approx ? { approx: true } : {}),
    ...(x.state === 'look' || x.state === 'act' ? { status: x.state } : {}),
    ...(x.state === 'open' ? { pending: t('board.open') } : {}),
    ...(x.info ? { info: x.info } : {}),
    ...(x.spark && x.spark.some((v) => v !== null)
      ? { graphic: { kind: 'spark' as const, values: x.spark, color: C[x.color ?? 'muted'] } }
      : {}),
  });
  const columnsOf = (cols: { key: string; label: string; align?: 'right' }[]): Column[] =>
    cols.map((c, i) => ({ ...c, ...(i >= 3 ? { phone: false } : {}) }));
  const rowsOf = (rows: { cells: Record<string, string> }[]): Row[] =>
    rows.map((r, i) => ({ id: String(i), cells: r.cells }));
  const stateWord = (s?: string) =>
    s === 'act' ? t('board.act') : s === 'look' ? t('board.look') : s === 'ok' ? t('board.ok') : '';
</script>

<div class="page">
  <PageHead title={tab?.title ?? id} />

  {#if view.s === 'loading'}
    <p class="muted-note" role="status">{t('state.loading')}</p>
  {:else if view.s === 'error'}
    <p class="muted-note">
      {t('state.noData')} · {t(`reason.${view.reason === 'timeout' ? 'timeout' : 'upstream'}`)}
    </p>
  {:else}
    {#if view.b.updated}
      <p class="muted-note">{t('board.updated', { time: time(view.b.updated, house.timeZone) })}</p>
    {/if}
    {#each view.b.sections as s, i (i)}
      <!-- tiles get the title as heading; cards carry it themselves -->
      {#if s.title && s.type === 'tiles'}<h2>{s.title}</h2>{/if}
      {#if s.type === 'plan'}
        <Card
          title={s.title || tab?.title || ''}
          icon="home"
          color="var(--home)"
          note={s.note}
          info={s.info}
        >
          <BoardPlan plan={s} timeZone={house.timeZone} />
        </Card>
      {:else if s.type === 'tiles'}
        <TileRow count={Math.min(4, s.tiles.length)}>
          {#each s.tiles as x, k (k)}<Tile {...tileOf(x)} />{/each}
        </TileRow>
        {#if s.note}<p class="muted-note">{s.note}</p>{/if}
      {:else}
        <Card
          title={s.type === 'accuracy' ? t('board.models') : ((s.title || tab?.title) ?? '')}
          icon={s.type === 'list' ? 'info' : s.type === 'table' ? 'calendar' : 'forecast'}
          color="var(--muted)"
          note={s.note}
          info={s.info}
        >
          {#if s.type === 'series'}
            <LineChart
              x={s.x}
              lines={s.lines.map((l) => ({ ...l, color: C[l.color] }))}
              unit={s.unit}
              timeZone={house.timeZone}
              label={s.title}
            />
          {:else if s.type === 'bars'}
            <DayBars
              values={s.values}
              labels={s.labels}
              color={C[s.color]}
              unit={s.unit}
              label={s.title}
            />
          {:else if s.type === 'table'}
            {#if s.rows.length}
              <DataTable columns={columnsOf(s.columns)} rows={rowsOf(s.rows)} caption={s.title} />
            {:else}
              <p class="muted-note">{t('board.empty')}</p>
            {/if}
          {:else if s.type === 'list'}
            {#if s.items.length}
              <ul class="items">
                {#each s.items as it, k (k)}
                  <li class="st-{it.state ?? 'none'}">
                    {#if it.state && it.state !== 'open'}<span class="word"
                        >{stateWord(it.state)}</span
                      >{/if}
                    <span>{it.text}</span>
                    {#if it.meta}<span class="meta">{it.meta}</span>{/if}
                    {#if tab?.actions && it.id && it.actions?.length}
                      <ItemActions board={id} item={it} onchanged={() => void load()} />
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted-note">{t('board.empty')}</p>
            {/if}
          {:else if s.type === 'accuracy'}
            <div class="models">
              {#each s.models as m, k (k)}
                <div class="model">
                  <AccuracyCard
                    label={m.label}
                    pct={m.pct}
                    n={m.n}
                    history={m.history}
                    note={m.note}
                    collecting={m.collecting
                      ? { have: m.collecting.have, need: m.collecting.need, from: '–' }
                      : undefined}
                  />
                  {#if m.details?.length}
                    <dl class="details">
                      {#each m.details as d (d.label)}<dt>{d.label}</dt>
                        <dd>{d.value}</dd>{/each}
                    </dl>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if s.type === 'text'}
            <p class="text">{s.text}</p>
          {/if}
        </Card>
      {/if}
      <div class="row-gap"></div>
    {/each}
    <p class="muted-note">{t('board.source', { lang: i18n.locale })}</p>
  {/if}
</div>

<style>
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .items li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    line-height: 1.35;
  }
  .items li:last-child {
    border-bottom: 0;
  }
  .word {
    font-weight: 700;
    font-size: var(--small);
  }
  .st-act .word {
    color: var(--poor-text);
  }
  .st-look .word {
    color: var(--fair-text);
  }
  .st-ok .word {
    color: var(--good-text);
  }
  .meta {
    color: var(--muted);
    font-size: var(--small);
    margin-left: auto;
  }
  .models {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .details {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 8px 4px 0;
    font-size: var(--small);
  }
  .details dt {
    color: var(--muted);
  }
  .details dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .text {
    margin: 0;
    white-space: pre-line;
    line-height: 1.5;
  }
</style>
