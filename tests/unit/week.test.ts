import { describe, expect, it } from 'vitest';
import { integrateSplit, nightMean, rangePerDay, weekDays, weekNumbers } from '../../src/app/week';
import { generateDemo } from '../../src/demo';

const H = 3_600_000;

describe('week numbers', () => {
  it('splits energy into charge and discharge and does not bridge gaps', () => {
    const s = [
      { t: 0, v: 1000 },
      { t: H, v: 1000 },
      { t: 2 * H, v: -500 },
      { t: 3 * H, v: -500 },
      { t: 10 * H, v: -500 },
    ];
    const e = integrateSplit(s, 0, 10 * H, 2 * H);
    expect(e.pos).toBeCloseTo(1.25);
    expect(e.neg).toBeCloseTo(0.5);
  });

  it('gives lowest–highest and the night mean per day', () => {
    const days = [{ start: 0 }, { start: 24 * H }];
    const s = [
      { t: H, v: 40 },
      { t: 2 * H, v: 80 },
      { t: 10 * H, v: 60 },
    ];
    expect(rangePerDay(s, days)).toEqual([{ low: 40, high: 80 }, null]);
    expect(nightMean(s, days)).toEqual([60, null]);
  });

  it('covers seven local days ending today, on the demo household', () => {
    const demo = generateDemo();
    const d = weekDays(demo);
    expect(d).toHaveLength(7);
    expect(new Set(d.map((x) => x.day)).size).toBe(7);
    const w = weekNumbers(demo);
    expect(w.total.pv).toBeGreaterThan(0);
    expect(w.autarky).toBeGreaterThanOrEqual(0);
    expect(w.autarky).toBeLessThanOrEqual(1);
    expect(w.battery!.charged).toBeGreaterThan(0);
    // sums over seven completed days; today is apart and not among them
    expect(w.days).toHaveLength(7);
    expect(w.days.map((x) => x.day)).not.toContain(w.today.day);
    expect(w.days.at(-1)!.start).toBeLessThan(w.today.start);
  });
});
