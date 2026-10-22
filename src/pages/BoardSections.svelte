<script module lang="ts">
  /**
   * The board shown on the charging page (mapping boards[].onPage = "charging"),
   * e.g. the car module: loaded when the page opens and every two minutes while
   * it is visible. Both charging pages use it (kept here: one file less to load).
   */
  import { onMount } from 'svelte';
  import { store as boardStore } from '../app/data.svelte';
  import type { Board } from '../model/board';
  import { boardCache } from '../app/loading';

  export function chargingBoard() {
    const tab = $derived(boardStore.boards.find((b) => b.onPage === 'charging'));
    // the last answer on this device at once, the fresh one when it is in
    const cached = () => (tab ? boardCache<Board>(tab.id) : null);
    let board = $state<Board | null>(cached()?.read()?.b ?? null);
    async function load() {
      if (!tab) return;
      try {
        const r = await fetch(`/api/board/${tab.id}`, { signal: AbortSignal.timeout(25_000) });
        if (r.ok) {
          board = (await r.json()) as Board;
          cached()?.write(board);
        }
      } catch {
        /* keep what is shown */
      }
    }
    onMount(() => {
      void load();
      const timer = setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 120_000);
      return () => clearInterval(timer);
    });
    return {
      get tab() {
        return tab;
      },
      get board() {
        return board;
      },
      load,
    };
  }
</script>

<script lang="ts">
  /**
   * The sections of a board, drawn with VibeDash's own blocks (all text as
   * text): used by the board page and by pages that embed a board (the
   * charging page shows a car board, placed by each section's "slot").
   */
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { currentData, store } from '../app/data.svelte';
  import type { BoardColor, BoardSection, BoardTile } from '../model/board';
  import { t } from '../i18n/index.svelte';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import BoardPlan from '../components/BoardPlan.svelte';
  import Card from '../components/Card.svelte';
  import DataTable, { type Column, type Row } from '../components/DataTable.svelte';
  import DayBars from '../components/DayBars.svelte';
  import Segmented from '../components/Segmented.svelte';
  import ItemActions from '../components/ItemActions.svelte';
  import Icon, { iconOf } from '../components/Icon.svelte';
  import InfoButton from '../components/InfoButton.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Tile, { type TileProps } from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';

  let {
    id,
    sections,
    slot,
    onchanged,
  }: {
    id: string;
    sections: BoardSection[];
    /** only sections with this slot; "rest" = those without one; none = all */
    slot?: 'top' | 'plan' | 'rest';
    onchanged?: () => void;
  } = $props();

  const house = $derived(currentData());
  const tab = $derived(store.boards.find((b) => b.id === id));
  const inSlot = (s: BoardSection) => !slot || (slot === 'rest' ? !s.slot : s.slot === slot);

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
      ? {
          graphic: {
            kind: 'spark' as const,
            values: x.spark,
            color: C[x.color ?? 'muted'],
            ...(x.sparkFrom !== undefined && x.sparkTo !== undefined
              ? { span: { from: x.sparkFrom, to: x.sparkTo } }
              : {}),
          },
        }
      : {}),
  });
  /** Bars show bare numbers, so the unit goes into the title unless it is already there (Audit04 EM-10). */
  const unitTitle = (s: BoardSection, title: string) =>
    s.type === 'bars' && s.unit && !title.includes(s.unit) ? `${title}, ${s.unit}` : title;
  // on the phone the first three columns, plus those the board marks "phone": true
  const columnsOf = (
    cols: { key: string; label: string; align?: 'right'; phone?: boolean }[],
  ): Column[] => cols.map((c, i) => ({ ...c, phone: c.phone ?? i < 3 }));
  const rowsOf = (rows: { cells: Record<string, string>; note?: string }[]): Row[] =>
    rows.map((r, i) => ({ id: String(i), cells: r.cells, ...(r.note ? { note: r.note } : {}) }));
  /**
   * Time-span switches: sections with the same "group" share one choice; the
   * switch sits above the first of them that brings ranges.
   */
  const span = new SvelteMap<string, string>();
  type Ranged = Extract<BoardSection, { type: 'series' | 'bars' }>;
  const isRanged = (s: BoardSection): s is Ranged =>
    (s.type === 'series' || s.type === 'bars') && !!s.group && !!s.ranges?.length;
  /** index of the section that carries a group's switch -> that section */
  const switchAt = $derived.by(() => {
    const at: Record<number, Ranged> = {};
    const seen: string[] = [];
    shown.forEach(({ s }, i) => {
      if (isRanged(s) && !seen.includes(s.group!)) {
        seen.push(s.group!);
        at[i] = s;
      }
    });
    return at;
  });
  /** the chosen range of a section (by id), else its first range, else the section itself */
  function pick<S extends Ranged>(s: S): S {
    if (!isRanged(s)) return s;
    const want = span.get(s.group!);
    const r = s.ranges!.find((x) => x.id === want) ?? s.ranges![0]!;
    return { ...s, ...r, title: s.title } as S;
  }

  /**
   * Calculators: the answer to the last calculation (per calculator, by its position)
   * is shown right below it as ordinary sections; kept across the two-minute reloads.
   */
  const results = new SvelteMap<number, { sections: BoardSection[]; label: string }>();
  type Shown = { s: BoardSection; calc?: number };
  const shown = $derived.by((): Shown[] => {
    const out: Shown[] = [];
    sections.forEach((s, i) => {
      if (!inSlot(s)) return;
      // calculators reach the page only where the server has a way for their value
      if (s.type === 'calc') {
        out.push({ s, calc: i });
        const r = results.get(i);
        if (r) for (const x of r.sections) out.push({ s: x });
      } else out.push({ s });
    });
    return out;
  });

  /** open accordion items (section index | item id), kept across reloads */
  const opened = new SvelteSet<string>();
  function toggle(key: string) {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
  }
  const stateWord = (s?: string) =>
    s === 'act' ? t('board.act') : s === 'look' ? t('board.look') : s === 'ok' ? t('board.ok') : '';
