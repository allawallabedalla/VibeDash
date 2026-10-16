<script lang="ts">
  /**
   * A small line chart for boards: several lines over time, own colour each,
   * optionally dashed; gaps stay gaps. The drawing width follows the card, so
   * the text keeps its size on the phone.
   */
  import { num, time } from '../i18n/index.svelte';

  interface Line {
    label: string;
    values: (number | null)[];
    color: string;
    dashed?: boolean;
  }
  interface Props {
    x: number[];
    lines: Line[];
    unit: string;
    timeZone: string;
    label: string;
    /** axis around the values instead of from zero (temperatures, battery level) */
    tight?: boolean;
  }
  let { x, lines, unit, timeZone, label, tight = false }: Props = $props();

  let cw = $state(640);
  const VW = $derived(cw < 520 ? 380 : 640);
  const VH = $derived(cw < 520 ? 230 : 200);
  const PAD = { l: 40, r: 14, t: 10, b: 22 };

  const all = $derived(lines.flatMap((l) => l.values).filter((v): v is number => v !== null));
  /** a round step for a tight axis: 0.5, 1, 2, 5, 10 … */
  const roundStep = (span: number) => {
    const p = 10 ** Math.floor(Math.log10(Math.max(span, 1e-9)));
    return ([1, 2, 5, 10].find((k) => k * p >= span / 4) ?? 10) * p;
  };
  const tightLo = $derived.by(() => {
    if (!tight || !all.length) return null;
    const step = roundStep(Math.max(...all) - Math.min(...all) || 1);
    return Math.floor(Math.min(...all) / step) * step;
  });
  const lo = $derived(tightLo ?? Math.min(0, ...all));
  const hi = $derived.by(() => {
    if (tight && all.length) {
      const step = roundStep(Math.max(...all) - Math.min(...all) || 1);
      const top = Math.ceil(Math.max(...all) / step) * step;
      return top > lo ? top : lo + step;
    }
    const m = Math.max(...all, 0);
    if (m <= 0) return 1;
    // a round top close above the largest value (104 → 120, not 200)
    const p = 10 ** Math.floor(Math.log10(m));
    const f = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * p >= m) ?? 10;
    return f * p;
  });
  const from = $derived(x[0] ?? 0);
  const to = $derived(x.at(-1) ?? 1);
  const X = (t0: number) => PAD.l + ((VW - PAD.l - PAD.r) * (t0 - from)) / Math.max(1, to - from);
  const Y = (v: number) => PAD.t + (VH - PAD.t - PAD.b) * (1 - (v - lo) / Math.max(1e-9, hi - lo));

  const path = (vals: (number | null)[]) => {
    let d = '';
    let open = false;
    vals.forEach((v, i) => {
      if (v === null || x[i] === undefined) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${X(x[i]!).toFixed(1)},${Y(v).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const ticksY = $derived([lo, (lo + hi) / 2, hi].filter((v, i, a) => a.indexOf(v) === i));
  const spanDays = $derived((to - from) / 86_400_000);
  const ticksX = $derived.by(() => {
    const n = cw < 520 ? 3 : 5;
    return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  });
  const fmtX = (t0: number) =>
    spanDays > 2
      ? new Intl.DateTimeFormat('de-DE', { timeZone, day: 'numeric', month: 'numeric' }).format(t0)
      : time(t0, timeZone);
  const last = (vals: (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return vals[i]!;
    return null;
  };
</script>

<ul class="legend">
  {#each lines as l (l.label)}
    {@const v = last(l.values)}
    <li>
      <span class="key" class:dashed={l.dashed} style:color={l.color}></span>{l.label}
      {v !== null ? `${num(v, Math.abs(v) < 10 ? 1 : 0)} ${unit}` : ''}
    </li>
  {/each}
</ul>
<svg bind:clientWidth={cw} viewBox="0 0 {VW} {VH}" role="img" aria-label={label}>
  {#each ticksY as v (v)}
    <line class="grid" x1={PAD.l} x2={VW - PAD.r} y1={Y(v)} y2={Y(v)} />
    <text class="axis" x={PAD.l - 6} y={Y(v) + 4} text-anchor="end"
      >{num(v, Math.abs(hi - lo) < 5 ? 1 : 0)}</text
    >
  {/each}
  {#each ticksX as t0, i (i)}
    <text
      class="axis"
      x={X(t0)}
      y={VH - 4}
      text-anchor={i === 0 ? 'start' : i === ticksX.length - 1 ? 'end' : 'middle'}>{fmtX(t0)}</text
    >
  {/each}
  {#each lines as l (l.label)}
    <path class="ln" class:dashed={l.dashed} d={path(l.values)} style:stroke={l.color} />
  {/each}
</svg>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font-size: var(--small);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    width: 16px;
    height: 4px;
    border-radius: 2px;
    background: currentColor;
  }
  .key.dashed {
    background: repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 9px);
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
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
  .ln {
    fill: none;
    stroke-width: 2.4;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ln.dashed {
    stroke-dasharray: 6 5;
    stroke-width: 1.8;
  }
  @media (max-width: 600px) {
    .axis {
      font-size: 14px;
    }
  }
</style>
