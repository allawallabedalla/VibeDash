import { describe, expect, it } from 'vitest';
import { generateDemo } from '../../src/demo';
import { DEMO_CAR, backtestPlans, demoPlan, hourlyFromCounter } from '../../src/demo/plan';
import { greedyPlan, simulate, whatIf, levelsKw, type Scenarios } from '../../src/model/plan';

const batt = { capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 2, minSocPct: 10, reserveKwh: 0 };
const car = { capacityKwh: 60, phases: 3 as const, minA: 6, maxA: 16, chargedTodayKwh: 0 };
const sc = (pv: number[][], load: number[][]): Scenarios => ({
  pv: pv.map((r) => Float64Array.from(r)),
  load: load.map((r) => Float64Array.from(r)),
});

describe('charge plan core', () => {
  it('simulates battery limits like the Python service', () => {
    // same vector as forecast/tests/test_plan.py::test_simulate_battery_limits
    expect(simulate(sc([[0, 0]], [[3, 3]]), [0, 0], batt, 4)[0]).toBe(3);
  });

  it('offers 16, 11 and 6 A on three phases', () => {
    expect(levelsKw(car).map((k) => Math.round(k * 100) / 100)).toEqual([11.04, 7.59, 4.14]);
  });

  it('never plans without sun and respects the car limit', () => {
    const night = sc([[0, 0, 0]], [[0.5, 0.5, 0.5]]);
    expect(greedyPlan(night, batt, 5, car).kwh).toBe(0);
    const sunny = sc([[20, 20, 20]], [[0.5, 0.5, 0.5]]);
    expect(greedyPlan(sunny, batt, 5, { ...car, chargedTodayKwh: 55 }).kwh).toBeCloseTo(5);
  });

  it('what-if reports grid import when charging at night', () => {
    const s = sc([[0, 0]], [[0.5, 0.5]]);
    const w = whatIf(s, batt, 3, [11, 11]);
    expect(w.gridKwh[1]).toBeGreaterThan(10);
    expect(w.firstHour).toBe(0);
  });
});

describe('demo charge plan', () => {
  const data = generateDemo();

  it('reads hourly counter differences and leaves silent hours open', () => {
    const s = [
      { t: 0, v: 1 },
      { t: 3_600_000, v: 2 },
      { t: 7_200_000, v: 4 },
    ];
    expect(hourlyFromCounter(s, 0, 3)).toEqual([1, 2, null]);
  });

  it('plans a range and a reason', () => {
    const p = demoPlan(data)!;
    expect(p).not.toBeNull();
    expect(p.range[0]).toBeLessThanOrEqual(p.range[1]);
    expect(p.input.scenarios.pv).toHaveLength(300);
    expect(p.plan.carKw.length).toBe(p.input.hours.length);
  });

  it('backtest with hourly replanning: no grid import caused by the car (M12 done-criterion)', () => {
    const bt = backtestPlans(data);
    expect(bt.length).toBeGreaterThanOrEqual(10);
    expect(bt.filter((d) => d.gridKwh > 0.1)).toEqual([]);
    expect(bt.reduce((a, d) => a + d.chargedKwh, 0)).toBeGreaterThan(50);
    for (const d of bt) expect(d.chargedKwh).toBeLessThanOrEqual(DEMO_CAR.capacityKwh);
  });

  it('same inputs, same plan (randomness fixed per calendar day)', () => {
    expect(demoPlan(data)!.plan.carKw).toEqual(demoPlan(data)!.plan.carKw);
  });
});
