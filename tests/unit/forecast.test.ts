import { describe, expect, it } from 'vitest';
import {
  accuracy,
  checkForecasts,
  completeDays,
  dayAheadForecasts,
  generateDemo,
  mulberry32,
  outlook,
  powerCurve,
  sourcesAt,
} from '../../src/demo';

const demo = generateDemo();
const DAY = 86_400_000;

describe('day-ahead forecast', () => {
  const forecasts = dayAheadForecasts(demo);

  it('is made before the day starts, with equal lead time for all', () => {
    for (const f of forecasts) {
      expect(f.createdAt).toBeLessThan(f.start);
      expect(f.start - f.createdAt).toBe(4 * 3_600_000);
    }
  });

  it('never uses data from the forecast day or later', () => {
    // Changing the actual yield of a day must not change its own forecast.
    const days = completeDays(demo, 'pv_energy');
    const target = forecasts.find((f) => f.day === days[20]!.day)!;
    const altered = generateDemo();
    const pv = altered.series.pv_energy!.samples;
    for (const s of pv) if (s.t >= target.start) s.v += 1000;
    const again = dayAheadForecasts(altered).find((f) => f.day === target.day)!;
    expect(again.energy).toEqual(target.energy);
  });

  it('includes today and tomorrow, with range and n', () => {
    const tomorrow = forecasts.find((f) => f.day === 'tomorrow')!;
    expect(tomorrow.energy.n).toBe(7);
    expect(tomorrow.energy.low).toBeLessThanOrEqual(tomorrow.energy.value);
    expect(tomorrow.energy.high).toBeGreaterThanOrEqual(tomorrow.energy.value);
  });

  it('power curve covers one day and is zero at night', () => {
    const curve = powerCurve(forecasts.at(-1)!, demo.timeZone);
    expect(curve).toHaveLength(96);
    expect(curve[0]!.value).toBe(0);
    expect(curve.at(-1)!.at - curve[0]!.at).toBeLessThan(DAY);
  });
});

describe('evaluation', () => {
  const checks = checkForecasts(demo);

  it('checks against the meter, not against the forecast itself', () => {
    const actual = new Map(completeDays(demo, 'pv_energy').map((d) => [d.day, d.value]));
    for (const c of checks) expect(c.actual).toBe(actual.get(c.day));
  });

  it('reports open (null) while too few days, never a fake 100 %', () => {
    const early = accuracy(checks.slice(0, 3));
    expect(early.pct).toBeNull();
    expect(early.n).toBe(3);
    const full = accuracy(checks);
    expect(full.pct).not.toBeNull();
    expect(full.history.slice(0, 6).every((v) => v === null)).toBe(true);
  });
});

describe('outlook and sources', () => {
  it('outlook gives 7 days, each with a range and n', () => {
    const days = outlook(demo, mulberry32(7));
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.tempLow).toBeLessThan(d.tempHigh);
      expect(d.energy.n).toBeGreaterThan(0);
    }
  });

  it('sources add up to the house load', () => {
    const s = sourcesAt(demo, demo.now - 60_000)!;
    expect(s.sun + s.battery + s.grid).toBeCloseTo(s.total);
  });

  it('returns null inside a sensor gap instead of a stale value', () => {
    const gap = demo.issues.find((i) => i.entityIds.includes('pv_power'))!;
    expect(sourcesAt(demo, gap.from + 60 * 60_000)).toBeNull();
  });
});

describe('pvTimeSeries', () => {
  it('month view: daily kWh from the meter, today without actual', async () => {
    const { pvTimeSeries } = await import('../../src/demo');
    const s = pvTimeSeries(demo, 'month');
    expect(s.unit).toBe('kWh');
    expect(s.x).toHaveLength(30);
    expect(s.actual.at(-1)).toBeNull();
    expect(s.forecast.at(-1)).not.toBeNull();
    const days = completeDays(demo, 'pv_energy');
    expect(s.actual.at(-2)).toBe(days.at(-1)!.value);
  });

  it('day view: no actual after now', async () => {
    const { pvTimeSeries } = await import('../../src/demo');
    const s = pvTimeSeries(demo, 'day');
    s.x.forEach((t, i) => {
      if (t >= demo.now) expect(s.actual[i]).toBeNull();
    });
  });
});
