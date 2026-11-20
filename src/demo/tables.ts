/**
 * Synthetic tables with a graphic column (Audit05 I-8) for the gallery: the
 * shapes a house module sends – a dot ± error per room (one not measurable,
 * drawn pale) and bars with a part. Made-up numbers, no real house.
 */
import type { Column, Row, TableChartSpec } from '../components/DataTable.svelte';

export interface DemoTable {
  title: string;
  columns: Column[];
  rows: Row[];
  chart: TableChartSpec;
}

const de = (v: number, d = 1) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
    .format(v)
    .replace('-', '−');
const pm = (v: number, e: number) => `${v > 0 ? '+' : ''}${de(v)} ± ${de(e)}`;

export function demoTables(): DemoTable[] {
  const rooms: [string, number, number, boolean][] = [
    ['Wohnen', 0.9, 0.3, true],
    ['Küche', 0.4, 0.2, true],
    ['Bad', 0.2, 0.4, false],
    ['Schlafen', -0.1, 0.2, false],
    ['Büro', 1.3, 0.5, true],
  ];
  const kinds: [string, number, number][] = [
    ['Flackern', 24, 9],
    ['Präsenz ohne Licht', 17, 4],
    ['Dauerhaft an', 6, 0],
    ['Schalt-Konflikt', 2, 1],
  ];
  return [
    {
      title: 'Sonne je Raum',
      columns: [
        { key: 'r', label: 'Raum' },
        { key: 'k', label: 'K/klarer Tag', align: 'right' },
        { key: 'm', label: 'messbar' },
      ],
      rows: rooms.map(([r, v, e, ok]) => ({
        id: r,
        cells: { r, k: pm(v, e), m: ok ? 'ja' : 'nein' },
        chart: { value: v, err: e, ...(ok ? {} : { faint: true }) },
      })),
      chart: { kind: 'dot', label: 'K/klarer Tag', color: 'var(--climate)' },
    },
    {
      title: 'Meldungen je Art',
      columns: [
        { key: 'a', label: 'Art' },
        { key: 'n', label: 'Anzahl', align: 'right' },
        { key: 'd', label: 'davon nachts', align: 'right' },
      ],
      rows: kinds.map(([a, n, d]) => ({
        id: a,
        cells: { a, n: String(n), d: String(d) },
        chart: { value: n, part: d },
      })),
      chart: { kind: 'bar', label: 'Anzahl, dunkel = nachts', partColor: 'var(--home)' },
    },
  ];
}
