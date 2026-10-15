<script lang="ts" module>
  export interface FlowNodeLabels {
    sun: string;
    house: string;
    battery: string;
    car: string;
    grid: string;
    charging: string;
    discharging: string;
    idle: string;
    feedIn: string;
    import: string;
    still: string;
  }
</script>

<script lang="ts">
  /**
   * Energy flow now, drawn like a child's doodle: only strokes, ink plus the
   * colour of the origin (sun yellow, battery green, grid violet). Sun, house,
   * battery, car and pylon; between them dashed lanes whose dashes run in the
   * direction of the flow, thicker for more power. A lane that carries energy
   * of several origins gets one strand per origin. The lines "boil" a little
   * like hand-drawn animation; with "reduce motion" everything stands still.
   */
  import { onMount } from 'svelte';
  import type { Flows, Sink, Source } from '../model/flows';
  import { num } from '../i18n/index.svelte';

  interface Props {
    flows: Flows;
    /** battery state of charge, % */
    soc: number | null;
    labels: FlowNodeLabels;
    /** one sentence for screen readers */
    summary: string;
  }
  let { flows, soc, labels, summary }: Props = $props();

  const W = 400;
  const H = 330;
  type Lane = 'sun' | 'battery' | 'car' | 'grid';
  type Pt = [number, number];
  // each lane: from the thing to the house, with a bend
  const LANE: Record<Lane, { a: Pt; b: Pt; bend: number }> = {
    sun: { a: [96, 84], b: [176, 124], bend: -14 },
    battery: { a: [100, 226], b: [150, 206], bend: 10 },
    car: { a: [292, 228], b: [250, 206], bend: -10 },
    grid: { a: [308, 112], b: [236, 138], bend: 12 },
  };
  const hasCar = $derived(flows.car !== null);
  const lanes = $derived<Lane[]>(
    hasCar ? ['sun', 'battery', 'car', 'grid'] : ['sun', 'battery', 'grid'],
  );
  const COLOR: Record<Source, string> = {
    sun: 'var(--sun)',
    battery: 'var(--battery)',
    grid: 'var(--import)',
  };

  /** quadratic curve a → b, shifted sideways by `off` (parallel strands) */
  function lanePath(l: Lane, off = 0, reverse = false): string {
    const { a, b, bend } = LANE[l];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const s: Pt = [a[0] + nx * off, a[1] + ny * off];
    const e: Pt = [b[0] + nx * off, b[1] + ny * off];
    const c: Pt = [(a[0] + b[0]) / 2 + nx * (bend + off), (a[1] + b[1]) / 2 + ny * (bend + off)];
    const [p, q] = reverse ? [e, s] : [s, e];
    return `M${p[0]},${p[1]} Q${c[0]},${c[1]} ${q[0]},${q[1]}`;
  }

  const laneOf = (x: Source | Sink): Lane | null =>
    x === 'sun'
      ? 'sun'
      : x === 'battery'
        ? 'battery'
        : x === 'grid'
          ? 'grid'
          : x === 'car'
            ? 'car'
            : null;

  /** strands per lane: origin, direction (into the house or out), watts */
  const strands = $derived.by(() => {
    const m: Record<string, { lane: Lane; from: Source; out: boolean; w: number }> = {};
    const add = (lane: Lane, from: Source, out: boolean, w: number) => {
      const k = `${lane}|${from}|${out}`;
      const s = (m[k] ??= { lane, from, out, w: 0 });
      s.w += w;
    };
    for (const f of flows.flows) {
      add(laneOf(f.from)!, f.from, false, f.w);
      const to = laneOf(f.to);
      if (to) add(to, f.from, true, f.w);
    }
    // parallel offsets inside each lane
    const out: { lane: Lane; from: Source; out: boolean; w: number; off: number }[] = [];
    for (const l of ['sun', 'battery', 'car', 'grid'] as Lane[]) {
      const here = Object.values(m)
        .filter((s) => s.lane === l)
        .sort((a, b) => b.w - a.w);
      here.forEach((s, i) => out.push({ ...s, off: (i - (here.length - 1) / 2) * 7 }));
    }
    return out;
  });
  const width = (w: number) => 1.8 + Math.min(4.2, Math.sqrt(w / 1000) * 1.5);
  /** seconds per dash cycle: a bit quicker for more power, still calm */
  const speed = (w: number) => Math.max(0.6, 1.6 - Math.sqrt(w / 1000) * 0.25);

  // texts
  const kw = (w: number) => `${num(Math.abs(w) / 1000, 1)} kW`;
  const batWord = $derived(
    flows.battery > 0 ? labels.charging : flows.battery < 0 ? labels.discharging : labels.idle,
  );
  const gridWord = $derived(
    flows.grid > 0 ? labels.feedIn : flows.grid < 0 ? labels.import : labels.still,
  );
  const socFill = $derived(soc === null ? 0 : Math.max(0, Math.min(100, soc)));
  // battery scribble: one zigzag stroke per 10 % charge
  const scribble = $derived(
    Array.from({ length: Math.round(socFill / 10) }, (_, i) => {
      const y = 254 - i * 4.4;
      return `M50,${y} l7,-3 l7,3 l7,-3 l7,3 l7,-3 l7,3 l6,-2`;
    }),
  );

  // the "boiling line": a slightly different wobble a few times a second
  let seed = $state(1);
  let still = $state(false);
  onMount(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    still = reduce.matches;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      clearInterval(timer);
      still = reduce.matches;
      if (!still && document.visibilityState === 'visible') {
        timer = setInterval(() => (seed = (seed % 3) + 1), 220);
      }
    };
    reduce.addEventListener('change', run);
    document.addEventListener('visibilitychange', run);
    run();
    return () => {
      clearInterval(timer);
      reduce.removeEventListener('change', run);
      document.removeEventListener('visibilitychange', run);
    };
  });
