<script lang="ts" module>
  /** Where the chart draws, in CSS px from the host's top left corner. */
  export interface LensGeom {
    xAt: (i: number) => number;
    yAt: (v: number) => number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
</script>

<script lang="ts">
  /**
   * The lens over a line chart: a fine vertical line at the pointer, a dot on each line
   * and a box with the time and every value (forecast with range, actual − forecast).
   * Mouse: follows the pointer, leaving hides it. Finger: lay it on and drag, the box
   * sits above the finger, lifting hides it. Keyboard: arrows step, Home/End, Esc closes.
   * Loaded on the first touch, hover or focus of a chart (budget), then it listens on
   * the host itself.
   */
  import { onMount } from 'svelte';
  import { i18n, num } from '../i18n/index.svelte';
  import {
    lensDigits,
    lensRows,
    lensText,
    lensTime,
    medianStep,
    nearestIndex,
    type LensSeries,
  } from './lens';
  import { tl } from './lens-text';

  interface Props {
    host: HTMLElement;
    /** the event that loaded the lens: shown right away */
    first: Event | null;
    times: number[];
    series: LensSeries[];
    unit: string;
    /** decimals of the value axis: the box shows at least these (G-28) */
    axisDigits?: number;
    timeZone: string;
    geom: () => LensGeom | null;
    now?: number;
    /** states: the value's name instead of a number */
    levels?: { value: number; label: string }[];
  }
  let {
    host,
    first,
    times,
    series,
    unit,
    axisDigits = 0,
    timeZone,
    geom,
    now,
    levels,
  }: Props = $props();

  let idx = $state<number | null>(null);
  let g = $state<LensGeom | null>(null);
  let finger = $state<{ x: number; y: number } | null>(null);
  let size = $state({ w: 0, h: 0 });
  let bw = $state(0);
  let bh = $state(0);

  const digits = $derived(
    lensDigits(
      series.flatMap((s) => s.values),
      axisDigits,
    ),
  );
  const step = $derived(medianStep(times));
  const spanMs = $derived((times.at(-1) ?? 0) - (times[0] ?? 0));
  const u = $derived(unit ? ` ${unit}` : '');
  const fmt = {
    value: (v: number) =>
      levels?.length
        ? levels.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).label
        : `${num(v, digits)}${u}`,
    range: (lo: number, hi: number) => `${num(lo, digits)}–${num(hi, digits)}`,
    diff: (v: number) => `${num(v, digits)}${u}`,
    get unit() {
      return u;
    },
  };

  const time = $derived(
    idx === null
      ? ''
      : lensTime(times[idx]!, timeZone, step, spanMs, i18n.locale === 'de' ? 'de-DE' : 'en-GB'),
  );
  const rows = $derived(
    idx === null
      ? []
      : lensRows(
          idx,
          series,
          fmt,
          { noData: tl('noData'), diff: tl('diff') },
          now !== undefined && times[idx]! > now,
        ),
  );
  const empty = $derived(!rows.length || rows.every((r) => r.gap));
  const said = $derived(idx === null ? '' : lensText(time, rows, tl('noData')));
  const lx = $derived(idx !== null && g ? g.xAt(idx) : 0);
  const dots = $derived(
    idx === null || !g
      ? []
      : series.flatMap((s) => {
          const v = s.values[idx!];
          return v === null || v === undefined || s.kind === 'band'
            ? []
            : [{ y: g!.yAt(v), color: s.color, hollow: s.dashed ?? s.kind === 'forecast' }];
        }),
  );

  /** the box: beside the line (mouse, keys), above the finger (touch) – always inside the chart */
  const box = $derived.by(() => {
    const gap = 14;
    const maxL = Math.max(0, size.w - bw);
    if (finger) {
      const above = finger.y - bh - 40;
      // may reach up over the legend (its lines repeat in the box), never sideways out
      if (above >= -56) return { l: Math.min(maxL, Math.max(0, lx - bw / 2)), t: above };
      // no room above the finger: beside it, on the side away from the hand's centre
      const l = lx > size.w / 2 ? lx - gap - 30 - bw : lx + gap + 30;
      return { l: Math.min(maxL, Math.max(0, l)), t: 0 };
    }
    const right = lx + gap;
    const l = right + bw <= size.w ? right : lx - gap - bw;
    // top of the chart, unless the lines run up there: then at the bottom, off the values
    const top = Math.max(0, (g?.top ?? 0) - 4);
    const low = Math.max(top, (g?.bottom ?? size.h) - bh);
    const near = (y: number) => dots.some((d) => d.y > y - 8 && d.y < y + bh + 8);
    return { l: Math.min(maxL, Math.max(0, l)), t: near(top) && !near(low) ? low : top };
  });

  function measure() {
    g = geom();
    size = { w: host.clientWidth, h: host.clientHeight };
    return g;
  }
  function at(clientX: number, clientY: number, touch: boolean) {
    const geo = measure();
    if (!geo || !times.length) return;
    const r = host.getBoundingClientRect();
    const x = clientX - r.left;
    if (x < geo.left - 16 || x > geo.right + 16) return hide();
    idx = nearestIndex(
      times.map((_, i) => geo.xAt(i)),
      x,
    );
    finger = touch ? { x, y: clientY - r.top } : null;
  }
  function hide() {
    idx = null;
    finger = null;
  }
  /** the newest index with any value: where the keys start */
  function lastFilled() {
    for (let i = times.length - 1; i >= 0; i--)
      if (series.some((s) => s.values[i] !== null && s.values[i] !== undefined)) return i;
    return times.length - 1;
  }

  const pointer = (e: PointerEvent) => {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (e.type === 'pointermove' && touch && e.buttons === 0) return;
    at(e.clientX, e.clientY, touch);
  };
  function key(e: KeyboardEvent) {
    const n = times.length;
    if (!n) return;
    if (e.key === 'Escape') {
      if (idx === null) return;
      // close the lens, not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      return hide();
    }
    const big = Math.max(1, Math.round(n / 12));
    const moves: Record<string, number> = {
      ArrowLeft: e.shiftKey ? -big : -1,
      ArrowRight: e.shiftKey ? big : 1,
      PageDown: -big,
      PageUp: big,
    };
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key in moves) next = idx === null ? lastFilled() : idx + moves[e.key]!;
    else return;
    e.preventDefault();
    measure();
    finger = null;
    idx = Math.max(0, Math.min(n - 1, next));
  }

  onMount(() => {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      host.addEventListener(type, fn);
      return () => host.removeEventListener(type, fn);
    };
    const off = [
      on('pointerdown', pointer),
      on('pointermove', pointer),
      on('pointerup', (e) => e.pointerType !== 'mouse' && hide()),
      on('pointercancel', hide),
      on('pointerleave', hide),
      on('keydown', key),
      on('blur', hide),
    ];
    if (first instanceof PointerEvent) pointer(first);
    else if (first instanceof KeyboardEvent) key(first);
    return () => off.forEach((f) => f());
  });
