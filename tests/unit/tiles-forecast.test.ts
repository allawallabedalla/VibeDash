import { describe, expect, it } from 'vitest';
import { demoSunForecast, sunToday } from '../../src/app/sun-forecast';
import { dayAheadForecasts, generateDemo } from '../../src/demo';

describe('forecast line in the sun tile (M9 honesty)', () => {
  const data = generateDemo();
  const fc = demoSunForecast(data)!;

  it("uses today's forecast made before the day began", () => {
    const today = dayAheadForecasts(data).find((f) => f.day === 'today')!;
    expect(today.createdAt).toBeLessThan(today.start);
  });

  it('never shows measured values and forecast in the same slot; forecast only from now', () => {
    const s = sunToday(data, fc);
    expect(s.values.length).toBe(s.forecast.length);
    s.values.forEach((v, i) => {
      if (v !== null) expect(s.forecast[i]).toBeNull();
    });
    expect(s.forecast.some((v) => v !== null)).toBe(true);
    // every forecast point carries its band, low ≤ value ≤ high
    s.forecast.forEach((v, i) => {
      if (v === null) return;
      expect(s.low[i]!).toBeLessThanOrEqual(v);
      expect(s.high[i]!).toBeGreaterThanOrEqual(v);
    });
  });
});
