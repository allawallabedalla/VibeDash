<script lang="ts">
  /**
   * This year against the years before, labelled on the lines themselves (no
   * legend): the current year strong, earlier years pale, a dot with the date
   * at the end of the current line. Lines are SVG, text is HTML so it keeps
   * its size on every screen.
   */
  import type { YearLine } from '../model/year';
  import { num } from '../i18n/index.svelte';

  interface Props {
    lines: YearLine[];
    color: string;
    /** the same hue dark enough for the year labels */
    textColor: string;
    /** "15.10." for the end dot */
    endLabel: string;
    startLabel: string;
    label: string;
  }
  let { lines, color, textColor, endLabel, startLabel, label }: Props = $props();

  const W = 366;
  const H = 100;
  const all = $derived(lines.flatMap((l) => l.values).filter((v): v is number => v !== null));
  const top = $derived(niceTop(Math.max(1, ...all)));
  const y = (v: number) => H - (v / top) * H;
  const cur = $derived(lines.at(-1));
  const earlier = $derived(lines.slice(0, -1));

  function niceTop(v: number): number {
    const p = 10 ** Math.floor(Math.log10(v));
    for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= v) return f * p;
    return 10 * p;
  }
  function path(values: (number | null)[]): string {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${i},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }
  // where to put an earlier year's label: its value a few weeks after the current end
  const at = (l: YearLine, from: number) => {
    for (let i = Math.min(365, from); i < 366; i++) if (l.values[i] !== null) return i;
    return l.lastIndex;
  };
</script>

<div class="chart" role="img" aria-label={label}>
  <div class="axis">
    <span>{num(top, top < 10 ? 1 : 0)}</span><span>{num(top / 2, top < 10 ? 1 : 0)}</span><span
      >0</span
    >
  </div>
  <div class="plot">
    <div class="area">
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} class="grid" />
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} class="base" />
        {#each earlier as l (l.year)}
          <path d={path(l.values)} class="line" stroke={color} opacity="0.35" />
        {/each}
        {#if cur}
          <path d={path(cur.values)} class="line strong" stroke={color} />
          <line x1={cur.lastIndex} x2={cur.lastIndex} y1="0" y2={H} class="now" />
        {/if}
      </svg>
      {#if cur}
        {@const v = cur.values[cur.lastIndex]!}
        <span
          class="dot"
          style:left="{(cur.lastIndex / W) * 100}%"
          style:top="{(y(v) / H) * 100}%"
          style:background={color}
        ></span>
        <span
          class="tag strong"
          style:left="{(Math.max(8, cur.lastIndex - 30) / W) * 100}%"
          style:top="calc({(y(v) / H) * 100}% - 22px)"
          style:color={textColor}>{cur.year}</span
        >
      {/if}
      {#each earlier as l (l.year)}
        {@const i = at(l, (cur?.lastIndex ?? 0) + 25)}
        {@const v = l.values[i]}
        {#if v !== null && v !== undefined}
          <span
            class="tag"
            style:left="{(Math.min(i, 330) / W) * 100}%"
            style:top="calc({(y(v) / H) * 100}% + 4px)"
            style:color={textColor}>{l.year}</span
          >
        {/if}
      {/each}
    </div>
    <div class="x">
      <span>{startLabel}</span>
      {#if cur}<span class="end" style:left="{(cur.lastIndex / W) * 100}%">{endLabel}</span>{/if}
    </div>
  </div>
</div>

<style>
  .chart {
    display: flex;
    gap: 6px;
    height: 150px;
  }
  .axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 36px;
    padding-bottom: 22px;
    text-align: right;
    font-size: var(--small);
    color: var(--muted);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .plot {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .area {
    position: relative;
    flex: 1;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    vector-effect: non-scaling-stroke;
  }
  .base {
    stroke: var(--faint);
    vector-effect: non-scaling-stroke;
  }
  .now {
    stroke: var(--line);
    vector-effect: non-scaling-stroke;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .line.strong {
    stroke-width: 2.6;
  }
  .dot {
    position: absolute;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
  }
  .tag {
    position: absolute;
    font-size: var(--small);
    white-space: nowrap;
  }
  .tag.strong {
    font-weight: 700;
    opacity: 1;
  }
  .x {
    position: relative;
    height: 22px;
    padding-top: 4px;
    font-size: var(--small);
    color: var(--muted);
  }
  .x .end {
    position: absolute;
    transform: translateX(-50%);
    color: var(--text-2);
  }
</style>
