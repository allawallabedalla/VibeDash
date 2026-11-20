/**
 * "On how many days did we need no grid?" (Audit05 I-3): the daily import
 * rows of the meter (/api/daily, already cleaned there: a drop or a day above
 * maxPerDay is null, a dip is dropped) laid out as a calendar, weeks × weekday.
 *
 * Days without a value stay "missing" (grey) – never 0 (ANLEITUNG section 6).
 * Over a gap of days the meter kept counting: if that whole amount is below the
 * threshold, every day in it was below it too (counted, marked "over gap");
 * otherwise those days stay missing.
 */
export type DailyRow = [number, number | null] | [number, null, number];

export type DayState = 'free' | 'grid' | 'missing';

export interface CalendarDay {
  /** local date YYYY-MM-DD */
  key: string;
  state: DayState;
  /** kWh from the grid; null if unknown (missing, or only known over a gap) */
  kwh: number | null;
  /** counted from the meter over a gap of days */
  overGap?: boolean;
  /** 0 = free, 1–4 = grid steps (see GRID_STEPS) */
  level: number;
}

/** Upper ends of the lilac steps in kWh (the last step is "more"). */
export const GRID_STEPS = [2, 5, 10] as const;
export const FREE_BELOW_KWH = 0.5;

export function levelOf(kwh: number, free = FREE_BELOW_KWH): number {
  if (kwh < free) return 0;
  const k = GRID_STEPS.findIndex((s) => kwh < s);
  return k < 0 ? GRID_STEPS.length + 1 : k + 1;
}

const DAY = 86_400_000;
/** YYYY-MM-DD of a UTC-noon timestamp; calendar arithmetic without time zones. */
const keyOf = (utcNoon: number) => new Date(utcNoon).toISOString().slice(0, 10);
const noonOf = (key: string) => Date.parse(`${key}T12:00:00Z`);

/**
 * One entry per calendar day from the first row's day to `lastKey` (normally
 * yesterday; the running day is left out). `dayKey(t)` gives the local date of
 * a row's time.
 */
export function calendarDays(
  rows: readonly DailyRow[],
  dayKey: (t: number) => string,
  lastKey: string,
  free = FREE_BELOW_KWH,
): CalendarDay[] {
  const byKey = new Map<string, CalendarDay>();
  let prevKey: string | null = null;
  for (const r of rows) {
    const key = dayKey(r[0]);
    if (key > lastKey) continue;
    if (r[1] !== null) {
      byKey.set(key, {
        key,
        state: r[1] < free ? 'free' : 'grid',
        kwh: r[1],
        level: levelOf(r[1], free),
      });
    } else if (r.length === 3 && prevKey && r[2] < free) {
      // the meter counted less than the threshold over the whole gap
      for (let t = noonOf(prevKey) + DAY; t <= noonOf(key); t += DAY) {
        const k = keyOf(t);
        if (!byKey.has(k))
          byKey.set(k, { key: k, state: 'free', kwh: null, overGap: true, level: 0 });
      }
    }
    prevKey = key;
  }
  const first = rows.length ? dayKey(rows[0]![0]) : null;
  if (!first || first > lastKey) return [];
  const out: CalendarDay[] = [];
  for (let t = noonOf(first); t <= noonOf(lastKey); t += DAY) {
    const k = keyOf(t);
    out.push(byKey.get(k) ?? { key: k, state: 'missing', kwh: null, level: -1 });
  }
  return out;
}

/** Days without grid, days with a known state, days without a value. */
export function calendarCounts(days: readonly CalendarDay[]): {
  free: number;
  known: number;
  missing: number;
} {
  const free = days.filter((d) => d.state === 'free').length;
  const missing = days.filter((d) => d.state === 'missing').length;
  return { free, known: days.length - missing, missing };
}

/** Monday = 0 … Sunday = 6 of a local date. */
export const weekdayOf = (key: string) => (new Date(noonOf(key)).getUTCDay() + 6) % 7;

/**
 * Columns of weeks (Monday first); each column has 7 places, null before the
 * first and after the last day. `month` marks the column where a month begins.
 */
export function calendarWeeks(
  days: readonly CalendarDay[],
): { days: (CalendarDay | null)[]; month: number | null }[] {
  if (!days.length) return [];
  const lead = weekdayOf(days[0]!.key);
  const cells: (CalendarDay | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const out: { days: (CalendarDay | null)[]; month: number | null }[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const firstOfMonth = week.find((d) => d && (d.key.endsWith('-01') || d === days[0]));
    out.push({ days: week, month: firstOfMonth ? Number(firstOfMonth.key.slice(5, 7)) : null });
  }
  return out;
}

/** At most the last `weeks` calendar weeks (Monday first), so a long history stays readable. */
export function lastWeeks(days: readonly CalendarDay[], weeks = 53): CalendarDay[] {
  if (!days.length) return [];
  const keep = (weeks - 1) * 7 + weekdayOf(days.at(-1)!.key) + 1;
  return days.slice(-keep);
}
