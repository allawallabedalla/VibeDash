<script lang="ts">
  /**
   * A tile's small curve, enlarged: the same drawing plus a few round time
   * marks below, a fine "now" line with a dot on the newest value, and – for
   * states – their names on the value axis. Loaded with the enlarged tile only.
   */
  import { t } from '../i18n/index.svelte';
  import Sparkline, { type SparkScale } from './Sparkline.svelte';
  import { timeTicks } from './timeaxis';
  import type { LensSeries } from './lens';
  import { lensHost } from './lens-host.svelte';
  import { tl } from './lens-text';

  interface Props {
    values: (number | null)[];
    forecast?: (number | null)[];
    band?: { low: (number | null)[]; high: (number | null)[] };
    color: string;
    signed?: boolean;
    min?: number;
    label: string;
    height?: number;
    /** time (ms) of the first and the last value */
    span: { from: number; to: number };
    now?: number;
    timeZone: string;
    levels?: { value: number; label: string }[];
    /** unit of the values, for the lens box */
    unit?: string;
  }
  let {
    values,
    forecast,
    band,
    color,
    signed,
    min,
    label,
    height = 130,
    span,
    now,
    timeZone,
    levels,
    unit = '',
  }: Props = $props();

  const slots = $derived(Math.max(values.length, forecast?.length ?? 0));
  const step = $derived((span.to - span.from) / Math.max(slots - 1, 1));
  const inset = $derived({
    l: levels?.length ? Math.max(...levels.map((l) => l.label.length)) * 7.2 + 12 : 3,
    r: 8,
    t: 20,
    b: 24,
  });
  const ticks = $derived(
    timeTicks(span.from, span.to, timeZone, {
      points: slots,
      hour: (h) => t('axis.hour', { h: String(h) }),
    }),
  );
  /** time → x on the curve's own scale */
  const xOf = (s: SparkScale, t0: number) =>
    s.xAt(((t0 - span.from) / Math.max(span.to - span.from, 1)) * Math.max(s.slots - 1, 1));
  /** marks inside the drawing, none crowding the one before */
  const shown = (s: SparkScale) => {
    const out: { t: number; label: string; x: number }[] = [];
    for (const k of ticks) {
      const x = xOf(s, k.t);
      if (x < s.left - 1 || x > s.right + 1) continue;
      const prev = out.at(-1);
      if (prev && x - prev.x < (k.label.length + prev.label.length) * 3.6 + 12) continue;
      out.push({ ...k, x });
    }
    return out;
  };
  const anchor = (s: SparkScale, x: number, room = 16) =>
    x < s.left + room ? 'start' : x > s.right - room ? 'end' : 'middle';
  /** "now" inside the span only; the dot sits on the newest value up to now */
  const nowMark = (s: SparkScale) => {
    if (now === undefined || now < span.from - step / 2 || now > span.to + step / 2) return null;
    const x = xOf(s, Math.min(Math.max(now, span.from), span.to));
    let i = Math.min(Math.round((now - span.from) / Math.max(step, 1)), values.length - 1);
    while (i >= 0 && values[i] === null) i--;
    return { x, dot: i >= 0 ? { x: s.xAt(i), y: s.yAt(values[i]!) } : null };
  };
  /** the lens (hover, finger, arrow keys): loaded on first use; the scale comes from the drawing */
  const lens = lensHost();
  let host = $state<HTMLElement>();
  let scale: SparkScale | null = null;
  const keep = (s: SparkScale) => {
    scale = s;
    return '';
  };
  const times = $derived(Array.from({ length: slots }, (_, i) => span.from + i * step));
  const lensSeries = $derived.by(() => {
    const out: LensSeries[] = [];
    const more = !!forecast || !!band;
    out.push({ label: more ? tl('actual') : '', color, values, kind: more ? 'actual' : undefined });
    if (forecast)
      out.push({
        label: tl('forecast'),
        color,
        values: forecast,
        kind: 'forecast',
        ...(band ? { low: band.low, high: band.high } : {}),
      });
    else if (band) out.push({ label: tl('usual'), color, values: [], kind: 'band', ...band });
    return out;
  });
  const lensGeom = () =>
    scale && {
      xAt: scale.xAt,
      yAt: scale.yAt,
      left: scale.left,
      right: scale.right,
      top: scale.top,
      bottom: scale.bottom,
    };
  const top = $derived(levels?.length ? Math.max(...levels.map((l) => l.value)) : undefined);
</script>

<!-- focusable for the lens: arrow keys step through the values (role application passes the keys on) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="plot"
  bind:this={host}
  role="application"
  tabindex="0"
  aria-label={tl('hint', { label })}
  onpointerenter={lens.wake}
  onpointerdown={lens.wake}
  onfocus={lens.wake}
>
  <Sparkline {values} {forecast} {band} {color} {signed} {min} max={top} {height} {label} {inset}>
    {#snippet under(s)}
      <g>
        {#each levels ?? [] as l (l.value)}
          <line class="grid" x1={s.left} x2={s.right} y1={s.yAt(l.value)} y2={s.yAt(l.value)} />
          <text class="axis" x={s.left - 8} y={s.yAt(l.value) + 4} text-anchor="end">{l.label}</text
          >
        {/each}
        {#each shown(s) as k (k.t)}
          <line class="grid" x1={k.x} x2={k.x} y1={s.top} y2={s.bottom} />
          <text class="axis" x={k.x} y={s.total - 6} text-anchor={anchor(s, k.x)}>{k.label}</text>
        {/each}
      </g>
    {/snippet}
    {#snippet over(s)}
      {@const m = nowMark(s)}
      <g>
        {keep(s)}
        {#if m}
          <line class="now" x1={m.x} x2={m.x} y1={s.top - 4} y2={s.bottom} />
          <text class="axis now-text" x={m.x} y={s.top - 8} text-anchor={anchor(s, m.x, 24)}
            >{t('sub.now')}</text
          >
          {#if m.dot}<circle class="dot" cx={m.dot.x} cy={m.dot.y} r="4.5" fill={color} />{/if}
        {/if}
      </g>
    {/snippet}
  </Sparkline>
  {#if lens.Lens && host}
    <lens.Lens
      {host}
      first={lens.first}
      {times}
      series={lensSeries}
      {unit}
      {timeZone}
      geom={lensGeom}
      {now}
      {levels}
    />
  {/if}
</div>

<style>
  .plot {
    position: relative;
    touch-action: pan-y;
    cursor: crosshair;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    border-radius: 8px;
  }
  .plot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .now {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .now-text {
    fill: var(--text-2);
  }
  .dot {
    stroke: var(--surface);
    stroke-width: 2;
  }
  @media (max-width: 600px) {
    .axis {
      font-size: 13px;
    }
  }
</style>
