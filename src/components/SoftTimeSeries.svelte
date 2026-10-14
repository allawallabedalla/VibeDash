<script lang="ts">
  /**
   * Soft time series (uPlot): actual line, a separate forecast line with its
   * band, and a period choice. The forecast is never glued onto the actual
   * line; gaps stay open.
   */
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  export interface SeriesData {
    /** UTC ms, ascending, shared by all arrays. */
    x: number[];
    actual: (number | null)[];
    forecast?: (number | null)[];
    low?: (number | null)[];
    high?: (number | null)[];
  }

  interface Props {
    data: SeriesData;
    periods: { id: string; label: string }[];
    period: string;
    labels: { actual: string; forecast: string; band: string; periods: string; empty?: string };
    color?: string;
    forecastColor?: string;
    unit: string;
    timeZone: string;
    locale: string;
    height?: number;
  }

  let {
    data,
    periods,
    period = $bindable(),
    labels,
    color = '--sun',
    forecastColor = '--text',
    unit,
    timeZone,
    locale,
    height = 220,
  }: Props = $props();

  let box: HTMLDivElement;
  let plot: uPlot | undefined;
  let themeTick = $state(0);

  const css = (name: string) => getComputedStyle(box).getPropertyValue(name).trim() || '#888';
  const alpha = (hex: string, a: number) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1]!, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const isEmpty = $derived(
    data.actual.every((v) => v === null) && (data.forecast ?? []).every((v) => v === null),
  );

  function build() {
    plot?.destroy();
    plot = undefined;
    if (isEmpty) return;
    const c = css(color);
    const fc = css(forecastColor);
    const muted = css('--muted');
    const line = css('--line');
    const fmtTime = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    });
    const fmtDay = new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short' });
    const spanDays = (data.x.at(-1)! - data.x[0]!) / 86_400_000;
    const axis = {
      stroke: muted,
      grid: { stroke: line, width: 1 },
      ticks: { show: false },
      font: '13px -apple-system, system-ui, sans-serif',
    };
    const spline = uPlot.paths.spline!();
    const hasFc = !!data.forecast;
    const few = data.x.length <= 31;

    const opts: uPlot.Options = {
      width: box.clientWidth,
      height,
      padding: [8, 4, 0, 0],
      legend: { show: false },
      cursor: { show: false },
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), timeZone),
      scales: { y: { range: (_u, min, max) => [Math.min(0, min), max * 1.08 || 1] } },
      axes: [
        {
          ...axis,
          grid: { show: false },
          space: 72,
          values: (_u, splits) =>
            splits.map((s) => (spanDays > 1.5 ? fmtDay.format(s * 1e3) : fmtTime.format(s * 1e3))),
        },
        {
          ...axis,
          size: 44,
          values: (_u, splits) => splits.map((s) => `${s.toLocaleString(locale)}`),
        },
      ],
      series: [
        {},
        {
          label: labels.actual,
          stroke: c,
          width: 2.25,
          paths: spline,
          spanGaps: false,
          points: { show: few, size: 7, fill: c },
        },
        ...(hasFc
          ? [
              { label: 'low', stroke: 'transparent', paths: spline, points: { show: false } },
              { label: 'high', stroke: 'transparent', paths: spline, points: { show: false } },
              {
                label: labels.forecast,
                stroke: alpha(fc, 0.75),
                width: 1.5,
                paths: spline,
                spanGaps: false,
                points: { show: false },
              },
            ]
          : []),
      ],
      bands: hasFc ? [{ series: [3, 2], fill: alpha(fc, 0.07) }] : [],
    };

    const xs = data.x.map((t) => t / 1e3);
    const rows: uPlot.AlignedData = hasFc
      ? [xs, data.actual, data.low ?? [], data.high ?? [], data.forecast ?? []]
      : [xs, data.actual];
    plot = new uPlot(opts, rows, box);
  }

  onMount(() => {
    const ro = new ResizeObserver(() => plot?.setSize({ width: box.clientWidth, height }));
    ro.observe(box);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => themeTick++;
    mq.addEventListener('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', bump);
      mo.disconnect();
      plot?.destroy();
    };
  });

  $effect(() => {
    void themeTick;
    void data;
    void isEmpty;
    void locale;
    build();
  });
</script>

<div class="ts">
  <div class="head">
    <div class="legend" aria-hidden="true">
      {#if data.actual.some((v) => v !== null)}
        <span><i class="l" style:background="var({color})"></i>{labels.actual}</span>
      {/if}
      {#if data.forecast}
        <span><i class="l thin" style:background="var({forecastColor})"></i>{labels.forecast}</span>
        <span><i class="b" style:background="var({forecastColor})"></i>{labels.band}</span>
      {/if}
      <span class="unit">{unit}</span>
    </div>
    <div class="seg" role="group" aria-label={labels.periods}>
      {#each periods as p (p.id)}
        <button type="button" aria-pressed={period === p.id} onclick={() => (period = p.id)}>
          {p.label}
        </button>
      {/each}
    </div>
  </div>
  {#if isEmpty}<p class="empty">{labels.empty ?? '–'}</p>{/if}
  <div
    class="plot"
    class:hidden={isEmpty}
    bind:this={box}
    role="img"
    aria-label={labels.actual}
  ></div>
</div>

<style>
  .ts {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px 16px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 14px;
    color: var(--muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .l {
    width: 16px;
    height: 3px;
    border-radius: 2px;
  }
  .l.thin {
    height: 2px;
    opacity: 0.75;
  }
  .b {
    width: 14px;
    height: 10px;
    border-radius: 3px;
    opacity: 0.18;
  }
  .unit {
    color: var(--faint);
  }
  .seg {
    display: flex;
    background: var(--surface-2);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .seg button {
    min-width: 56px;
    height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .plot {
    width: 100%;
    min-width: 0;
  }
  .plot.hidden {
    display: none;
  }
  .empty {
    margin: 24px 0;
    color: var(--muted);
    font-size: 14px;
  }
  @media (max-width: 600px) {
    .seg {
      width: 100%;
    }
    .seg button {
      flex: 1;
    }
  }
</style>
