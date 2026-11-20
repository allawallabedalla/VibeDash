<script lang="ts" module>
  import type { TableChartCell } from '../model/board';
  export interface Column {
    key: string;
    label: string;
    align?: 'left' | 'right';
    /** Hidden on the phone to keep the table readable at 390 px. */
    phone?: boolean;
  }
  export interface Row {
    id: string;
    cells: Record<string, string>;
    /** Short muted note under the first cell, e.g. a data gap. */
    note?: string;
    /** this row's value in the graphic column */
    chart?: TableChartCell;
  }
  /** Graphic column (Audit05 I-8, G-04): bar or dot ± error per row, one shared scale. */
  export interface TableChartSpec {
    kind: 'bar' | 'dot';
    label: string;
    unit?: string;
    min?: number;
    max?: number;
    /** CSS colour of the marks; part = the share drawn in partColor */
    color?: string;
    partColor?: string;
  }
</script>

<script lang="ts">
  /** Calm table; only ever the second section below tiles. */
  import { num } from '../i18n/index.svelte';
  import { chartPos, chartScale } from '../model/tableChart';

  let {
    columns,
    rows,
    caption,
    chart,
  }: { columns: Column[]; rows: Row[]; caption: string; chart?: TableChartSpec } = $props();

  const scale = $derived(
    chart
      ? chartScale(
          rows.map((r) => r.chart),
          { min: chart.min, max: chart.max },
        )
      : null,
  );
  const fmt = (v: number) => {
    const a = Math.abs(v);
    return num(v, a > 0 && a < 1 ? 2 : a < 10 && a % 1 ? 1 : 0);
  };
  /** left edge and width (percent) of a stretch between two values */
  const span = (a: number, b: number) => {
    const x = chartPos(Math.min(a, b), scale!);
    return { left: x, width: chartPos(Math.max(a, b), scale!) - x };
  };
</script>

{#snippet graphic(c: TableChartCell | undefined)}
  {@const s = scale!}
  <div class="g" class:faint={c?.faint} style:--c={chart!.color ?? 'var(--text-2)'}>
    <i class="zero" style:left="{chartPos(0, s)}%"></i>
    {#if c && c.value !== null}
      {#if chart!.kind === 'bar'}
        {@const b = span(0, c.value)}
        <i class="bar" style:left="{b.left}%" style:width="max(2px, {b.width}%)"></i>
        {#if c.part}
          {@const p = span(0, c.part)}
          <i
            class="bar part"
            style:left="{p.left}%"
            style:width="max(2px, {p.width}%)"
            style:background={chart!.partColor ?? 'var(--import)'}
          ></i>
        {/if}
      {:else}
        {#if c.err}
          {@const e = span(c.value - c.err, c.value + c.err)}
          <i class="err" style:left="{e.left}%" style:width="{e.width}%"></i>
        {/if}
        <i class="dot" style:left="{chartPos(c.value, s)}%"></i>
      {/if}
    {/if}
  </div>
{/snippet}

<div class="wrap">
  <table>
    <caption class="sr">{caption}</caption>
    <thead>
      <tr>
        {#each columns as c, i (c.key)}
          <th scope="col" class:right={c.align === 'right'} class:no-phone={c.phone === false}>
            {c.label}
          </th>
          {#if i === 0 && chart && scale}
            <th scope="col" class="gcol">
              {chart.label}{chart.unit ? `, ${chart.unit}` : ''}
              <span class="scale" aria-hidden="true"
                ><span>{fmt(scale.lo)}</span><span>{fmt(scale.hi)}</span></span
              >
            </th>
          {/if}
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr>
          {#each columns as c, i (c.key)}
            <td class:right={c.align === 'right'} class:no-phone={c.phone === false}>
              {r.cells[c.key] ?? ''}
              {#if i === 0 && r.note}<span class="note">{r.note}</span>{/if}
            </td>
            {#if i === 0 && chart && scale}<td class="gcol">{@render graphic(r.chart)}</td>{/if}
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    font-size: 15px;
  }
  th {
    font-weight: 500;
    font-size: var(--small);
    color: var(--muted);
    text-align: left;
    padding: 0 8px 8px;
    white-space: nowrap;
  }
  td {
    padding: 10px 8px;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  .right {
    text-align: right;
  }
  .note {
    display: block;
    font-size: var(--small);
    color: var(--muted);
  }
  .gcol {
    width: 32%;
    min-width: 88px;
  }
  .scale {
    display: flex;
    justify-content: space-between;
    font-variant-numeric: tabular-nums;
    font-weight: 400;
  }
  .g {
    position: relative;
    height: 20px;
  }
  .g i {
    position: absolute;
    display: block;
  }
  .g.faint {
    opacity: 0.35;
  }
  .zero {
    top: -4px;
    bottom: -4px;
    width: 1px;
    background: var(--line);
  }
  .bar {
    top: 5px;
    height: 10px;
    border-radius: 3px;
    background: var(--c);
  }
  .err {
    top: 9px;
    height: 2px;
    background: var(--c);
    opacity: 0.55;
  }
  .dot {
    top: 4px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--c);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @media (max-width: 600px) {
    .no-phone {
      display: none;
    }
    /* number columns stay narrow: their heading may take two lines */
    th.right {
      white-space: normal;
    }
    th,
    td {
      padding-left: 5px;
      padding-right: 5px;
    }
    /* long words in the first column (names) may break with a hyphen instead of widening the table */
    td:first-child {
      hyphens: auto;
      overflow-wrap: anywhere;
    }
    table {
      font-size: 14px;
    }
    .gcol {
      width: 28%;
      min-width: 72px;
    }
    th.gcol {
      white-space: normal;
    }
  }
</style>
