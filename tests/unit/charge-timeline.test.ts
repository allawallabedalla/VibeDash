import { describe, expect, it } from 'vitest';
import {
  carPower,
  DEMO_HOUSE,
  demoCases,
  evaluate,
  STEPS,
  suggest,
  type Window,
} from '../../src/app/charge-timeline';

describe('charge timeline (prototype)', () => {
  const cases = demoCases();

  it('stops the car once its need is met, earliest window first', () => {
    const kw = carPower(
      [
        { id: 1, from: 40, to: 48, kw: 11 },
        { id: 2, from: 60, to: 80, kw: 11 },
      ],
      30,
    );
    const kwh = kw.reduce((a, v) => a + v * 0.25, 0);
    expect(kwh).toBeCloseTo(30, 6);
    expect(kw[40]).toBe(11);
    expect(kw.slice(0, 40).every((v) => v === 0)).toBe(true);
  });

  it('charging at noon needs less grid than charging at night', () => {
    const noon: Window[] = [{ id: 1, from: 44, to: 56, kw: 7 }];
    const night: Window[] = [{ id: 1, from: 84, to: 96, kw: 7 }];
    const a = evaluate(cases, DEMO_HOUSE, noon);
    const b = evaluate(cases, DEMO_HOUSE, night);
    expect(a.carKwh).toBeCloseTo(b.carKwh, 6);
    expect(a.gridByCar).toBeLessThan(b.gridByCar);
    expect(a.sunShare).toBeGreaterThan(b.sunShare);
    expect(a.grid.p10).toBeLessThanOrEqual(a.grid.p50);
    expect(a.grid.p50).toBeLessThanOrEqual(a.grid.p90);
  });

  it('several windows add up and each gets its own grid figure', () => {
    const r = evaluate(cases, DEMO_HOUSE, [
      { id: 1, from: 40, to: 44, kw: 7 },
      { id: 2, from: 52, to: 56, kw: 7 },
    ]);
    expect(r.carKwh).toBeCloseTo(14, 6);
    expect(r.windowGrid.length).toBe(2);
  });

  it('the battery never goes below the reserve', () => {
    const r = evaluate(cases, DEMO_HOUSE, [{ id: 1, from: 0, to: STEPS, kw: 11 }]);
    expect(Math.min(...r.batteryKwh.p10)).toBeGreaterThanOrEqual(DEMO_HOUSE.reserveKwh - 1e-9);
  });

  it('suggests sunny windows that need (almost) no grid for the car', () => {
    const w = suggest(cases, DEMO_HOUSE, 7);
    expect(w.length).toBeGreaterThan(0);
    const r = evaluate(cases, DEMO_HOUSE, w);
    expect(r.sunShare).toBeGreaterThan(0.8);
  });

  it('is fast enough for every pointer move', () => {
    const w: Window[] = [
      { id: 1, from: 40, to: 52, kw: 7 },
      { id: 2, from: 60, to: 70, kw: 11 },
    ];
    const t0 = performance.now();
    for (let k = 0; k < 50; k++) evaluate(cases, DEMO_HOUSE, w);
    expect((performance.now() - t0) / 50).toBeLessThan(8);
  });
});
