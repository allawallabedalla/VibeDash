import { describe, expect, it } from 'vitest';
import { sensorHighLow } from '../../src/app/weather-days';
import { generateDemo, type DemoData } from '../../src/demo';
import { readSky, solarElevation } from '../../src/model/sky';
import { addDays, localMidnight } from '../../src/model/time';

const H = 3_600_000;
const M = 60_000;

describe('own weather report for past days', () => {
  const demo = generateDemo();
  const yesterday = addDays(localMidnight(demo.now, demo.timeZone), -1, demo.timeZone);
  const end = addDays(yesterday, 1, demo.timeZone);

  it('takes high and low from the outdoor sensor only if it covered the day', () => {
    const at = (h: number, v: number) => ({ t: yesterday + h * H, v });
    const withSensor = (samples: { t: number; v: number }[]): DemoData => ({
      ...demo,
      series: { ...demo.series, outdoor_temp: { entityId: 'o', source: 't', stepMs: H, samples } },
    });
    const full = [at(1, 6), at(5, 4.5), at(9, 9), at(13, 15.2), at(16, 14), at(20, 10)];
    expect(sensorHighLow(withSensor(full), yesterday, end)).toEqual({ high: 15.2, low: 4.5 });
    expect(sensorHighLow(withSensor(full.slice(0, 3)), yesterday, end)).toBeNull();
    expect(sensorHighLow(demo, yesterday, end)).toBeNull();
  });
});

describe('sky from the PV curve (ideal curve over the actual one)', () => {
  const D = 24 * H;
  const days = Array.from({ length: 15 }, (_, i) => i * D);
  // a clear-day bell from 07 to 17 h, 10 kW at noon
  const bell = (t: number) => {
    const h = (t % D) / H;
    return h < 7 || h > 17 ? 0 : 10_000 * Math.sin(((h - 7) / 10) * Math.PI);
  };
  const series = (last: (t: number, v: number) => number) => {
    const out = [];
    for (let t = 0; t < 15 * D; t += 5 * M) {
      const v = bell(t);
      out.push({ t, v: t >= 14 * D ? last(t, v) : v });
    }
    return out;
  };
  it('reads a clear day, single clouds, haze and an overcast day', () => {
    expect(
      readSky(
        series((_, v) => v),
        days,
        null,
      )!.sky,
    ).toBe('clear');
    const clouds = readSky(
      series((t, v) => (Math.floor((t % D) / (40 * M)) % 3 === 0 ? v * 0.2 : v)),
      days,
      null,
    )!;
    expect(clouds.sky).toBe('clouds');
    expect(clouds.dips).toBeGreaterThanOrEqual(2);
    expect(
      readSky(
        series((_, v) => v * 0.6),
        days,
        null,
      )!.sky,
    ).toBe('hazy');
    const grey = readSky(
      series((_, v) => v * 0.2),
      days,
      null,
    )!;
    expect(grey.sky).toBe('overcast');
    expect(grey.sunHours).toBe(0);
  });

  it('knows where the sun is (noon in summer, high; midnight, below)', () => {
    expect(solarElevation(Date.UTC(2026, 5, 21, 11, 20), 50.5, 9.7)).toBeGreaterThan(60);
    expect(solarElevation(Date.UTC(2026, 5, 21, 23, 20), 50.5, 9.7)).toBeLessThan(0);
  });
});
