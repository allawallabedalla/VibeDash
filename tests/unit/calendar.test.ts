import { describe, expect, it } from 'vitest';
import {
  calendarCounts,
  calendarDays,
  calendarWeeks,
  daysWithHoles,
  lastWeeks,
  levelOf,
  type DailyRow,
} from '../../src/model/calendar';

const DAY = 86_400_000;
// rows at UTC noon; the day key is the ISO date
const at = (key: string) => Date.parse(`${key}T12:00:00Z`);
const key = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('calendar of days without grid (Audit05 I-3)', () => {
  it('green below 0.5 kWh, lilac steps above, missing days grey – never 0', () => {
    const rows: DailyRow[] = [
      [at('2026-03-02'), 0.2],
      [at('2026-03-03'), 3.1],
      [at('2026-03-04'), null], // meter jump → null on the server
      // 2026-03-05 has no row at all
      [at('2026-03-06'), 12],
    ];
    const days = calendarDays(rows, key, '2026-03-06');
    expect(days.map((d) => d.state)).toEqual(['free', 'grid', 'missing', 'missing', 'grid']);
    expect(days[2]!.kwh).toBeNull();
    expect(calendarCounts(days)).toEqual({ free: 1, known: 3, missing: 2 });
    expect(days.map((d) => d.level)).toEqual([0, 2, -1, -1, 4]);
  });

  it('a gap of whole days stays unknown, even with a small meter total', () => {
    const rows: DailyRow[] = [
      [at('2026-03-02'), 1],
      [at('2026-03-05'), null, 0.3], // three days without readings, 0.3 kWh in total
    ];
    const days = calendarDays(rows, key, '2026-03-05');
    expect(days.map((d) => d.state)).toEqual(['grid', 'missing', 'missing', 'missing']);
    expect(calendarCounts(days)).toEqual({ free: 0, known: 1, missing: 3 });
  });

  it('a day with a silent meter is never "without grid"; with ≥ 0.5 kWh it is grid (lower bound)', () => {
    const rows: DailyRow[] = [
      [at('2026-03-02'), 0.1],
      [at('2026-03-03'), 0.1], // hole that day
      [at('2026-03-04'), 2.4], // hole too, but grid for sure
    ];
    const days = calendarDays(rows, key, '2026-03-04', new Set(['2026-03-03', '2026-03-04']));
    expect(days.map((d) => d.state)).toEqual(['free', 'missing', 'grid']);
    expect(days[1]!.hole).toBe(true);
    expect(days[2]!.hole).toBe(true);
    expect(calendarCounts(days)).toEqual({ free: 1, known: 2, missing: 1 });
  });

  it('hole days from readings per hour: ≥ 2 empty hours, or no reading at a day boundary', () => {
    const H = 3_600_000;
    const hours = (day: string, empty: number[]) =>
      Array.from({ length: 24 }, (_, h) => ({
        t: Date.parse(`${day}T00:00:00Z`) + h * H,
        v: empty.includes(h) ? 0 : 60,
      }));
    const hourly = [
      ...hours('2026-03-01', [3]), // one empty hour: still clean
      ...hours('2026-03-02', [10, 11]), // two empty hours: hole
      ...hours('2026-03-03', [23]), // no reading at the end of the day
      ...hours('2026-03-04', []), // its start boundary is missing → hole too
      ...hours('2026-03-05', []),
    ];
    expect(daysWithHoles(hourly, key)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
  });

  it('the running day is left out', () => {
    const rows: DailyRow[] = [
      [at('2026-03-02'), 0],
      [at('2026-03-03'), 0],
    ];
    expect(calendarDays(rows, key, '2026-03-02')).toHaveLength(1);
  });

  it('levels', () => {
    expect([0, 0.49, 0.5, 1.9, 2, 5, 9.9, 10, 30].map((v) => levelOf(v))).toEqual([
      0, 0, 1, 1, 2, 3, 3, 4, 4,
    ]);
  });

  it('weeks start on Monday; month marks where a month begins', () => {
    // 2026-03-27 is a Friday
    const rows: DailyRow[] = Array.from({ length: 10 }, (_, i) => [at('2026-03-27') + i * DAY, 0]);
    const w = calendarWeeks(calendarDays(rows, key, '2026-04-05'));
    expect(w).toHaveLength(2);
    expect(w[0]!.days.slice(0, 4)).toEqual([null, null, null, null]);
    expect(w[0]!.days[4]!.key).toBe('2026-03-27');
    expect(w[0]!.month).toBe(3);
    expect(w[1]!.month).toBe(4);
    expect(w[1]!.days[6]!.key).toBe('2026-04-05');
  });

  it('a long history: only the last 53 weeks, beginning on a Monday', () => {
    const rows: DailyRow[] = Array.from({ length: 800 }, (_, i) => [at('2024-01-01') + i * DAY, 1]);
    const days = calendarDays(rows, key, key(at('2024-01-01') + 799 * DAY));
    const last = lastWeeks(days);
    expect(calendarWeeks(last)).toHaveLength(53);
    expect(new Date(at(last[0]!.key)).getUTCDay()).toBe(1);
  });
});
