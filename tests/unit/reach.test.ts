import { describe, expect, it } from 'vitest';
import { batteryReach, socFloor } from '../../src/model/reach';
import type { Sample } from '../../src/model/types';

// Synthetic house in UTC: sun 08:00–16:00 (3 kW at noon), house 500 W around the clock.
const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 0, 1);
const tz = 'UTC';

function series(days: number, now: number, f: (t: number) => number, step = 15 * 60_000): Sample[] {
  const out: Sample[] = [];
  for (let t = now - days * D; t < now; t += step) out.push({ t, v: f(t) });
  return out;
}
const hourOf = (t: number) => (((t % D) + D) % D) / H;
const sun = (t: number) => {
  const h = hourOf(t);
  return h >= 8 && h < 16 ? 3000 * Math.sin(((h - 8) / 8) * Math.PI) : 0;
};

function house(now: number, socPct: number, loadW: (t: number) => number = () => 500) {
  return {
    now,
    tz,
    socPct,
    capKwh: 10,
    load: series(15, now, loadW),
    pv: series(15, now, sun),
    soc: series(30, now, (t) => (hourOf(t) < 7 ? 5 : 60)),
  };
}

describe('battery until sunrise (Audit05 I-4)', () => {
  it('by day says when the estimate starts, no numbers', () => {
    const r = batteryReach(house(T0 + 20 * D + 11 * H, 80))!;
    expect(r.kind).toBe('day');
    if (r.kind === 'day') {
      // the sun stops carrying 500 W shortly before 16:00 → evening ≈ 15:xx
      expect(hourOf(r.eveningAt)).toBeGreaterThan(14.5);
      expect(hourOf(r.eveningAt)).toBeLessThanOrEqual(16);
    }
  });

  it('at night: a full battery lasts, the need is the past nights (n), sunrise from the mornings', () => {
    const r = batteryReach(house(T0 + 20 * D + 22 * H, 90))!;
    expect(r.kind).toBe('night');
    if (r.kind !== 'night') return;
    // the sun carries 500 W from ≈ 08:30 (sin ramp), the next morning
    expect(hourOf(r.sunAt)).toBeGreaterThan(8);
    expect(hourOf(r.sunAt)).toBeLessThan(9.5);
    expect(r.sunAt - r.from).toBeLessThan(12 * H);
    // ≈ 10.5 h × 0.5 kW ≈ 5.2 kWh, identical nights → no spread
    expect(r.need.mean).toBeGreaterThan(4.5);
    expect(r.need.mean).toBeLessThan(6);
    expect(r.need.high - r.need.low).toBeLessThan(0.01);
    expect(r.n).toBeGreaterThanOrEqual(10);
    // 90 % of 10 kWh down to the 5 % limit = 8.5 kWh: lasts
    expect(r.usable).toBeCloseTo(8.5, 5);
    expect(r.emptyAt).toBeNull();
    expect(r.grid.mean).toBe(0);
  });

  it('at night: a low battery is empty in the night, then the grid (spread from varying nights)', () => {
    // nights alternate 400 / 600 W → mean ± sd
    const load = (t: number) => (Math.floor(t / D) % 2 ? 600 : 400);
    const r = batteryReach(house(T0 + 20 * D + 22 * H, 25, load))!;
    if (r.kind !== 'night') throw new Error('night expected');
    expect(r.usable).toBeCloseTo(2, 5);
    expect(r.emptyAt).not.toBeNull();
    // high need → empty earlier; low need → later
    expect(r.emptyEarly!).toBeLessThanOrEqual(r.emptyAt!);
    expect(r.emptyLate!).toBeGreaterThanOrEqual(r.emptyAt!);
    expect(r.need.high).toBeGreaterThan(r.need.low);
    expect(r.grid.mean).toBeCloseTo(r.need.mean - r.usable, 5);
    expect(r.grid.low).toBeLessThan(r.grid.high);
    // 2 kWh at ≈ 0.5 kW ≈ 4 h after 22:00
    expect(hourOf(r.emptyAt!)).toBeGreaterThan(1);
    expect(hourOf(r.emptyAt!)).toBeLessThan(3);
  });

  it('leaves out nights with a gap and nights far above the usual (car)', () => {
    const now = T0 + 20 * D + 22 * H;
    const x = house(now, 90);
    // one night with the car at 11 kW, one night without readings
    const carNight = now - 2 * D;
    x.load = x.load
      .map((p) => (p.t > carNight && p.t < carNight + 3 * H ? { ...p, v: 11_000 } : p))
      .filter((p) => !(p.t > now - 4 * D && p.t < now - 4 * D + 6 * H));
    const r = batteryReach(x)!;
    if (r.kind !== 'night') throw new Error('night expected');
    const all = batteryReach(house(now, 90))!;
    if (all.kind !== 'night') throw new Error('night expected');
    expect(r.n).toBe(all.n - 2);
    expect(r.need.mean).toBeCloseTo(all.need.mean, 1);
  });

  it('too few days: no estimate instead of a guess', () => {
    const x = house(T0 + 20 * D + 22 * H, 90);
    expect(batteryReach({ ...x, load: x.load.slice(-200), pv: x.pv.slice(-200) })).toBeNull();
  });

  it('discharge limit: the most common daily low, a jump to 0 never counts, else 5 % assumed', () => {
    const now = T0 + 30 * D;
    const soc = series(30, now, (t) => (hourOf(t) < 6 ? 8 : 70));
    soc.push({ t: now - 3 * D + H, v: 0 });
    expect(socFloor(soc, now)).toEqual({ pct: 8, seen: true });
    expect(
      socFloor(
        series(30, now, () => 60),
        now,
      ),
    ).toEqual({ pct: 5, seen: false });
  });
});
