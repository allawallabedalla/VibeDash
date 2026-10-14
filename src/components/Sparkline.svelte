<script lang="ts">
  import { runs, smoothPath, type Point } from './path';

  interface Props {
    values: (number | null)[];
    /** Optional range band, e.g. the usual 10–90 % of past days. */
    band?: { low: (number | null)[]; high: (number | null)[] };
    color?: string;
    /** Signed series: zero line, positive part above in `color`, negative below in `negativeColor`. */
    signed?: boolean;
    negativeColor?: string;
    height?: number;
    min?: number;
    max?: number;
    label: string;
  }

  let {
    values,
    band,
    color = 'var(--text)',
    signed = false,
    negativeColor = 'var(--import)',
    height = 56,
    min,
    max,
    label,
  }: Props = $props();

  const uid = $props.id();
  let width = $state(240);
  const pad = 3;

  const domain = $derived.by(() => {
    const all = [...values, ...(band?.low ?? []), ...(band?.high ?? [])].filter(
      (v): v is number => v !== null,
    );
    if (signed) all.push(0);
    let lo = min ?? Math.min(...all);
    let hi = max ?? Math.max(...all);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    return { lo, hi };
  });

  const xAt = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (width - 2 * pad);
  const yAt = (v: number) =>
    pad + (1 - (v - domain.lo) / (domain.hi - domain.lo)) * (height - 2 * pad);

  const segments = $derived(
    runs(values).map(({ start, end }) => {
      const pts: Point[] = [];
      for (let i = start; i <= end; i++) pts.push({ x: xAt(i), y: yAt(values[i]!) });
      return pts;
    }),
  );

  const baseY = $derived(signed ? yAt(0) : height - pad);

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

<div class="spark" bind:clientWidth={width} style:height="{height}px">
  <svg {width} {height} role="img" aria-label={label}>
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
        <clipPath id="{uid}-below"
          ><rect x="0" y={baseY} {width} height={height - baseY} /></clipPath
        >
      {/if}
    </defs>

    {#each gaps as g, i (i)}
      <rect class="gap" x={g.x} y="0" width={g.w} {height} rx="4" fill="url(#{uid}-hatch)" />
    {/each}

    {#if bandPath}
      <path d={bandPath} fill={color} fill-opacity="0.14" />
    {/if}

    {#if signed}
      <line x1={pad} x2={width - pad} y1={baseY} y2={baseY} stroke="var(--line)" stroke-width="1" />
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
  .line {
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
