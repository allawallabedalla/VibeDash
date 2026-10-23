<script lang="ts">
  /**
   * A tile, enlarged: tapped on any page, it opens as a dialog with the value,
   * the explanation in full (no second tap), and – when the tile names its
   * series – the curve for 24 h / 7 days / 30 days with min, max, mean and n
   * from the readings the page already has. Without series: the tile's own
   * graphic, larger. Loaded only when a tile is tapped.
   */
  import { onMount } from 'svelte';
  import { store } from '../app/data.svelte';
  import { num, t, time } from '../i18n/index.svelte';
  import { buckets, coveredFrom, windowStats, ZOOM_WINDOWS, type ZoomWindow } from '../model/zoom';
  import Explanation from './Explanation.svelte';
  import Icon from './Icon.svelte';
  import LineChart from './LineChart.svelte';
  import Segmented from './Segmented.svelte';
  import SparkZoom from './SparkZoom.svelte';
  import Sparkline from './Sparkline.svelte';
  import type { TileProps } from './Tile.svelte';

  let { tile, onclose }: { tile: TileProps; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  let win = $state<ZoomWindow>('day');
  onMount(() => dialog.showModal());

  const data = $derived(store.state.status === 'ready' ? store.state.data : null);
  const zoom = $derived(tile.zoom);
  const now = $derived(data?.now ?? Date.now());
  const from = $derived(now - ZOOM_WINDOWS[win]);
  const POINTS = 240;

  const lines = $derived(
    (zoom?.lines ?? []).flatMap((l) => {
      const samples = data?.series[l.id]?.samples ?? [];
      if (!samples.length) return [];
      const scale = l.scale ?? 1;
      const b = buckets(samples, from, now, POINTS);
      return [
        {
          ...l,
          x: b.x,
          values: b.values.map((v) => (v === null ? null : v * scale)),
          stats: windowStats(samples, from, now),
          covered: coveredFrom(samples, from),
          scale,
        },
      ];
    }),
  );
  const x = $derived(lines[0]?.x ?? []);
  const digits = $derived(zoom?.digits ?? 1);
  const when = (ms: number) =>
    win === 'day'
      ? time(ms, data?.timeZone ?? 'Europe/Berlin')
      : new Intl.DateTimeFormat('de-DE', {
          timeZone: data?.timeZone,
          day: 'numeric',
          month: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(ms);
  /** the curve shows means per step; min/max come from all readings */
  const stepText = $derived.by(() => {
    const m = Math.round(ZOOM_WINDOWS[win] / POINTS / 60_000);
    return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
  });
  const late = $derived(
    lines.find((l) => l.covered !== null && l.covered - from > ZOOM_WINDOWS[win] * 0.1),
  );
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="zoom-title" class="zoom">
  <form method="dialog" class="head">
    <span class="icon" style:color={tile.color}><Icon name={tile.icon} /></span>
    <h2 id="zoom-title">{tile.label}</h2>
    <button class="x" aria-label={t('fb.close')}><Icon name="close" /></button>
  </form>

  <div class="reading">
    <span class="value"
      >{#if tile.approx}<span class="approx">≈</span>{/if}{tile.value}{#if tile.unit}<span
          class="unit">{tile.unit}</span
        >{/if}</span
    >
    {#if tile.sub}<p class="sub">{tile.sub}</p>{/if}
    {#if tile.pending}<p class="sub">{tile.pending}</p>{/if}
  </div>

  {#if lines.length}
    <div class="seg-row">
      <Segmented
        options={[
          { id: 'day', label: t('zoom.day') },
          { id: 'week', label: t('zoom.week') },
          { id: 'month', label: t('zoom.month') },
        ]}
        bind:value={win}
        label={t('zoom.window')}
      />
    </div>
    <LineChart
      {x}
      lines={lines.map((l) => ({ label: l.label, values: l.values, color: l.color }))}
      unit={zoom?.unit ?? ''}
      timeZone={data?.timeZone ?? 'Europe/Berlin'}
      label={tile.label}
      tight={zoom?.tight ?? false}
      legendValues={false}
      {now}
    />
    <p class="sub">{t('zoom.curve', { step: stepText })}</p>
    {#if late?.covered}
      <p class="sub">{t('zoom.since', { when: when(late.covered) })}</p>
    {/if}
    <dl class="stats">
      {#each lines as l (l.id)}
        {#if l.stats}
          {#if lines.length > 1}<dt class="line" style:color={l.color}>{l.label}</dt>
            <dd></dd>{/if}
          <dt>{t('zoom.min')}</dt>
          <dd>{num(l.stats.min * l.scale, digits)} {zoom?.unit} · {when(l.stats.minAt)}</dd>
          <dt>{t('zoom.max')}</dt>
          <dd>{num(l.stats.max * l.scale, digits)} {zoom?.unit} · {when(l.stats.maxAt)}</dd>
          <dt>{t('zoom.mean')}</dt>
          <dd>{num(l.stats.mean * l.scale, digits)} {zoom?.unit}</dd>
          <dt>{t('zoom.n')}</dt>
          <dd>{num(l.stats.n)}</dd>
        {/if}
      {/each}
    </dl>
  {:else if tile.graphic?.kind === 'spark'}
    {@const g = tile.graphic}
    <div class="spark">
      {#if g.span}
        <SparkZoom
          values={g.values}
          forecast={g.forecast}
          band={g.band}
          color={g.color ?? tile.color ?? 'var(--text)'}
          signed={g.signed}
          min={g.min}
          label={tile.label}
          span={g.span}
          {now}
          timeZone={data?.timeZone ?? 'Europe/Berlin'}
          levels={g.levels}
        />
      {:else}
        <Sparkline
          values={g.values}
          forecast={g.forecast}
          band={g.band}
          color={g.color ?? tile.color}
          signed={g.signed}
          min={g.min}
          height={120}
          label={tile.label}
        />
      {/if}
    </div>
  {/if}

  {#if tile.info}
    <div class="info"><Explanation what={tile.info.what} source={tile.info.source} /></div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(760px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    border: 2px solid var(--border);
    border-radius: 20px;
    padding: 16px 20px 20px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog[open] {
    display: grid;
    gap: 12px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon {
    display: grid;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    flex: 1;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text);
  }
  .x {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .value {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .unit {
    font-size: 18px;
    font-weight: 500;
    color: var(--muted);
    margin-left: 4px;
  }
  .approx {
    font-weight: 400;
    color: var(--muted);
    margin-right: 2px;
  }
  .sub {
    margin: 4px 0 0;
    font-size: 15px;
    color: var(--muted);
  }
  .seg-row {
    display: flex;
  }
  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0;
    font-size: 15px;
  }
  .stats dt {
    color: var(--muted);
  }
  .stats dt.line {
    font-weight: 600;
    margin-top: 6px;
  }
  .stats dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .spark {
    padding: 4px 0;
  }
  .info {
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
</style>