</script>

{#if idx !== null && g}
  <svg class="lens" width={size.w} height={size.h} aria-hidden="true">
    <line x1={lx} x2={lx} y1={g.top - 2} y2={g.bottom} />
    {#each dots as d, i (i)}
      <circle
        cx={lx}
        cy={d.y}
        r="5"
        fill={d.hollow ? 'var(--surface)' : d.color}
        stroke={d.hollow ? d.color : 'var(--surface)'}
      />
    {/each}
  </svg>
{/if}
<div
  class="box"
  class:shown={idx !== null}
  bind:offsetWidth={bw}
  bind:offsetHeight={bh}
  style:left="{box.l}px"
  style:top="{box.t}px"
>
  {#if idx !== null}
    <p class="when">{time}</p>
    {#if empty}
      <p class="row gap">{tl('noData')}</p>
    {:else}
      {#each rows as r, i (i)}
        <p class="row" class:gap={r.gap} class:diff={r.diff}>
          {#if !r.diff}<span class="key" class:dashed={r.dashed} style:color={r.color}></span>{/if}
          <span class="lab">{r.label}</span>
          <b>{r.value}</b>{#if r.range}<span class="range">{r.range}</span>{/if}
        </p>
      {/each}
    {/if}
  {/if}
</div>
<p class="sr" aria-live="polite">{said}</p>

<style>
  .lens {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .lens line {
    stroke: var(--text);
    stroke-width: 1.2;
    opacity: 0.45;
  }
  .lens circle {
    stroke-width: 2;
  }
  .box {
    position: absolute;
    z-index: 2;
    display: none;
    max-width: min(300px, 100%);
    box-sizing: border-box;
    padding: 8px 12px;
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-high);
    font-size: 14px;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .box.shown {
    display: block;
  }
  .box p {
    margin: 0;
  }
  .when {
    font-weight: 600;
    margin-bottom: 2px !important;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
  }
  .lab {
    color: var(--text-2, var(--muted));
  }
  .row b {
    font-weight: 600;
  }
  .row.gap b,
  .row.gap {
    color: var(--muted);
    font-weight: 400;
  }
  .row.diff {
    border-top: 1px solid var(--line);
    margin-top: 3px !important;
    padding-top: 3px;
  }
  .range {
    color: var(--muted);
  }
  .key {
    width: 14px;
    height: 4px;
    border-radius: 2px;
    background: currentColor;
    flex: none;
  }
  .key.dashed {
    background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    margin: 0;
  }
</style>
