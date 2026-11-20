import { describe, expect, it } from 'vitest';
import { originToday, stepLookup, usualLoad } from '../../src/app/origin-day';
import { generateDemo } from '../../src/demo';
import {
  forecastStack,
  niceScale,
  originOf,
  originSlots,
  originTotals,
  stackTops,
} from '../../src/model/origin';
import { localMidnight } from '../../src/model/time';

describe('origin of the consumption (Audit05 I-1)', () => {
  it('sun first, then battery, rest grid; stack adds up to the consumption', () => {
    // 3 kW sun, battery delivers 1 kW, 0.5 kW import → consumption 4.5 kW
    const o = originOf(3000, -1000, -500)!;
    expect(o).toEqual({ sun: 3000, battery: 1000, grid: 500, load: 4500, feed: 0 });
  });

  it('sun above the consumption: charging and feed-in are not part of the stack', () => {
    const o = originOf(6000, 2000, 3000)!; // 1 kW used, 2 kW into battery, 3 kW out
    expect(o.sun).toBe(1000);
    expect(o.battery).toBe(0);
    expect(o.grid).toBe(0);
    expect(o.feed).toBe(3000);
  });

  it('a missing meter is a gap, never 0', () => {
    expect(originOf(null, 0, 0)).toBeNull();
    const s = originSlots([1000, null], [0, 0], [0, 0]);
    expect(s.load).toEqual([1, null]);
    expect(s.sun[1]).toBeNull();
  });

  it('stack tops are cumulative and end at the consumption', () => {
    const s = originSlots([2000, 0], [-500, -300], [-100, -700]);
    const [a, b, c] = stackTops(s);
    expect(a).toEqual([2, 0]);
    expect(b).toEqual([2.5, 0.3]);
    expect(c[0]).toBeCloseTo(2.6);
    expect(c[1]).toBeCloseTo(1);
    expect(c).toEqual(s.load);
  });

  it('totals in kWh over known slots with shares adding to 1', () => {
    const s = originSlots([4000, 4000, null], [0, -2000, 0], [0, -2000, 0]);
    const tt = originTotals(s, 15 * 60_000);
    expect(tt.sun).toBeCloseTo(2); // 2 × 4 kW × ¼ h
    expect(tt.battery).toBeCloseTo(0.5);
    expect(tt.grid).toBeCloseTo(0.5);
    expect(tt.n).toBe(2);
    expect(tt.share!.sun + tt.share!.battery + tt.share!.grid).toBeCloseTo(1);
  });

  it('forecast: the sun part never exceeds the usual consumption', () => {
    const f = forecastStack([1, 2, null], [3, 0.5, 1]);
    expect(f.sun).toEqual([1, 0.5, null]);
  });

  it('nice axis ends in 1-2-5 steps', () => {
    expect(niceScale(2.3)).toEqual({ max: 3, step: 1 });
    expect(niceScale(5.6)).toEqual({ max: 6, step: 2 });
    expect(niceScale(0)).toEqual({ max: 1, step: 0.5 });
  });

  it('demo day: measured until now, faint forecast afterwards, never both in one slot', () => {
    const demo = generateDemo();
    const fc = stepLookup([localMidnight(demo.now, demo.timeZone)], 86_400_000, [1.5]);
    const day = originToday(demo, fc)!;
    expect(day.slots.load).toHaveLength(96);
    const nowSlot = Math.floor((demo.now - day.from) / day.stepMs);
    expect(day.slots.load.slice(nowSlot).every((v) => v === null)).toBe(true);
    expect(day.forecast!.load.slice(0, nowSlot).every((v) => v === null)).toBe(true);
    expect(day.forecast!.withSun).toBe(true);
    expect(day.forecast!.days).toBeGreaterThanOrEqual(20);
    expect(day.totals.load).toBeGreaterThan(0);
  });

  it('usual consumption only from days before today', () => {
    const demo = generateDemo();
    const from = localMidnight(demo.now, demo.timeZone);
    const u = usualLoad(demo, from, 96, 2);
    // only two past days: fewer than 3 per slot, so no "usual" value at all
    expect(u.days).toBe(2);
    expect(u.values.every((v) => v === null)).toBe(true);
  });
});
