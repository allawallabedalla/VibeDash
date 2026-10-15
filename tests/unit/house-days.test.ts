import { describe, expect, it } from 'vitest';
import { generateDemo, pvTimeSeries } from '../../src/demo';
import { addDays, localMidnight } from '../../src/model/time';

const H = 3_600_000;

describe('sun curve over days: the house forecast, not the rule of thumb', () => {
  it('sums an hourly forecast per day (≥ 20 hours), recomputed days on their own line', () => {
    const d = generateDemo();
    const today = localMidnight(d.now, d.timeZone);
    const hours = (start: number, n: number, kw: number) =>
      Array.from({ length: n }, (_, h) => ({ t: start + h * H, v: kw }));
    const yesterday = addDays(today, -1, d.timeZone);
    const before = addDays(today, -2, d.timeZone);
    const three = addDays(today, -3, d.timeZone);
    const ent = (id: string) => ({ id, name: id, kind: 'power' as const, unit: 'kW' });
    d.entities.push(ent('pv_forecast'), ent('pv_forecast_recomputed'));
    d.series.pv_forecast = {
      entityId: 'pv_forecast',
      source: 't',
      stepMs: H,
      samples: [...hours(yesterday, 24, 2), ...hours(three, 10, 2)],
    };
    d.series.pv_forecast_recomputed = {
      entityId: 'pv_forecast_recomputed',
      source: 't',
      stepMs: H,
      samples: hours(before, 24, 1),
    };
    const s = pvTimeSeries(d, 'week');
    expect(s.kind).toBe('houseDays');
    const at = (start: number) => s.x.indexOf(start + 12 * H);
    expect(s.forecast[at(yesterday)]).toBe(48);
    expect(s.forecast[at(three)]).toBeNull(); // only 10 hours: no sum
    expect(s.recomputed![at(before)]).toBe(24);
    expect(s.forecast[at(before)]).toBeNull();
  });
});
