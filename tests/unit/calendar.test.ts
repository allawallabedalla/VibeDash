import { describe, expect, it } from 'vitest';
import {
  calendarCounts,
  calendarDays,
  calendarWeeks,
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

  it('over a gap the meter total decides: below 0.5 kWh all those days were free', () => {
    const rows: DailyRow[] = [
      [at('2026-03-02'), 1],
      [at('2026-03-05'), null, 0.3], // three days, 0.3 kWh in total
      [at('2026-03-08'), null, 4], // three days, 4 kWh: unknown per day
    ];
    const days = calendarDays(rows, key, '2026-03-08');
    expect(days.map((d) => d.state)).toEqual([
      'grid',
      'free',
      'free',
      'free',
      'missing',
      'missing',
      'missing',
    ]);
    expect(days[1]!.overGap).toBe(true);
    expect(days[1]!.kwh).toBeNull();
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
