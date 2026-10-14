/**
 * Charge planning, stage A: plan and show – never switch (LADESTEUERUNG.md §3–6).
 *
 * The same algorithm as `forecast/vibedash_forecast/plan.py`; this copy runs in the
 * browser for the demo and for "what if …?" (an answer in well under a second on a phone).
 * Live, the forecasting service sends the 300 paired scenarios, so browser and service
 * look at exactly the same numbers.
 *
 * Units: one step = one hour, energy in kWh per hour (= average kW).
 */
import { quantile } from './series';

export const ALPHA = 1 / 31;
export const TOLERANCE_KWH = 0.01;
const VOLT = 230;

export interface Battery {
  capacityKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  minSocPct: number;
  reserveKwh: number;
}

export interface Car {
  capacityKwh: number;
  phases: 1 | 3;
  minA: number;
  maxA: number;
  chargedTodayKwh: number;
}

/** Paired scenarios: pv[s][t] and load[s][t] in kWh per hour. */
export interface Scenarios {
  pv: Float64Array[];
  load: Float64Array[];
}

export const ampsToKw = (a: number, phases: number): number => (a * VOLT * phases) / 1000;
export const kwToAmps = (kw: number, phases: number): number => (kw * 1000) / (VOLT * phases);

/** Charging power options in kW, highest first. */
export function levelsKw(car: Car): number[] {
  const amps = [...new Set([car.maxA, Math.floor((car.minA + car.maxA) / 2), car.minA])];
  return amps.sort((a, b) => b - a).map((a) => ampsToKw(a, car.phases));
}

/** Battery state after one hour (kWh); the grid covers what the battery cannot. */
export function stepSoc(soc: number, pv: number, load: number, car: number, b: Battery): number {
  const floor = (b.capacityKwh * b.minSocPct) / 100;
  const net = pv - load - car;
  return net >= 0
    ? soc + Math.min(net, b.maxChargeKw, b.capacityKwh - soc)
    : soc - Math.min(-net, b.maxDischargeKw, Math.max(soc - floor, 0));
}

/** Grid import (kWh) of one scenario over the horizon. */
function importOne(
  pv: Float64Array,
  load: Float64Array,
  carKw: ArrayLike<number>,
  b: Battery,
  soc0Kwh: number,
): number {
  const floor = (b.capacityKwh * b.minSocPct) / 100;
  let soc = soc0Kwh;
  let imported = 0;
  for (let t = 0; t < pv.length; t++) {
    const net = pv[t]! - load[t]! - (carKw[t] ?? 0);
    if (net >= 0) {
      soc += Math.min(net, b.maxChargeKw, b.capacityKwh - soc);
    } else {
      const discharge = Math.min(-net, b.maxDischargeKw, Math.max(soc - floor, 0));
      soc -= discharge;
      imported += -net - discharge;
    }
  }
  return imported;
}

/** Grid import (kWh) per scenario over the horizon for a planned car power per hour. */
export function simulate(
  sc: Scenarios,
  carKw: ArrayLike<number>,
  b: Battery,
  soc0Kwh: number,
): Float64Array {
  return Float64Array.from(sc.pv, (pv, s) => importOne(pv, sc.load[s]!, carKw, b, soc0Kwh));
}

/** Battery state of charge (kWh) per hour: median and 10–90 % over the scenarios. */
export function socPath(
  sc: Scenarios,
  carKw: ArrayLike<number>,
  b: Battery,
  soc0Kwh: number,
): { p10: number[]; p50: number[]; p90: number[] } {
  const floor = (b.capacityKwh * b.minSocPct) / 100;
  const n = sc.pv[0]?.length ?? 0;
  const rows: number[][] = Array.from({ length: n }, () => []);
  for (let s = 0; s < sc.pv.length; s++) {
    let soc = soc0Kwh;
    for (let t = 0; t < n; t++) {
      const net = sc.pv[s]![t]! - sc.load[s]![t]! - (carKw[t] ?? 0);
      soc +=
        net >= 0
          ? Math.min(net, b.maxChargeKw, b.capacityKwh - soc)
          : -Math.min(-net, b.maxDischargeKw, Math.max(soc - floor, 0));
      rows[t]!.push(soc);
    }
  }
  return {
    p10: rows.map((r) => quantile(r, 0.1)),
    p50: rows.map((r) => quantile(r, 0.5)),
    p90: rows.map((r) => quantile(r, 0.9)),
  };
}

/** The reserve stays in the battery for planning: the car may never use it. */
export function planningBattery(b: Battery): Battery {
  return {
    ...b,
    minSocPct: b.minSocPct + (b.reserveKwh / b.capacityKwh) * 100,
    reserveKwh: 0,
  };
}

export type Reason = 'none' | 'sun' | 'sunBattery' | 'full';

export interface Plan {
  carKw: number[];
  kwh: number;
  reason: Reason;
}

function medianAt(rows: Float64Array[], t: number): number {
  return quantile(
    rows.map((r) => r[t]!),
    0.5,
  );
}