</script>

<div class="doodle" class:still role="img" aria-label={summary}>
  <svg viewBox="0 0 {W} {H}" aria-hidden="true">
    <defs>
      <filter id="ef-wobble" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" {seed} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
      </filter>
    </defs>

    <g class="ink" filter="url(#ef-wobble)">
      <!-- sun -->
      <g class="sun" class:on={flows.sun > 0}>
        <circle cx="62" cy="58" r="22" />
        {#each Array.from({ length: 10 }, (_, i) => (i * Math.PI) / 5 + 0.2) as a (a)}
          <line
            x1={62 + Math.cos(a) * 29}
            y1={58 + Math.sin(a) * 29}
            x2={62 + Math.cos(a) * (40 + ((a * 7) % 6))}
            y2={58 + Math.sin(a) * (40 + ((a * 7) % 6))}
          />
        {/each}
      </g>

      <!-- house: body, roof, door, window -->
      <path d="M152,148 L152,236 L248,236 L248,148" />
      <path d="M140,152 L200,104 L262,152" />
      <path d="M186,236 L186,204 L208,204 L208,236" />
      <rect x="218" y="166" width="20" height="18" />
      <path d="M228,166 L228,184 M218,175 L238,175" />
      <path d="M138,238 Q200,244 262,238" class="thin" />

      <!-- battery: box, terminal, scribbled charge -->
      <rect x="46" y="214" width="56" height="46" rx="4" />
      <path d="M66,214 L66,207 L82,207 L82,214" />
      {#each scribble as d (d)}<path class="fill bat" {d} />{/each}

      {#if hasCar}
        <!-- car -->
        <path
          d="M288,262 L288,244 Q292,236 302,234 L312,220 Q318,214 330,214 L352,214 Q362,216 366,226 L372,236 Q382,238 382,250 L382,262"
        />
        <path d="M288,262 L300,262 M326,262 L346,262 M372,262 L382,262" />
        <circle cx="313" cy="263" r="10" />
        <circle cx="359" cy="263" r="10" />
        <path d="M318,232 L328,220 L340,220 L340,232 Z" class="thin" />
        <path d="M346,220 L356,220 Q362,224 364,232 L346,232 Z" class="thin" />
      {/if}

      <!-- pylon -->
      <path
        d="M318,130 L336,40 L354,130 M322,110 L350,110 M327,86 L345,86 M331,64 L341,64 M322,110 L345,86 L327,86 L341,64"
      />
      <path d="M314,58 L358,58 M318,74 L354,74" class="thin" />
      <path d="M314,58 Q300,70 286,62 M358,58 Q372,70 388,62" class="thin" />

      <!-- lanes: faint pencil line, then the flowing dashes on top -->
      {#each lanes as l (l)}
        <path class="track" d={lanePath(l)} />
      {/each}
    </g>

    {#each strands as s (`${s.lane}|${s.from}|${s.out}`)}
      <path
        class="dash"
        d={lanePath(s.lane, s.off, s.out)}
        style:stroke={COLOR[s.from]}
        stroke-width={width(s.w)}
        style:animation-duration="{speed(s.w)}s"
        filter="url(#ef-wobble)"
      />
    {/each}
  </svg>

  <!-- numbers in handwriting next to the drawings -->
  <span class="note" style:left="29.5%" style:top="6%">
    <b>{flows.sun > 0 ? kw(flows.sun) : '0 kW'}</b>{labels.sun}
  </span>
  <span class="note center" style:left="50%" style:top="74.5%">
    <b>{kw(flows.house)}</b>{labels.house}
  </span>
  <span class="note center" style:left="18.5%" style:top="81%">
    <b>{flows.battery === 0 ? (soc === null ? '–' : `${num(soc)} %`) : kw(flows.battery)}</b
    >{labels.battery}
    · {batWord}{soc !== null && flows.battery !== 0 ? ` · ${num(soc)} %` : ''}
  </span>
  {#if hasCar}
    <span class="note center" style:left="83.5%" style:top="85%">
      <b>{flows.car ? kw(flows.car) : '0 kW'}</b>{labels.car} · {flows.car
        ? labels.charging
        : labels.still}
    </span>
  {/if}
  <span class="note center" style:left="88%" style:top="41%">
    <b>{flows.grid === 0 ? '0 kW' : kw(flows.grid)}</b>{labels.grid} · {gridWord}
  </span>
</div>

<style>
  .doodle {
    position: relative;
    width: 100%;
    aspect-ratio: 400 / 330;
    font-family: 'Chalkboard SE', 'Marker Felt', 'Comic Sans MS', var(--font);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .ink :global(path),
  .ink :global(line),
  .ink :global(circle),
  .ink :global(rect) {
    fill: none;
    stroke: var(--text);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ink :global(.thin) {
    stroke-width: 1.6;
    opacity: 0.7;
  }
  .ink :global(.fill.bat) {
    stroke: var(--battery);
    stroke-width: 2;
    opacity: 0.85;
  }
  .sun :global(circle),
  .sun :global(line) {
    stroke: var(--muted);
  }
  .sun.on :global(circle),
  .sun.on :global(line) {
    stroke: var(--sun);
    stroke-width: 2.8;
  }
  .ink :global(.track) {
    stroke: var(--line);
    stroke-width: 1.6;
    stroke-dasharray: 2 6;
  }
  .dash {
    fill: none;
    stroke-linecap: round;
    stroke-dasharray: 9 11;
    animation: run linear infinite;
  }
  @keyframes run {
    to {
      stroke-dashoffset: -20;
    }
  }
  .still .dash {
    animation: none;
  }
  .note {
    position: absolute;
    display: flex;
    flex-direction: column;
    font-size: 13px;
    line-height: 1.15;
    color: var(--text-2);
    white-space: nowrap;
  }
  .note b {
    font-size: 17px;
    color: var(--text);
  }
  .note.center {
    transform: translateX(-50%);
    align-items: center;
  }
  @media (max-width: 600px) {
    .note {
      font-size: 14px;
    }
    .note b {
      font-size: 15px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dash {
      animation: none;
    }
  }
</style>
