import { describe, expect, it } from 'vitest';
import {
  accuracy,
  checkForecasts,
  dayAheadForecasts,
  forecastHitDays,
  generateDemo,
  hitCounts,
  type HitDay,
} from '../../src/demo';

const demo = generateDemo();

describe('forecast day by day (Audit05 I-6)', () => {
  const fc = dayAheadForecasts(demo);

  it('counts with the same rule as the accuracy card', () => {
    const days = forecastHitDays(demo, fc, 60);
    const checks = checkForecasts(demo, fc, 'pv_energy');
    const c = hitCounts(days);
    expect(c.n).toBe(checks.length);
    expect(c.k).toBe(checks.filter((x) => x.correct).length);
    expect((c.k / c.n) * 100).toBeCloseTo(accuracy(checks).pct!);
  });

  it('has one entry per day up to today; today is not judged', () => {
    const days = forecastHitDays(demo, fc, 7);
    expect(days).toHaveLength(7);
    expect(days.at(-1)!.today).toBe(true);
    expect(days.at(-1)!.actual).toBeNull();
    expect(days.at(-1)!.correct).toBeNull();
    expect(days.at(-1)!.forecast).not.toBeNull();
    for (let i = 1; i < days.length; i++)
      expect(days[i]!.start).toBeGreaterThan(days[i - 1]!.start);
  });

  it('keeps days without a forecast as gaps', () => {
    const days = forecastHitDays(demo, fc, 30);
    const empty = days.filter((d) => d.forecast === null);
    expect(empty.length).toBeGreaterThan(0);
    for (const d of empty) expect(d.correct).toBeNull();
  });

  it('counts the P10–P90 span apart from the verdict', () => {
    const d = (o: Partial<HitDay>): HitDay => ({
      day: 'x',
      start: 0,
      forecast: 10,
      low: 5,
      high: 15,
      actual: 10,
      correct: true,
      today: false,
      ...o,
    });
    const c = hitCounts([
      d({}),
      d({ actual: 14, correct: false }), // outside ±20 %, inside the span
      d({ actual: 20, correct: false }),
      d({ low: null, high: null, actual: 10 }),
      d({ actual: null, correct: null }),
    ]);
    expect(c).toEqual({ k: 2, n: 4, inSpan: 2, nSpan: 3 });
  });
});
