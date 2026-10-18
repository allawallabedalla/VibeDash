<script lang="ts" module>
  /** The drawing's scale, for an axis drawn on top (enlarged view only). */
  export interface SparkScale {
    xAt: (i: number) => number;
    yAt: (v: number) => number;
    slots: number;
    width: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    total: number;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { runs, smoothPath, type Point } from './path';

  interface Props {
    values: (number | null)[];
    /** Optional range band, e.g. the usual 10–90 % of past days. */
    band?: { low: (number | null)[]; high: (number | null)[] };
    color?: string;
    /**
     * Own forecast line on the same slots (null where there is none), drawn dashed and
     * never glued onto the actual line; a thin mark shows where "now" is.
     */
    forecast?: (number | null)[];
    /** Signed series: zero line, positive part above in `color`, negative below in `negativeColor`. */
    signed?: boolean;
    negativeColor?: string;
    height?: number;
    min?: number;
    max?: number;
    label: string;
    /** extra room around the curve for axis texts (enlarged view) */
    inset?: { l: number; r: number; t: number; b: number };
    /** drawn behind the curve / on top of it, with the scale; replaces the own "now" mark */
    under?: Snippet<[SparkScale]>;
    over?: Snippet<[SparkScale]>;
  }

  let {
    values,
    band,
    forecast,
    color = 'var(--text)',
    signed = false,
    negativeColor = 'var(--import)',
    height = 56,
    min,
    max,
    label,
    inset,
    under,
    over,
  }: Props = $props();

  const uid = $props.id();
  let width = $state(240);
  const pad = 3;
  const L = $derived(inset?.l ?? pad);
  const R = $derived(inset?.r ?? pad);
  const T = $derived(inset?.t ?? pad);
  const total = $derived(inset ? height + inset.t + inset.b - 2 * pad : height);
  const B = $derived(total - (inset?.b ?? pad));

  const domain = $derived.by(() => {
    const all = [
      ...values,
      ...(forecast ?? []),
      ...(band?.low ?? []),
      ...(band?.high ?? []),
    ].filter((v): v is number => v !== null);
    if (signed) all.push(0);
    let lo = min ?? Math.min(...all);
    let hi = max ?? Math.max(...all);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    return { lo, hi };
  });

  const slots = $derived(Math.max(values.length, forecast?.length ?? 0));
  const xAt = (i: number) => L + (i / Math.max(slots - 1, 1)) * (width - L - R);
  const yAt = (v: number) => T + (1 - (v - domain.lo) / (domain.hi - domain.lo)) * (B - T);
  const scale = $derived<SparkScale>({
    xAt,
    yAt,
    slots,
    width,
    left: L,
    right: width - R,
    top: T,
    bottom: B,
    total,
  });

  const segments = $derived(
    runs(values).map(({ start, end }) => {
      const pts: Point[] = [];
      for (let i = start; i <= end; i++) pts.push({ x: xAt(i), y: yAt(values[i]!) });
      return pts;
    }),
  );

  const baseY = $derived(signed ? yAt(0) : B);

  const lines = $derived(segments.map((pts) => smoothPath(pts)));
  const areas = $derived(
    segments.map((pts, k) =>
      pts.length > 1 ? `${lines[k]}L${pts.at(-1)!.x},${baseY}L${pts[0]!.x},${baseY}Z` : '',
    ),
  );

  const bandPath = $derived.by(() => {
    if (!band) return '';
    const ok = band.low.map((l, i) => (l !== null && band.high[i] !== null ? 1 : null));
    return runs(ok)
      .map(({ start, end }) => {
        const top: Point[] = [];
        const bottom: Point[] = [];
        for (let i = start; i <= end; i++) {
          top.push({ x: xAt(i), y: yAt(band.high[i]!) });
          bottom.unshift({ x: xAt(i), y: yAt(band.low[i]!) });
        }
        const b = smoothPath(bottom).replace(/^M/, 'L');
        return `${smoothPath(top)}${b}Z`;
      })
      .join('');
  });

  const forecastLines = $derived(
    forecast
      ? runs(forecast).map(({ start, end }) => {
          const pts: Point[] = [];
          for (let i = start; i <= end; i++) pts.push({ x: xAt(i), y: yAt(forecast[i]!) });
          return smoothPath(pts);
        })
      : [],
  );
  /** "Now": after the last actual value, where the forecast takes over. */
  const nowX = $derived.by(() => {
    if (!forecast || over) return null;
    let last = values.length - 1;
    while (last >= 0 && values[last] === null) last--;
    return last < 0 ? null : xAt(last);
  });

  /** Gaps between runs: shown as a soft hatched area, never bridged. */
  const gaps = $derived.by(() => {
    const r = runs(values);
    const out: { x: number; w: number }[] = [];
    for (let k = 1; k < r.length; k++) {
      const x0 = xAt(r[k - 1]!.end);
      const x1 = xAt(r[k]!.start);
      out.push({ x: x0, w: x1 - x0 });
    }
    return out;
  });
</script>

<div class="spark" bind:clientWidth={width} style:height="{total}px">
  <svg {width} height={total} role="img" aria-label={label}>
    <defs>
      <linearGradient id="{uid}-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color={color} stop-opacity="0.28" />
        <stop offset="1" stop-color={color} stop-opacity="0.02" />
      </linearGradient>
      <linearGradient id="{uid}-neg" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color={negativeColor} stop-opacity="0.02" />
        <stop offset="1" stop-color={negativeColor} stop-opacity="0.28" />
      </linearGradient>
      <pattern
        id="{uid}-hatch"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="6"
          stroke="var(--faint)"
          stroke-width="1.2"
          stroke-opacity="0.45"
        />
      </pattern>
      {#if signed}
        <clipPath id="{uid}-above"><rect x="0" y="0" {width} height={baseY} /></clipPath>
        <clipPath id="{uid}-below"><rect x="0" y={baseY} {width} height={total - baseY} /></clipPath
        >
      {/if}
    </defs>

    {@render under?.(scale)}

    {#each gaps as g, i (i)}
      <rect class="gap" x={g.x} y={T} width={g.w} height={B - T} rx="4" fill="url(#{uid}-hatch)" />
    {/each}

    {#if bandPath}
      <path d={bandPath} fill={color} fill-opacity="0.14" />
    {/if}

    {#if signed}
      <line x1={L} x2={width - R} y1={baseY} y2={baseY} stroke="var(--line)" stroke-width="1" />
      <g clip-path="url(#{uid}-above)">
        {#each areas as d, i (i)}<path {d} fill="url(#{uid}-fill)" />{/each}
        {#each lines as d, i (i)}<path {d} class="line" stroke={color} />{/each}
      </g>
      <g clip-path="url(#{uid}-below)">
        {#each areas as d, i (i)}<path {d} fill="url(#{uid}-neg)" />{/each}
        {#each lines as d, i (i)}<path {d} class="line" stroke={negativeColor} />{/each}
      </g>
    {:else}
      {#each areas as d, i (i)}<path {d} fill="url(#{uid}-fill)" />{/each}
      {#each lines as d, i (i)}<path {d} class="line" stroke={color} />{/each}
    {/if}
    {#if nowX !== null}
      <line class="now" x1={nowX} x2={nowX} y1="0" y2={height} />
    {/if}
    {#each forecastLines as d, i (i)}<path {d} class="line forecast" stroke={color} />{/each}
    {@render over?.(scale)}
  </svg>
</div>

<style>
  .spark {
    width: 100%;
    position: relative;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .now {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .forecast {
    stroke-dasharray: 5 4;
    stroke-width: 2;
    opacity: 0.85;
  }
  .line {
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
