import { describe, expect, it } from 'vitest';
import {
  accuracy,
  checkForecasts,
  completeDays,
  dayAheadForecasts,
  generateDemo,
  hourlyPvForecast,
  pvTimeSeries,
  mulberry32,
  outlook,
  powerCurve,
  sourcesAt,
} from '../../src/demo';

const demo = generateDemo();
const DAY = 86_400_000;

describe('day-ahead forecast', () => {
  const forecasts = dayAheadForecasts(demo);

  it('is made before the day starts, with equal lead time for all evaluated days', () => {
    for (const f of forecasts) {
      expect(f.createdAt).toBeLessThan(f.start);
      expect(f.createdAt).toBeLessThanOrEqual(demo.now);
      if (f.day !== 'tomorrow') expect(f.start - f.createdAt).toBe(4 * 3_600_000);
    }
  });

  it('consumption model follows the same rules', async () => {
    const { dayAheadLoad } = await import('../../src/demo');
    const load = dayAheadLoad(demo);
    for (const f of load) {
      expect(f.createdAt).toBeLessThan(f.start);
      expect(f.energy.n).toBe(7);
    }
    expect(checkForecasts(demo, load, 'load_energy').length).toBe(21);
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

describe('hourly PV forecast of the house', () => {
  it('draws through the hour middles and keeps a missing hour as a gap', () => {
    const H = 3_600_000;
    const demo = generateDemo();
    const day = Math.floor(demo.now / (24 * H)) * 24 * H;
    const data = {
      ...demo,
      entities: [
        ...demo.entities,
        {
          id: 'pv_forecast',
          name: 'PV forecast',
          kind: 'power' as const,
          unit: 'kW',
          confirmed: true,
        },
      ],
      series: {
        ...demo.series,
        pv_forecast: {
          entityId: 'pv_forecast',
          source: 'test',
          stepMs: H,
          samples: [
            { t: day + 10 * H, v: 2 },
            { t: day + 11 * H, v: 4 },
            { t: day + 13 * H, v: 6 },
          ],
        },
      },
    };
    const x = [10.5, 11, 11.5, 12.5].map((h) => day + h * H);
    const f = hourlyPvForecast(data, x)!;
    expect(f.value[0]).toBeCloseTo(2);
    expect(f.value[1]).toBeCloseTo(3);
    expect(f.value[2]).toBeCloseTo(4);
    expect(f.value[3]).toBeNull();
    expect(f.low.every((v) => v === null)).toBe(true);
  });

  it('is absent without such a series', () => {
    expect(hourlyPvForecast(generateDemo(), [0, 1])).toBeNull();
  });
});

describe('three days back to three days ahead (span)', () => {
  it('is hourly over seven days and has actual values only for past hours', () => {
    const demo = generateDemo();
    const s = pvTimeSeries(demo, 'span');
    expect(s.unit).toBe('kW');
    expect(s.x.length).toBeGreaterThanOrEqual(7 * 24 - 1);
    expect(s.x.length).toBeLessThanOrEqual(7 * 24 + 1);
    s.x.forEach((t, i) => {
      if (t + 3_600_000 > demo.now) expect(s.actual[i]).toBeNull();
    });
    expect(s.forecast.some((v) => v !== null)).toBe(true);
  });
});

describe("the house's own day-ahead forecast", () => {
  it('is judged instead of the rule when the house has one (G-13)', async () => {
    const { houseDayForecasts } = await import('../../src/app/houseForecast');
    const { localMidnight } = await import('../../src/model/time');
    const days = completeDays(demo, 'pv_energy').slice(-5);
    const series = (k: number) =>
      days.map((d) => {
        const t = localMidnight(Date.parse(d.day + 'T12:00:00Z'), demo.timeZone);
        return { t, v: d.value * k };
      });
    const data = {
      ...demo,
      series: {
        ...demo.series,
        pv_forecast_day: { id: 'pv_forecast_day', samples: series(1) },
        pv_forecast_day_low: { id: 'pv_forecast_day_low', samples: series(0.8) },
        pv_forecast_day_high: { id: 'pv_forecast_day_high', samples: series(1.2) },
      },
    } as unknown as typeof demo;
    const own = houseDayForecasts(data);
    expect(own.map((f) => f.day)).toEqual(days.map((d) => d.day));
    expect(own[0]!.energy.low).toBeCloseTo(days[0]!.value * 0.8);
    // a perfect house forecast is judged perfect – the rule would not be
    const checks = checkForecasts(data, own, 'pv_energy');
    expect(checks.length).toBe(5);
    expect(checks.every((c) => c.correct)).toBe(true);
    expect(houseDayForecasts(demo)).toEqual([]);
  });
});