</script>

{#each shown as { s, calc }, i (i)}
  {#if switchAt[i]}
    {@const g = switchAt[i]}
    <div class="span">
      <Segmented
        options={g.ranges!.map((r) => ({ id: r.id, label: r.label }))}
        bind:value={() => span.get(g.group!) ?? g.ranges![0]!.id, (v) => span.set(g.group!, v)}
        label={t('zoom.window')}
      />
    </div>
  {/if}
  <!-- tiles get the title as heading; cards carry it themselves -->
  {#if s.title && s.type === 'tiles'}<h2>{s.title}</h2>{/if}
  {#if s.type === 'calc'}
    <Card
      title={s.title || s.label}
      icon="clock"
      color="var(--battery)"
      note={s.note}
      info={s.info}
    >
      <!-- loaded only where a board has a calculator (first-page budget) -->
      {#await import('../components/BoardCalc.svelte')}
        <p class="muted-note" role="status">{t('state.loading')}</p>
      {:then { default: BoardCalc }}
        <BoardCalc
          board={id}
          calc={s}
          timeZone={house.timeZone}
          hideLabel={s.label === s.title}
          onresult={(r) => (r ? results.set(calc!, r) : results.delete(calc!))}
        />
      {/await}
    </Card>
  {:else if s.type === 'chargetimeline'}
    <Card title={s.title} icon="plugCar" color="var(--battery)" note={s.note} info={s.info}>
      <!-- loaded only where a board has a timeline (first-page budget) -->
      {#await import('../components/BoardChargeTimeline.svelte')}
        <p class="muted-note" role="status">{t('state.loading')}</p>
      {:then { default: BoardChargeTimeline }}
        <BoardChargeTimeline tl={s} />
      {/await}
    </Card>
  {:else if s.type === 'choice'}
    <Card title={s.title} icon="lookCircle" color="var(--battery)" note={s.note} info={s.info}>
      <!-- loaded only where a board has a choice (first-page budget) -->
      {#await import('../components/BoardChoice.svelte')}
        <p class="muted-note" role="status">{t('state.loading')}</p>
      {:then { default: BoardChoice }}
        <BoardChoice board={id} choice={s} onchanged={() => onchanged?.()} />
      {/await}
    </Card>
  {:else if s.type === 'plan'}
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
      title={s.type === 'accuracy'
        ? t('board.models')
        : unitTitle(s, (s.title || tab?.title) ?? '')}
      icon={s.type === 'list' ? 'info' : s.type === 'table' ? 'calendar' : 'forecast'}
      color="var(--muted)"
      note={s.note}
      info={s.info}
    >
      {#if s.type === 'series'}
        {@const v = pick(s)}
        <LineChart
          x={v.x}
          lines={v.lines.map((l) => ({ ...l, color: C[l.color] }))}
          unit={s.unit}
          timeZone={house.timeZone}
          label={s.title}
        />
      {:else if s.type === 'bars'}
        {@const v = pick(s)}
        <DayBars
          values={v.values}
          labels={v.labels}
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
              {#if tab?.actions && it.id && it.actions?.length}
                <!-- accordion: tap the line, the note field and buttons open below -->
                {@const key = `${i}|${it.id}`}
                <li class="st-{it.state ?? 'none'} acc" class:open={opened.has(key)}>
                  <button
                    type="button"
                    class="acc-head"
                    aria-expanded={opened.has(key)}
                    aria-controls="acc-{i}-{k}"
                    onclick={() => toggle(key)}
                  >
                    <span class="line">
                      {#if it.state && it.state !== 'open'}<span class="word"
                          >{stateWord(it.state)}</span
                        >{/if}
                      <span>{it.text}</span>
                      {#if it.meta}<span class="meta">{it.meta}</span>{/if}
                    </span>
                    {#if it.comments?.length}<span class="badge" aria-hidden="true"
                        ><Icon name="comment" size={14} />{it.comments.length}</span
                      >{/if}
                    <span class="chev" aria-hidden="true"><Icon name="chevron" size={18} /></span>
                  </button>
                  {#if opened.has(key)}
                    <div id="acc-{i}-{k}">
                      <ItemActions board={id} item={it} onchanged={() => onchanged?.()} />
                    </div>
                  {/if}
                </li>
              {:else}
                {@const why = `why|${i}|${k}`}
                <li class="st-{it.state ?? 'none'}" class:has-why={it.info}>
                  {#if it.info}
                    <span class="body">
                      {#if it.state && it.state !== 'open'}<span class="word"
                          >{stateWord(it.state)}</span
                        >{/if}
                      <span>{it.text}</span>
                      {#if it.meta}<span class="meta">{it.meta}</span>{/if}
                    </span>
                  {:else}
                    {#if it.state && it.state !== 'open'}<span class="word"
                        >{stateWord(it.state)}</span
                      >{/if}
                    <span>{it.text}</span>
                    {#if it.meta}<span class="meta">{it.meta}</span>{/if}
                  {/if}
                  {#if it.info}
                    <InfoButton
                      open={opened.has(why)}
                      ontoggle={() => toggle(why)}
                      controls="why-{i}-{k}"
                    />
                    {#if opened.has(why)}<p class="why" id="why-{i}-{k}">{it.info}</p>{/if}
                  {/if}
                </li>
              {/if}
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

<style>
  .span {
    display: flex;
    margin: 4px 0 10px;
  }
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
  /* a line with an explanation: text and figures left, the ⓘ top right, the sentence opens below */
  .items li.has-why {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0 14px;
  }
  .body {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  .items li.has-why :global(.info) {
    margin-top: -10px;
  }
  .why {
    grid-column: 1 / -1;
    margin: 4px 0 0;
    color: var(--muted);
    font-size: var(--small);
  }
  .items li.acc {
    display: block;
    padding: 0;
  }
  .acc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .acc-head .line {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    line-height: 1.35;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--muted);
    font-size: 14px;
  }
  .chev {
    color: var(--muted);
    display: grid;
    transition: transform 0.15s ease;
  }
  .acc.open .chev {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
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
