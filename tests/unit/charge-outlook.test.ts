import { describe, expect, it, vi } from 'vitest';
import {
  batteryPath,
  blocksFromHourly,
  daySums,
  hourlyFromBlocks,
  outlookHours,
  usualLoad,
} from '../../src/model/charge-outlook';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string) => key,
  num: (v: number) => String(v),
  time: () => '00:00',
  i18n: { locale: 'de' },
}));
const { houseOutlook } = await import('../../src/app/house-outlook');
const { generateDemo } = await import('../../src/demo');

const H = 3_600_000;
const D = 24 * H;

describe('48-hour charge outlook (Audit05 I-5)', () => {
  it('hours start at the hour of now', () => {
    const h = outlookHours(10 * H + 25 * 60_000);
    expect(h).toHaveLength(48);
    expect(h[0]).toBe(10 * H);
    expect(h[47]).toBe(57 * H);
  });

  it('charge windows: touching hours are one block, and back to mean power per hour', () => {
    const hours = [0, H, 2 * H, 3 * H, 4 * H];
    const blocks = blocksFromHourly(hours, [0, 4, 6, 0, 4]);
    expect(blocks).toEqual([
      { start: H, end: 3 * H, kw: 6 },
      { start: 4 * H, end: 5 * H, kw: 4 },
    ]);
    // a block over half an hour counts half; unknown power takes the fallback
    expect(
      hourlyFromBlocks(
        hours,
        [
          { start: 0.5 * H, end: 2 * H, kw: 8 },
          { start: 4 * H, end: 4.25 * H, kw: null },
        ],
        11,
      ),
    ).toEqual([4, 8, 0, 0, 2.75]);
  });

  it('usual load: median per hour of the day, the car never lifts it, a sparse hour is left out', () => {
    const now = 14 * D;
    const load: { t: number; v: number }[] = [];
    for (let t = 0; t < now; t += 5 * 60_000) {
      const h = (t % D) / H;
      // 300 W at night, 1 kW by day; on two days the car adds 11 kW at 20:00
      const car = Math.floor(h) === 20 && t > 11 * D ? 11_000 : 0;
      load.push({ t, v: (h >= 7 && h < 22 ? 1000 : 300) + car });
    }
    // 03:00 of the last day only with one reading: too little
    const sparse = load.filter(
      (p) => !(p.t >= 13 * D + 3 * H && p.t < 13 * D + 3 * H + 55 * 60_000),
    );
    const u = usualLoad(sparse, null, now, (t) => Math.floor((t % D) / H));
    expect(u.kw[2]).toBeCloseTo(0.3, 5);
    expect(u.kw[12]).toBeCloseTo(1, 5);
    expect(u.kw[20]).toBeCloseTo(1, 5);
    expect(u.n).toBe(14);
  });

  it('battery path: surplus charges up to full, a deficit takes it down to the limit, a gap ends it', () => {
    const p = batteryPath(
      50,
      10,
      10,
      [4, 4, 0, 0, null, 2],
      [1, 1, 3, 3, 1, 1],
      [0, 0, 0, 0, 0, 0],
    );
    expect(p).toEqual([50, 80, 100, 70, 40, null, null]);
    expect(batteryPath(20, 10, 10, [0, 0], [1, 1], [0, 0])).toEqual([20, 10, 10]);
    // the car is part of the load
    expect(batteryPath(50, 10, 0, [5], [1], [4])).toEqual([50, 50]);
  });

  it('day sums: sun with its range and the car per local day; a missing hour makes the day unknown', () => {
    const hours = [22 * H, 23 * H, D, D + H];
    const s = daySums(
      hours,
      { p10: [0, 0, 1, 2], p50: [0, 0, 2, 3], p90: [0, 0, 3, null] },
      [0, 4, 4, 0],
      (t) => Math.floor(t / D) * D,
    );
    expect(s).toEqual([
      { day: 0, from: 0, hours: 2, sun: { p10: 0, p50: 0, p90: 0 }, car: 4 },
      { day: D, from: 2, hours: 2, sun: { p10: 3, p50: 5, p90: null }, car: 4 },
    ]);
  });

  it('from the demo house: 48 hours of sun, load and a battery strip between limit and full', () => {
    const data = generateDemo();
    const o = houseOutlook(data, [{ start: data.now + H, end: data.now + 3 * H, kw: 4 }], 11);
    expect(o.hours).toHaveLength(48);
    expect(o.pv.p50.filter((v) => v !== null && v > 0).length).toBeGreaterThan(10);
    expect(o.load.every((v) => v !== null && v > 0)).toBe(true);
    expect(o.car.reduce((a, v) => a + v, 0)).toBeCloseTo(8, 5);
    // the demo's own forecast covers today and tomorrow: the path stops where the sun forecast ends
    const soc = o.soc!.p50.filter((v): v is number => v !== null);
    expect(soc.length).toBe(1 + o.pv.p50.findIndex((v) => v === null));
    expect(soc.length).toBeGreaterThan(24);
    expect(Math.min(...soc)).toBeGreaterThanOrEqual(o.floorPct! - 1e-9);
    expect(Math.max(...soc)).toBeLessThanOrEqual(100);
  });
});
