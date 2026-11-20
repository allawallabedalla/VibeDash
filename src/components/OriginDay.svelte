<script lang="ts">
  /**
   * "Where did the power come from today?" (Audit05 I-1): 24 h, stacked up to
   * the consumption – sun directly, battery, grid; feed-in apart as a thin
   * strip on top (own scale); from "now" on faint: the usual consumption and
   * the part the sun forecast covers. Tap (or point) at a time for its values.
   * Drawn in CSS pixels, so the axis text stays 14 px on every screen.
   */
  import type { OriginDay } from '../app/origin-day';
  import { niceScale, stackTops } from '../model/origin';
  import { num, t, time } from '../i18n/index.svelte';
  import { runs, smoothPath, type Point } from './path';

  interface Props {
    day: OriginDay;
    timeZone: string;
    /** height of the main plot in px */
    height?: number;
  }
  let { day, timeZone, height = 180 }: Props = $props();

  const uid = $props.id();
  let width = $state(600);
  const L = 52;
  const R = 10;
  const STRIP = 26;
  const top = STRIP + 30; // feed strip, then room for "jetzt"
  const bottom = $derived(top + height);
  const total = $derived(bottom + 26);

  const n = $derived(day.slots.load.length);
  const xAt = (i: number) => L + ((i + 0.5) / n) * (width - L - R);
  const xT = (ms: number) => L + ((ms - day.from) / (day.to - day.from)) * (width - L - R);

  const peak = $derived(
    Math.max(
      0.5,
      ...day.slots.load.map((v) => v ?? 0),
      ...(day.forecast?.load ?? []).map((v) => v ?? 0),
    ),
  );
  const scale = $derived(niceScale(peak));
  const yAt = (v: number) => bottom - (v / scale.max) * height;
  const yMarks = $derived(
    Array.from({ length: Math.round(scale.max / scale.step) + 1 }, (_, k) => k * scale.step),
  );

  /** smooth area from a top edge down to the base line, one per run without gaps */
  const areas = (vals: (number | null)[], y: (v: number) => number, base: number) =>
    runs(vals).map(({ start, end }) => {
      const pts: Point[] = [];
      for (let i = start; i <= end; i++) pts.push({ x: xAt(i), y: y(vals[i]!) });
      if (pts.length === 1) pts.push({ x: pts[0]!.x + 1, y: pts[0]!.y });
      return `${smoothPath(pts)}L${pts.at(-1)!.x},${base}L${pts[0]!.x},${base}Z`;
    });
  const lines = (vals: (number | null)[], y: (v: number) => number) =>
    runs(vals).map(({ start, end }) => {
      const pts: Point[] = [];
      for (let i = start; i <= end; i++) pts.push({ x: xAt(i), y: y(vals[i]!) });
      return smoothPath(pts);
    });

  const tops = $derived(stackTops(day.slots));
  const layers = $derived([
    { d: areas(tops[2], yAt, bottom), color: 'var(--import)' },
    { d: areas(tops[1], yAt, bottom), color: 'var(--battery)' },
    { d: areas(tops[0], yAt, bottom), color: 'var(--sun)' },
  ]);
  const loadLine = $derived(lines(day.slots.load, yAt));

  // future: usual consumption (faint, dashed edge), the sun-covered part faint yellow
  const fcLoadArea = $derived(day.forecast ? areas(day.forecast.load, yAt, bottom) : []);
  const fcSunArea = $derived(day.forecast?.withSun ? areas(day.forecast.sun, yAt, bottom) : []);
  const fcLine = $derived(day.forecast ? lines(day.forecast.load, yAt) : []);

  // feed-in strip: own scale, grows upwards from its base line
  const feedPeak = $derived(Math.max(0, ...day.slots.feed.map((v) => v ?? 0)));
  const feedMax = $derived(niceScale(Math.max(feedPeak, 0.5)).max);
  const feedY = (v: number) => STRIP - (v / feedMax) * (STRIP - 2);
  const feedArea = $derived(feedPeak > 0 ? areas(day.slots.feed, feedY, STRIP) : []);

  // past slots without values: soft hatched gaps, never bridged
  // last slot that began before "now"
  const nowIndex = $derived(Math.min(n - 1, Math.floor((day.now - day.from - 1) / day.stepMs)));
  const gaps = $derived.by(() => {
    const past = day.slots.load.map((v, i) => (i <= nowIndex && v === null ? 1 : null));
    return runs(past).map(({ start, end }) => ({
      x: L + (start / n) * (width - L - R),
      w: ((end - start + 1) / n) * (width - L - R),
    }));
  });

  const hours = $derived.by(() => {
    const out: { x: number; label: string }[] = [];
    for (let h = 0; h <= 24; h += 6) {
      const ms = day.from + h * 3_600_000;
      out.push({ x: xT(Math.min(ms, day.to)), label: `${String(h).padStart(2, '0')}:00` });
    }
    return out;
  });
  const nowX = $derived(xT(day.now));

  // tapped / pointed slot; without one the last measured slot ("jetzt")
  let picked = $state<number | null>(null);
  const lastKnown = $derived.by(() => {
    for (let i = nowIndex; i >= 0; i--) if (day.slots.load[i] !== null) return i;
    return null;
  });
  const sel = $derived(picked ?? lastKnown);
  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left - L) / (width - L - R)) * n);
    picked = i >= 0 && i < n ? i : null;
  };
  const tt = $derived(day.totals);
  const kwh = (v: number) => `≈ ${num(v, v < 10 ? 1 : 0)} kWh`;
  const pct = (v: number | undefined) => (v === undefined ? '' : `${num(v * 100)} %`);
  const legend = $derived([
    {
      label: t('oday.sun'),
      color: 'var(--sun)',
      text: 'var(--sun-text)',
      value: kwh(tt.sun),
      share: pct(tt.share?.sun),
    },
    {
      label: t('tile.battery'),
      color: 'var(--battery)',
      text: 'var(--good-text)',
      value: kwh(tt.battery),
      share: pct(tt.share?.battery),
    },
    {
      label: t('sources.grid'),
      color: 'var(--import)',
      text: 'var(--import-text)',
      value: kwh(tt.grid),
      share: pct(tt.share?.grid),
    },
    {
      label: t('oday.feed'),
      color: 'var(--feed)',
      text: 'var(--feed-text)',
      value: kwh(tt.feed),
      share: '',
    },
    ...(day.forecast
      ? [
          {
            label: day.forecast.withSun ? t('oday.aheadSun') : t('oday.ahead'),
            color: 'var(--home)',
            text: '',
            value: '',
            share: '',
            line: true,
          },
        ]
      : []),
  ]);
  const kw = (v: number) => num(v, v < 10 ? 1 : 0);
  const readout = $derived.by(() => {
    if (sel === null) return '';
    const at = time(day.from + sel * day.stepMs, timeZone);
    const s = day.slots;
    if (s.load[sel] !== null) {
      return t('oday.readout', {
        time: at,
        load: kw(s.load[sel]!),
        sun: kw(s.sun[sel]!),
        battery: kw(s.battery[sel]!),
        grid: kw(s.grid[sel]!),
      });
    }
    const f = day.forecast;
    if (sel > nowIndex && f && f.load[sel] !== null) {
      return t('oday.readoutFc', {
        time: at,
        load: kw(f.load[sel]!),
        sun: f.withSun && f.sun[sel] !== null ? kw(f.sun[sel]!) : '–',
      });
    }
    return sel > nowIndex ? `${at} · –` : t('oday.readoutGap', { time: at });
  });
