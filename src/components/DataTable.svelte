<script lang="ts" module>
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
  }
</script>

<script lang="ts">
  /** Calm table; only ever the second section below tiles. */
  let { columns, rows, caption }: { columns: Column[]; rows: Row[]; caption: string } = $props();
</script>

<div class="wrap">
  <table>
    <caption class="sr">{caption}</caption>
    <thead>
      <tr>
        {#each columns as c (c.key)}
          <th scope="col" class:right={c.align === 'right'} class:no-phone={c.phone === false}>
            {c.label}
          </th>
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
  }
</style>