/**
 * Greedy plan: add charging hours (highest expected surplus first), each at the highest
 * power that keeps the cautious quantile (1 − α) of extra grid import at zero – now,
 * tonight and tomorrow. Upper bound: car capacity minus what was charged today.
 */
export function greedyPlan(
  sc: Scenarios,
  b: Battery,
  soc0Kwh: number,
  car: Car,
  /** Charging allowed only before this hour index (default: whole horizon). */
  until?: number,
): Plan {
  const n = sc.pv[0]?.length ?? 0;
  const pb = planningBattery(b);
  const carKw = new Array<number>(n).fill(0);
  const base = simulate(sc, carKw, pb, soc0Kwh);
  const surplus = Array.from({ length: n }, (_, t) => ({
    t,
    v: medianAt(sc.pv, t) - medianAt(sc.load, t),
  }))
    .filter(({ t }) => until === undefined || t < until)
    .sort((a, b2) => b2.v - a.v || a.t - b2.t);
  let budget = Math.max(0, car.capacityKwh - car.chargedTodayKwh);
  const levels = levelsKw(car);
  // The cautious quantile is above the tolerance as soon as this many scenarios are:
  // stop simulating early (exact, not an approximation).
  const m = sc.pv.length;
  const failAt = m - Math.floor((m - 1) * (1 - ALPHA));
  const ok = (t: number, kw: number) => {
    const trial = carKw.slice();
    trial[t] = kw;
    const extra = new Array<number>(m);
    let bad = 0;
    for (let s = 0; s < m; s++) {
      extra[s] = importOne(sc.pv[s]!, sc.load[s]!, trial, pb, soc0Kwh) - base[s]!;
      if (extra[s]! > TOLERANCE_KWH && ++bad >= failAt) return false;
    }
    return quantile(extra, 1 - ALPHA) <= TOLERANCE_KWH;
  };
  for (const { t } of surplus) {
    if (budget <= 1e-9) break;
    // Extra import only grows with more car power, so an hour that fails at the lowest
    // level is skipped without trying the higher ones.
    const lowest = Math.min(levels[levels.length - 1]!, budget);
    if (!ok(t, lowest)) continue;
    const kw = levels.map((l) => Math.min(l, budget)).find((l) => l <= lowest || ok(t, l))!;
    budget -= kw;
    carKw[t] = kw;
  }
  const kwh = carKw.reduce((a, v) => a + v, 0);
  let reason: Reason = 'none';
  if (budget <= 1e-9 && kwh > 0) reason = 'full';
  else if (kwh > 0) {
    reason = carKw.some((v, t) => v > 0 && medianAt(sc.pv, t) < 0.1) ? 'sunBattery' : 'sun';
  }
  return { carKw, kwh, reason };
}

/** Pick `n` pairs (fixed by `rand`) out of PV and load scenario lists. */
export function pair(
  pv: Float64Array[],
  load: Float64Array[],
  rand: () => number,
  n: number,
): Scenarios {
  const out: Scenarios = { pv: [], load: [] };
  for (let i = 0; i < n; i++) {
    out.pv.push(pv[Math.floor(rand() * pv.length)]!);
    out.load.push(load[Math.floor(rand() * load.length)]!);
  }
  return out;
}

/** "What if I charge like this?" → extra grid import over the horizon. */
export interface WhatIf {
  gridKwh: [number, number, number]; // 10 / 50 / 90 %
  sharePct: number; // share of scenarios that need the grid
  firstHour: number | null; // first hour in which the median scenario needs extra grid power
  n: number;
}

export function whatIf(sc: Scenarios, b: Battery, soc0Kwh: number, carKw: number[]): WhatIf {
  const zero = new Array<number>(carKw.length).fill(0);
  const withCar = simulate(sc, carKw, b, soc0Kwh);
  const without = simulate(sc, zero, b, soc0Kwh);
  const extra = Array.from(withCar, (v, i) => v - without[i]!);
  // First hour with extra import in more than half of the scenarios.
  let firstHour: number | null = null;
  for (let t = 1; t <= carKw.length && firstHour === null; t++) {
    const cut = (x: Scenarios) => ({
      pv: x.pv.map((r) => r.subarray(0, t)),
      load: x.load.map((r) => r.subarray(0, t)),
    });
    const part = cut(sc);
    const a = simulate(part, carKw, b, soc0Kwh);
    const z = simulate(part, zero, b, soc0Kwh);
    const share = Array.from(a, (v, i) => v - z[i]! > TOLERANCE_KWH).filter(Boolean).length;
    if (share > a.length / 2) firstHour = t - 1;
  }
  return {
    gridKwh: [quantile(extra, 0.1), quantile(extra, 0.5), quantile(extra, 0.9)],
    sharePct: (extra.filter((v) => v > TOLERANCE_KWH).length / extra.length) * 100,
    firstHour,
    n: extra.length,
  };
}