</script>

<div class="origin">
  <ul class="legend">
    {#each legend as item (item.label)}
      <li>
        <span class="key" class:line={item.line} style:background={item.color}></span>{item.label}
        {#if item.value}<b style:color={item.text}>{item.value}</b>{/if}
        {#if item.share}<span class="share">{item.share}</span>{/if}
      </li>
    {/each}
  </ul>
  <div class="plot" bind:clientWidth={width} style:height="{total}px">
    <svg
      {width}
      height={total}
      role="img"
      aria-label={t('oday.title')}
      onpointerdown={pick}
      onpointermove={(e) => e.pointerType === 'mouse' && pick(e)}
      onpointerleave={(e) => e.pointerType === 'mouse' && (picked = null)}
    >
      <defs>
        <pattern
          id="{uid}-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--faint)" stroke-width="1.2" />
        </pattern>
      </defs>

      <!-- feed-in strip on top, own scale -->
      <line class="base" x1={L} x2={width - R} y1={STRIP} y2={STRIP} />
      {#each feedArea as d, i (i)}<path {d} class="feed" />{/each}
      <text class="axis feed-label" x={L - 6} y={STRIP} text-anchor="end">{num(feedMax)} kW</text>

      {#each yMarks as v (v)}
        <line class="grid" x1={L} x2={width - R} y1={yAt(v)} y2={yAt(v)} />
        <text class="axis" x={L - 6} y={yAt(v) + 5} text-anchor="end"
          >{num(v, scale.step < 1 ? 1 : 0)}{v === scale.max ? ' kW' : ''}</text
        >
      {/each}

      {#each gaps as g, i (i)}
        <rect x={g.x} y={top} width={g.w} {height} rx="3" fill="url(#{uid}-hatch)" />
      {/each}

      {#each fcLoadArea as d, i (i)}<path {d} class="fc-rest" />{/each}
      {#each fcSunArea as d, i (i)}<path {d} class="fc-sun" />{/each}
      {#each fcLine as d, i (i)}<path {d} class="fc-line" />{/each}

      {#each layers as layer (layer.color)}
        {#each layer.d as d, i (i)}<path {d} class="layer" style:--c={layer.color} />{/each}
      {/each}
      {#each loadLine as d, i (i)}<path {d} class="load" />{/each}

      <line class="now" x1={nowX} x2={nowX} y1={top - 18} y2={bottom} />
      <text
        class="axis now-label"
        x={nowX}
        y={top - 22}
        text-anchor={nowX > width - 60 ? 'end' : nowX < L + 40 ? 'start' : 'middle'}
        >{t('sub.now')}</text
      >

      {#if picked !== null}
        <line class="cursor" x1={xAt(picked)} x2={xAt(picked)} y1={top} y2={bottom} />
      {/if}

      {#each hours as h, i (i)}
        <text
          class="axis"
          x={h.x}
          y={bottom + 20}
          text-anchor={i === 0 ? 'start' : i === hours.length - 1 ? 'end' : 'middle'}
          >{width < 420 && i > 0 && i < hours.length - 1 ? h.label.slice(0, 2) : h.label}</text
        >
      {/each}
    </svg>
  </div>
  <p class="readout" aria-live="polite">{readout}</p>
</div>

<style>
  .origin {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plot {
    width: 100%;
    position: relative;
    touch-action: pan-y;
  }
  svg {
    display: block;
    overflow: visible;
    cursor: crosshair;
  }
  .axis {
    font-size: 14px;
    fill: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .grid,
  .base {
    stroke: var(--line);
    stroke-width: 1;
  }
  .layer {
    /* opaque: the layers lie on top of each other without mixing their colours */
    fill: color-mix(in srgb, var(--c) 58%, var(--surface));
  }
  .load {
    fill: none;
    stroke: var(--home);
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .feed {
    fill: var(--feed);
    fill-opacity: 0.45;
  }
  .fc-rest {
    fill: var(--faint);
    fill-opacity: 0.35;
  }
  .fc-sun {
    fill: var(--sun);
    fill-opacity: 0.2;
  }
  .fc-line {
    fill: none;
    stroke: var(--home);
    stroke-width: 2;
    stroke-dasharray: 5 4;
    opacity: 0.6;
  }
  .now {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .feed-label {
    fill: var(--feed-text);
  }
  .now-label {
    fill: var(--text-2);
  }
  .cursor {
    stroke: var(--text);
    stroke-width: 1;
    opacity: 0.35;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .legend b {
    font-weight: 600;
    margin-left: 4px;
  }
  .share {
    margin-left: 4px;
    color: var(--muted);
  }
  .key {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    border-radius: 3px;
    vertical-align: -1px;
    opacity: 0.75;
  }
  .key.line {
    height: 0;
    border-top: 2px dashed var(--home);
    background: none !important;
    vertical-align: 3px;
    width: 16px;
    border-radius: 0;
  }
  .readout {
    margin: 0;
    min-height: 1.4em;
    font-size: 14px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
</style>
