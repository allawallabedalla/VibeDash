/**
 * The lens of a line chart (pure logic, loaded with Lens.svelte on the first touch,
 * hover or focus): which point lies under the pointer, how many decimals, what the
 * box says. No drawing here – tests/unit/lens.test.ts checks it without a page.
 */

export interface LensSeries {
  label: string;
  color: string;
  values: (number | null)[];
  /** "actual" and "forecast": a box row each, plus actual − forecast where both have a value */
  kind?: 'actual' | 'forecast' | 'band';
  /** the forecast's (or a band's) range on the same slots */
  low?: (number | null)[];
  high?: (number | null)[];
  dashed?: boolean;
}

export interface LensRow {
  label: string;
  color: string;
  /** the value with unit, or "keine Daten" */
  value: string;
  /** the range behind the value, e.g. "(1,9–3,6)" */
  range?: string;
  dashed?: boolean;
  gap?: boolean;
  diff?: boolean;
}

export interface LensTexts {
  noData: string;
  diff: string;
}

/** Index of the x position nearest to px (xs ascending); −1 without points. */
export function nearestIndex(xs: number[], px: number): number {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < px) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo]! - px) <= Math.abs(xs[hi]! - px) ? lo : hi;
}

/**
 * Decimals for a value in the box (G-28): never fewer than the axis, at most 2;
 * whole counts stay whole, a span below 20 gets one decimal, below 0.2 two.
 */
export function lensDigits(values: (number | null)[], axisDigits = 0): number {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return Math.min(2, axisDigits);
  if (v.every((x) => Number.isInteger(x))) return Math.min(2, axisDigits);
  const span = Math.max(...v) - Math.min(...v) || Math.abs(v[0]!);
  const own = span < 0.2 ? 2 : span < 20 ? 1 : 0;
  return Math.min(2, Math.max(axisDigits, own));
}

/**
 * The time of a point in the house's time zone: the date for daily values, weekday,
 * date and time over more than a day and a half, else the time of day.
 */
export function lensTime(
  t: number,
  timeZone: string,
  stepMs: number,
  spanMs: number,
  locale = 'de-DE',
): string {
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...o }).format(t);
  if (stepMs >= 20 * 3_600_000) return f({ weekday: 'short', day: 'numeric', month: 'numeric' });
  const clock = f({ hour: '2-digit', minute: '2-digit' });
  if (spanMs > 36 * 3_600_000)
    return `${f({ weekday: 'short', day: 'numeric', month: 'numeric' })} ${clock}`;
  return clock;
}

/** The middle step between points (robust against single gaps). */
export function medianStep(times: number[]): number {
  const d = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .sort((a, b) => a - b);
  return d.length ? d[d.length >> 1]! : 0;
}

/** "+0,4" / "−0,4" / "0,0": a difference always says its direction. */
export function signed(text: string): string {
  return /^[−-]/.test(text) || !/[1-9]/.test(text) ? text : `+${text}`;
}

export interface LensFormat {
  /** a value with its unit, "3,2 kW" (or a state's name) */
  value: (v: number) => string;
  /** a range without unit, "1,9–3,6" */
  range: (lo: number, hi: number) => string;
  /** a difference with unit, "0,4 kW" (the sign is added here) */
  diff: (v: number) => string;
  /** unit after a band's range, " kW" */
  unit: string;
}

/**
 * The rows of the box at index i: each line with its value and unit, a forecast with
 * its range, and actual − forecast where both exist. A missing value is "keine Daten";
 * an actual line in the future (after "now") and a forecast that does not reach here
 * have no row.
 */
export function lensRows(
  i: number,
  series: LensSeries[],
  f: LensFormat,
  tx: LensTexts,
  future = false,
): LensRow[] {
  const rows: LensRow[] = [];
  let actual: number | null = null;
  let forecast: number | null = null;
  for (const s of series) {
    const v = s.values[i] ?? null;
    const lo = s.low?.[i] ?? null;
    const hi = s.high?.[i] ?? null;
    const range = lo !== null && hi !== null ? f.range(Math.min(lo, hi), Math.max(lo, hi)) : '';
    if (s.kind === 'band') {
      if (range) rows.push({ label: s.label, color: s.color, value: range + f.unit, dashed: true });
      continue;
    }
    if (v === null) {
      if ((s.kind === 'actual' && future) || s.kind === 'forecast') continue;
      rows.push({ label: s.label, color: s.color, value: tx.noData, gap: true, dashed: s.dashed });
      continue;
    }
    if (s.kind === 'actual' && actual === null) actual = v;
    if (s.kind === 'forecast' && forecast === null) forecast = v;
    rows.push({
      label: s.label,
      color: s.color,
      value: f.value(v),
      ...(range ? { range: `(${range})` } : {}),
      dashed: s.dashed ?? s.kind === 'forecast',
    });
  }
  if (actual !== null && forecast !== null)
    rows.push({ label: tx.diff, color: '', value: signed(f.diff(actual - forecast)), diff: true });
  return rows;
}

/** The whole box as one line, for the screen reader (aria-live). */
export function lensText(time: string, rows: LensRow[], noData: string): string {
  if (!rows.length || rows.every((r) => r.gap)) return `${time} · ${noData}`;
  return [time, ...rows.map((r) => `${r.label} ${r.value}${r.range ? ` ${r.range}` : ''}`)].join(
    ' · ',
  );
}
