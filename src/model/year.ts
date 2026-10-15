/**
 * Daily values arranged by year for a "this year against last year" chart:
 * per calendar year the days 1.1.–31.12. (local), smoothed over the last
 * seven days so a single cloudy day does not dominate.
 */
import { localDateKey } from './time';

export interface YearLine {
  year: number;
  /** index = day of year (0 = 1 Jan), value = 7-day mean or null */
  values: (number | null)[];
  /** last day with a value (index) */
  lastIndex: number;
}

const DAY = 86_400_000;

function dayOfYear(key: string): { year: number; index: number } {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return { year: y, index: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY) };
}

export function yearLines(
  rows: readonly [number, number | null][],
  timeZone: string,
  window = 7,
): YearLine[] {
  const byYear = new Map<number, (number | null)[]>();
  for (const [t, v] of rows) {
    const { year, index } = dayOfYear(localDateKey(t + 12 * 3_600_000, timeZone));
    if (!byYear.has(year)) byYear.set(year, new Array<number | null>(366).fill(null));
    byYear.get(year)![index] = v;
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, raw]) => {
      const values = raw.map((_, i) => {
        const w = raw
          .slice(Math.max(0, i - window + 1), i + 1)
          .filter((x): x is number => x !== null);
        // at least half of the window known, else a gap
        return raw[i] === null || w.length < Math.ceil(window / 2)
          ? null
          : w.reduce((s, x) => s + x, 0) / w.length;
      });
      let lastIndex = -1;
      values.forEach((v, i) => v !== null && (lastIndex = i));
      return { year, values, lastIndex };
    })
    .filter((l) => l.lastIndex >= 0);
}
