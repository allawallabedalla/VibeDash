<script lang="ts">
  /**
   * Charge timeline: the day's sun (median and 10–90 % band), the house load, the house battery and the grid
   * import – and charge windows to place, move, stretch and remove. Everything is recomputed on every pointer
   * move (charge-timeline.ts, in the browser). Touch: horizontal drags move windows, vertical swipes scroll.
   */
  import {
    DT_H,
    evaluate,
    STEPS,
    suggest,
    sunBand,
    type Cases,
    type House,
    type Window,
  } from '../app/charge-timeline';
  import { i18n } from '../i18n/index.svelte';

  let {
    cases,
    house,
    startStep = 0,
    kwOptions = [3.7, 7.4, 11],
  }: {
    cases: Cases;
    house: House;
    /** steps before this are the past: shaded, no windows there */
    startStep?: number;
    kwOptions?: number[];
  } = $props();

  // the drawing has the size of its box in CSS pixels: crisp text and finger-sized handles on a phone
  let boxW = $state(0);
  const W = $derived(Math.max(300, Math.round(boxW) || 1000));
  const narrow = $derived(W < 600);
  const TOP = 14;
  const PLOT = $derived(narrow ? 230 : 230); // bottom of the power area
  const GRID_H = $derived(narrow ? 64 : 70); // grid import area below
  const H = $derived(PLOT + GRID_H + 28);

  const TEXT = {
    de: {
      car: 'Auto bekommt',
      grid: 'Netz',
      sun: 'Sonnenanteil',
      of: 'von {n} kWh',
      range: '{lo}–{hi} kWh (8 von 10 Fällen)',
      sunSub: 'der Auto-Ladung ohne Netz',
      add: '+ Fenster',
      best: 'Bester Vorschlag',
      clear: 'Alle weg',
      remove: 'Löschen',
      power: 'Leistung',
      hint: 'Fenster ziehen zum Verschieben, Ränder ziehen für länger oder kürzer, Doppeltipp auf freie Stelle für ein neues.',
      legendSun: 'Sonne (Band: schlechter bis guter Tag)',
      legendLoad: 'Haus',
      legendBat: 'Hausakku',
      legendGrid: 'Netzbezug',
      inWin: '{v} kWh Netz',
      noGrid: 'ohne Netz',
    },
    en: {
      car: 'Car gets',
      grid: 'Grid',
      sun: 'Solar share',
      of: 'of {n} kWh',
      range: '{lo}–{hi} kWh (8 in 10 cases)',
      sunSub: 'of the car’s energy without grid',
      add: '+ Window',
      best: 'Best suggestion',
      clear: 'Clear all',
      remove: 'Remove',
      power: 'Power',
      hint: 'Drag a window to move it, drag its edges to make it longer or shorter, double-tap a free spot for a new one.',
      legendSun: 'Sun (band: poor to good day)',
      legendLoad: 'House',
      legendBat: 'House battery',
      legendGrid: 'Grid import',
      inWin: '{v} kWh grid',
      noGrid: 'no grid',
    },
  };
  const tx = $derived(TEXT[i18n.locale === 'de' ? 'de' : 'en']);
  const f = (v: number, nd = 0) =>
    v.toLocaleString(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      maximumFractionDigits: nd,
      minimumFractionDigits: nd,
    });
  const fill = (s: string, v: Record<string, string>) =>
    s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

  // svelte-ignore state_referenced_locally (the first window only needs the start once)
  const first = Math.min(Math.max(startStep, 44), 88);
  // svelte-ignore state_referenced_locally
  let windows = $state<Window[]>([
    { id: 1, from: first, to: first + 8, kw: kwOptions[1] ?? kwOptions[0] ?? 7 },
  ]);
  let selected = $state<number | null>(1);
  let nextId = 2;

  const band = $derived(sunBand(cases));
  const r = $derived(evaluate(cases, house, windows));
  const maxKw = $derived(Math.max(12, ...band.p90, ...windows.map((w) => w.kw)) * 1.08);
  const maxGrid = $derived(Math.max(2, ...r.gridKw.p90));

  const x = (i: number) => (i / STEPS) * W;
  const y = (kw: number) => PLOT - (kw / maxKw) * (PLOT - TOP);
  const yb = (kwh: number) => PLOT - (kwh / house.batteryKwh) * (PLOT - TOP);
  const yg = (kw: number) => PLOT + 6 + (kw / maxGrid) * (GRID_H - 12);
  const line = (vals: number[], fy: (v: number) => number) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + 0.5).toFixed(1)},${fy(v).toFixed(1)}`).join('');
  const area = (lo: number[], hi: number[], fy: (v: number) => number) =>
    `M${x(0.5)},${fy(hi[0]!)}` +
    hi.map((v, i) => `L${x(i + 0.5).toFixed(1)},${fy(v).toFixed(1)}`).join('') +
    lo
      .map((_, k) => {
        const i = lo.length - 1 - k;
        return `L${x(i + 0.5).toFixed(1)},${fy(lo[i]!).toFixed(1)}`;
      })
      .join('') +
    'Z';
  const zeros = new Array<number>(STEPS).fill(0);

  function windowState(k: number): 'good' | 'fair' | 'poor' {
    const g = r.windowGrid[k] ?? 0;
    return g < 0.2 ? 'good' : g < 1.5 ? 'fair' : 'poor';
  }

  // ── pointer ────────────────────────────────────────────────────────────
  let svg: SVGSVGElement;
  let drag: {
    id: number;
    mode: 'move' | 'from' | 'to';
    start: number;
    from: number;
    to: number;
  } | null = null;
  let lastTap = 0;
  const stepAt = (e: PointerEvent | MouseEvent) => {
    const b = svg.getBoundingClientRect();
    return Math.max(0, Math.min(STEPS, ((e.clientX - b.left) / b.width) * STEPS));
  };
  const edgeSteps = () => ((narrow ? 22 : 14) / svg.getBoundingClientRect().width) * STEPS; // finger vs mouse

  function down(e: PointerEvent) {
    const s = stepAt(e);
    const edge = edgeSteps();
    // edges first (they sit on top of neighbours), then bodies
    for (const w of windows) {
      const mode =
        Math.abs(s - w.from) <= edge
          ? 'from'
          : Math.abs(s - w.to) <= edge
            ? 'to'
            : s > w.from && s < w.to
              ? 'move'
              : null;
      if (mode) {
        drag = { id: w.id, mode, start: s, from: w.from, to: w.to };
        selected = w.id;
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    const now = performance.now();
    if (now - lastTap < 350) add(Math.round(s));
    lastTap = now;
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const d = drag;
    const delta = Math.round(stepAt(e) - d.start);
    windows = windows.map((w) => {
      if (w.id !== d.id) return w;
      if (d.mode === 'move') {
        const len = d.to - d.from;
        const from = Math.max(startStep, Math.min(STEPS - len, d.from + delta));
        return { ...w, from, to: from + len };
      }
      if (d.mode === 'from')
        return { ...w, from: Math.max(startStep, Math.min(d.to - 1, d.from + delta)) };
      return { ...w, to: Math.min(STEPS, Math.max(d.from + 1, d.to + delta)) };
    });
  }
  function up() {
    drag = null;
  }

  function add(at = 48) {
    const from = Math.max(startStep, Math.min(STEPS - 8, at - 4));
    windows = [
      ...windows,
      { id: nextId, from, to: Math.min(STEPS, from + 8), kw: kwOptions[1] ?? kwOptions[0] ?? 7 },
    ];
    selected = nextId++;
  }
  function remove(id: number) {
    windows = windows.filter((w) => w.id !== id);
    selected = windows.at(-1)?.id ?? null;
  }
  function best() {
    const kw = windows.find((w) => w.id === selected)?.kw ?? kwOptions[1] ?? kwOptions[0] ?? 7;
    windows = suggest(cases, house, kw).map((w) => ({ ...w, id: nextId++ }));
    selected = windows[0]?.id ?? null;
  }
  const setKw = (id: number, kw: number) =>
    (windows = windows.map((w) => (w.id === id ? { ...w, kw } : w)));
  const clock = (i: number) => {
    const m = Math.round(i * DT_H * 60);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const sel = $derived(windows.find((w) => w.id === selected) ?? null);
  const selIndex = $derived(windows.findIndex((w) => w.id === selected));
</script>

<div class="kpis">
  <div class="kpi">
    <span class="lab">{tx.car}</span>
    <span class="val"><b>{f(r.carKwh)}</b> kWh</span>
    <span class="sub">{fill(tx.of, { n: f(house.carNeedKwh) })}</span>
    <span class="bar"
      ><span style:width="{Math.min(100, (r.carKwh / house.carNeedKwh) * 100)}%"></span></span
    >
  </div>
  <div class="kpi" class:warn={r.grid.p50 >= 0.5}>
    <span class="lab">{tx.grid}</span>
    <span class="val">≈ <b>{f(r.grid.p50, 1)}</b> kWh</span>
    <span class="sub">{fill(tx.range, { lo: f(r.grid.p10, 1), hi: f(r.grid.p90, 1) })}</span>
  </div>
  <div class="kpi">
    <span class="lab">{tx.sun}</span>
    <span class="val"><b>{f(r.sunShare * 100)}</b> %</span>
    <span class="sub">{tx.sunSub}</span>
    <span class="bar sun"><span style:width="{r.sunShare * 100}%"></span></span>
  </div>
</div>

<div class="wrap" bind:clientWidth={boxW}>
  <svg
    bind:this={svg}
    viewBox="0 0 {W} {H}"
    class="chart"
    role="application"
    aria-label={tx.hint}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <!-- hour grid -->
    {#each [0, 3, 6, 9, 12, 15, 18, 21, 24] as h (h)}
      <line class="hour" x1={x(h * 4)} x2={x(h * 4)} y1={TOP} y2={PLOT + GRID_H} />
      <text
        class="tick"
        x={x(h * 4)}
        y={H - 10}
        text-anchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>{h}</text
      >
    {/each}
    <line class="base" x1="0" x2={W} y1={PLOT} y2={PLOT} />

    {#if startStep > 0}<rect
        class="past"
        x="0"
        y={TOP}
        width={x(startStep)}
        height={PLOT + GRID_H - TOP}
      />{/if}
    <!-- windows (under the curves, so the sun stays readable) -->
    {#each windows as w, k (w.id)}
      {@const st = windowState(k)}
      <g class="win {st}" class:sel={w.id === selected}>
        <rect x={x(w.from)} y={TOP} width={x(w.to) - x(w.from)} height={PLOT - TOP} rx="8" />
        <rect
          class="car"
          x={x(w.from)}
          y={y(w.kw)}
          width={x(w.to) - x(w.from)}
          height={PLOT - y(w.kw)}
        />
        <line class="edge" x1={x(w.from)} x2={x(w.from)} y1={TOP + 10} y2={PLOT - 10} />
        <line class="edge" x1={x(w.to)} x2={x(w.to)} y1={TOP + 10} y2={PLOT - 10} />
        {#if x(w.to) - x(w.from) >= 64}<text
            class="wlab"
            x={(x(w.from) + x(w.to)) / 2}
            y={TOP + 16}
            text-anchor="middle"
            >{(r.windowGrid[k] ?? 0) < 0.05
              ? tx.noGrid
              : fill(tx.inWin, { v: f(r.windowGrid[k] ?? 0, 1) })}</text
          >{/if}
      </g>
    {/each}

    <path class="sunband" d={area(band.p10, band.p90, y)} />
    <path class="sunline" d={line(band.p50, y)} />
    <path class="load" d={line(cases.load[Math.floor(cases.load.length / 2)]!, y)} />
    <path class="bat" d={line(r.batteryKwh.p50, yb)} />

    <!-- grid import below the line -->
    <path class="gridband" d={area(zeros, r.gridKw.p90, yg)} />
    <path class="grid" d={area(zeros, r.gridKw.p50, yg)} />
  </svg>
</div>

<div class="legend">
  <span><i class="sw sun"></i>{tx.legendSun}</span>
  <span><i class="sw load"></i>{tx.legendLoad}</span>
  <span><i class="sw bat"></i>{tx.legendBat}</span>
  <span><i class="sw grid"></i>{tx.legendGrid}</span>
</div>

<div class="tools">
  <button type="button" onclick={() => add()}>{tx.add}</button>
  <button type="button" onclick={best}>{tx.best}</button>
  {#if windows.length}<button
      type="button"
      class="quiet"
      onclick={() => ((windows = []), (selected = null))}>{tx.clear}</button
    >{/if}
</div>

{#if sel}
  <div class="selbar">
    <span class="when">{clock(sel.from)}–{clock(sel.to)}</span>
    <span class="pw">{tx.power}</span>
    {#each kwOptions as k (k)}
      <button type="button" class:on={sel.kw === k} onclick={() => setKw(sel.id, k)}
        >{f(k, 1)} kW</button
      >
    {/each}
    <button type="button" class="quiet" onclick={() => remove(sel.id)}>{tx.remove}</button>
    {#if selIndex >= 0}<span class="sr">{selIndex + 1}/{windows.length}</span>{/if}
  </div>
{/if}
<p class="hint">{tx.hint}</p>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 12px;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    transition: background 0.15s;
  }
  .kpi.warn {
    background: var(--act-bg);
  }
  .lab {
    font-size: var(--small);
    color: var(--muted);
  }
  .val {
    font-size: 15px;
    color: var(--text-2);
  }
  .val b {
    font-size: 30px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .bar {
    margin-top: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--battery);
    transition: width 0.08s linear;
  }
  .bar.sun span {
    background: var(--sun);
  }
  .wrap {
    width: 100%;
  }
  .chart {
    display: block;
    width: 100%;
    height: auto;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }
  .hour {
    stroke: var(--line);
  }
  .past {
    fill: var(--gap);
  }
  .base {
    stroke: var(--faint);
  }
  .tick {
    fill: var(--muted);
    font-size: 12px;
  }
  .sunband {
    fill: var(--sun);
    opacity: 0.18;
  }
  .sunline {
    fill: none;
    stroke: var(--sun);
    stroke-width: 2.5;
  }
  .load {
    fill: none;
    stroke: var(--home);
    stroke-width: 2;
    opacity: 0.8;
  }
  .bat {
    fill: none;
    stroke: var(--battery);
    stroke-width: 2;
    stroke-dasharray: 6 5;
  }
  .grid {
    fill: var(--import);
    opacity: 0.85;
  }
  .gridband {
    fill: var(--import);
    opacity: 0.22;
  }
  .win rect:first-child {
    fill: var(--good);
    opacity: 0.1;
    stroke: var(--good);
    stroke-opacity: 0.35;
  }
  .win.fair rect:first-child {
    fill: var(--fair);
    stroke: var(--fair);
  }
  .win.poor rect:first-child {
    fill: var(--poor);
    stroke: var(--poor);
  }
  .win.sel rect:first-child {
    opacity: 0.2;
    stroke-opacity: 0.9;
    stroke-width: 2;
  }
  .win .car {
    fill: var(--good);
    opacity: 0.28;
  }
  .win.fair .car {
    fill: var(--fair);
  }
  .win.poor .car {
    fill: var(--poor);
  }
  .edge {
    stroke: var(--text-2);
    stroke-width: 4;
    stroke-linecap: round;
    opacity: 0.35;
    cursor: ew-resize;
  }
  .win.sel .edge {
    opacity: 0.8;
  }
  .wlab {
    font-size: 12px;
    fill: var(--text-2);
    pointer-events: none;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 6px 0 10px;
    font-size: var(--small);
    color: var(--muted);
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 4px;
    border-radius: 2px;
    margin-right: 6px;
    vertical-align: middle;
  }
  .sw.sun {
    background: var(--sun);
  }
  .sw.load {
    background: var(--home);
  }
  .sw.bat {
    background: var(--battery);
  }
  .sw.grid {
    background: var(--import);
  }
  .tools,
  .selbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }
  button {
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 22px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button.on {
    border-color: var(--battery);
    background: color-mix(in srgb, var(--battery) 14%, var(--surface));
    font-weight: 600;
  }
  button.quiet {
    color: var(--muted);
  }
  .when {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .pw,
  .sr {
    color: var(--muted);
    font-size: var(--small);
  }
  .hint {
    color: var(--muted);
    font-size: var(--small);
    margin: 4px 0 0;
  }
  @media (max-width: 560px) {
    .kpis {
      gap: 6px;
    }
    .kpi {
      padding: 10px;
    }
    .val b {
      font-size: 22px;
    }
    .sub {
      font-size: 11px;
    }
  }
</style>
