/**
 * The lens of a bar chart (pure logic, loaded with BarLens.svelte on the first touch,
 * hover or focus): which bar lies under the pointer, how its label reads as a span
 * ("13:00–13:15"), what the box says. No drawing here – tests/unit/bar-lens.test.ts.
 */
import { lensDigits } from './lens';

/**
 * Index of the bar under x (CSS px from the grid's left edge): n equal columns of a grid
 * with `gap` px between them; a gap belongs half to each neighbour. −1 without bars.
 */
export function barIndex(x: number, width: number, n: number, gap = 0): number {
  if (n <= 0) return -1;
  const col = Math.max(0, (width - gap * (n - 1)) / n);
  const i = Math.floor((x + gap / 2) / (col + gap || 1));
  return Math.max(0, Math.min(n - 1, i));
}

/** Left edge and width of bar i in the same grid. */
export function barSpan(i: number, width: number, n: number, gap = 0) {
  const col = Math.max(0, (width - gap * (Math.max(1, n) - 1)) / Math.max(1, n));
  return { left: i * (col + gap), width: col };
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;
const HOUR = /^\d{1,2}$/;
const mins = (s: string | undefined) => {
  const m = s ? CLOCK.exec(s.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The label of bar i as the box shows it: a time of day with its end when the labels
 * are evenly spaced times ("13:00" → "13:00–13:15"), whole hours of a day ("13" →
 * "13:00–14:00"), anything else (a day, a weekday) as it is.
 */
export function barLabel(labels: string[], i: number): string {
  const lab = (labels[i] ?? '').trim();
  const start = mins(lab);
  if (start !== null) {
    // the step to a neighbour (forward over midnight too); unclear = the label alone
    const next = mins(labels[i + 1]);
    const prev = mins(labels[i - 1]);
    const step =
      next !== null
        ? (next - start + 1440) % 1440
        : prev !== null
          ? (start - prev + 1440) % 1440
          : 0;
    return step > 0 && step <= 180 ? `${clock(start)}–${clock(start + step)}` : lab;
  }
  if (
    HOUR.test(lab) &&
    labels.length >= 3 &&
    labels.every((l) => HOUR.test(l.trim()) && Number(l) < 24)
  ) {
    const h = Number(lab);
    return `${clock(h * 60)}–${clock(h * 60 + 60)}`;
  }
  return lab;
}

export interface BarRow {
  label?: string;
  color?: string;
  value: string;
  gap?: boolean;
  /** the mean line: drawn dashed in the box */
  mean?: boolean;
  /** the sum of stacked parts: bold, above its parts */
  total?: boolean;
}

export interface BarData {
  labels: string[];
  unit: string;
  /** one value per bar (DayBars) */
  values?: (number | null)[];
  /** stacked parts per bar with their names and colours (StackDayBars) */
  parts?: (number[] | null)[];
  names?: string[];
  colors?: string[];
  /** from–to per bar (DayRanges) */
  ranges?: ({ low: number; high: number } | null)[];
  /** the bar's own colour (one value per bar) */
  color?: string;
  /** index of the running day: "bis jetzt"; later bars "noch nicht" */
  partial?: number;
  mean?: number;
}

export interface BarTexts {
  noData: string;
  notYet: string;
  soFar: string;
  mean: string;
  total: string;
}

/** Decimals for the whole chart (G-28: at most 2, whole counts stay whole). */
export function barDigits(d: BarData): number {
  const all: (number | null)[] = [
    ...(d.values ?? []),
    ...(d.parts ?? []).flatMap((p) => p ?? []),
    ...(d.ranges ?? []).flatMap((r) => (r ? [r.low, r.high] : [])),
    ...(d.mean !== undefined ? [d.mean] : []),
  ];
  return lensDigits(all);
}

/**
 * The box of bar i: its label (with "bis jetzt" on the running day) and the value with
 * unit, a gap as "keine Daten" (after the running day "noch nicht"), stacked parts each
 * with the total first, a range as from–to, the mean as "Mittel x".
 */
export function barBox(
  i: number,
  d: BarData,
  num: (v: number, digits: number) => string,
  tx: BarTexts,
): { when: string; rows: BarRow[] } {
  const digits = barDigits(d);
  const u = d.unit ? ` ${d.unit}` : '';
  const f = (v: number) => `${num(v, digits)}${u}`;
  const label = barLabel(d.labels, i);
  const when = i === d.partial ? `${label} · ${tx.soFar}` : label;
  const gap = d.partial !== undefined && i > d.partial ? tx.notYet : tx.noData;
  const rows: BarRow[] = [];
  if (d.values) {
    const v = d.values[i] ?? null;
    rows.push(v === null ? { value: gap, gap: true } : { value: f(v), color: d.color });
  } else if (d.parts) {
    const p = d.parts[i] ?? null;
    if (!p) rows.push({ value: gap, gap: true });
    else {
      const sum = p.reduce((a, v) => a + Math.max(0, v), 0);
      rows.push({ label: tx.total, value: f(sum), total: true });
      p.forEach((v, k) => {
        if (v > 0) rows.push({ label: d.names?.[k] ?? '', color: d.colors?.[k], value: f(v) });
      });
    }
  } else if (d.ranges) {
    const r = d.ranges[i] ?? null;
    rows.push(
      r === null
        ? { value: gap, gap: true }
        : { value: `${num(r.low, digits)}–${num(r.high, digits)}${u}`, color: d.color },
    );
  }
  if (d.mean !== undefined) rows.push({ label: tx.mean, value: f(d.mean), mean: true });
  return { when, rows };
}

/** The whole box as one line, for the screen reader (aria-live). */
export function barText(box: { when: string; rows: BarRow[] }): string {
  return [box.when, ...box.rows.map((r) => (r.label ? `${r.label} ${r.value}` : r.value))].join(
    ' · ',
  );
}
