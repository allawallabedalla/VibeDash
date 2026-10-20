/**
 * Charge timeline (prototype): place several charge windows on a day and see at once how much the car gets, how
 * much grid power the house would need and how full the house battery stays – over many weather cases, in the
 * browser, fast enough to recompute on every pointer move (31 cases × 96 steps ≈ 3 000 steps).
 *
 * Pure functions only; the component (ChargeTimeline.svelte) draws and handles the pointer.
 */

export const STEPS = 96; // 15-minute steps of one day
export const DT_H = 0.25;

export interface Cases {
  /** per case and step: solar power (kW) and house load without the car (kW) */
  pv: number[][];
  load: number[][];
}

export interface House {
  batteryKwh: number;
  /** battery at the start of the day (kWh) */
  startKwh: number;
  /** never planned below this (kWh) */
  reserveKwh: number;
  /** what the car can still take (kWh) */
  carNeedKwh: number;
  /** charge/discharge efficiency of the battery, one way */
  eta: number;
  /** battery power limit (kW) */
  batteryKw: number;
}

export interface Window {
  id: number;
  /** first step and the step after the last (0 … 96) */
  from: number;
  to: number;
  kw: number;
}

export interface Result {
  /** energy into the car (kWh), the same in every case (limited by the car's need) */
  carKwh: number;
  /** car power per step (kW) after the car's need is met */
  carKw: number[];
  /** grid import over the day (kWh): median and 10–90 % */
  grid: { p50: number; p10: number; p90: number };
  /** grid import that the car causes (with car minus without car), median */
  gridByCar: number;
  /** per step, median and 90 % of grid import (kW) */
  gridKw: { p50: number[]; p90: number[] };
  /** battery state per step (kWh), median and 10 % */
  batteryKwh: { p50: number[]; p10: number[] };
  /** per window: grid import inside the window (kWh, median) */
  windowGrid: number[];
  /** share of the car's energy not drawn from the grid (0–1) */
  sunShare: number;
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo);
};

/** Car power per step from the windows, cut once the car's need is met (earliest window first). */
export function carPower(windows: Window[], needKwh: number): number[] {
  const kw = new Array<number>(STEPS).fill(0);
  for (const w of windows)
    for (let i = Math.max(0, w.from); i < Math.min(STEPS, w.to); i++)
      kw[i] = Math.max(kw[i]!, w.kw);
  let left = needKwh;
  for (let i = 0; i < STEPS; i++) {
    const e = Math.min(kw[i]! * DT_H, left);
    kw[i] = e / DT_H;
    left -= e;
  }
  return kw;
}

/** One case: battery first, grid for the rest. Returns grid import per step (kW) and battery per step (kWh). */
function simulate(
  pv: number[],
  load: number[],
  car: number[],
  h: House,
  grid: number[],
  bat: number[],
) {
  let e = h.startKwh;
  for (let i = 0; i < STEPS; i++) {
    const net = pv[i]! - load[i]! - car[i]!; // kW, + = surplus
    let imp = 0;
    if (net >= 0) {
      const room = (h.batteryKwh - e) / h.eta / DT_H;
      e += Math.min(net, h.batteryKw, room) * h.eta * DT_H;
    } else {
      const want = -net;
      const avail = Math.max(0, (e - h.reserveKwh) * h.eta) / DT_H;
      const take = Math.min(want, h.batteryKw, avail);
      e -= (take * DT_H) / h.eta;
      imp = want - take;
    }
    grid[i] = imp;
    bat[i] = e;
  }
}

export function evaluate(cases: Cases, house: House, windows: Window[]): Result {
  const n = cases.pv.length;
  const car = carPower(windows, house.carNeedKwh);
  const none = new Array<number>(STEPS).fill(0);
  const g = new Array<number>(STEPS);
  const b = new Array<number>(STEPS);
  const totals: number[] = [];
  const baseTotals: number[] = [];
  const perStep: number[][] = Array.from({ length: STEPS }, () => []);
  const batStep: number[][] = Array.from({ length: STEPS }, () => []);
  const inWin: number[][] = windows.map(() => []);
  for (let s = 0; s < n; s++) {
    simulate(cases.pv[s]!, cases.load[s]!, car, house, g, b);
    let tot = 0;
    for (let i = 0; i < STEPS; i++) {
      tot += g[i]! * DT_H;
      perStep[i]!.push(g[i]!);
      batStep[i]!.push(b[i]!);
    }
    totals.push(tot);
    windows.forEach((w, k) => {
      let x = 0;
      for (let i = Math.max(0, w.from); i < Math.min(STEPS, w.to); i++) x += g[i]! * DT_H;
      inWin[k]!.push(x);
    });
    simulate(cases.pv[s]!, cases.load[s]!, none, house, g, b);
    baseTotals.push(g.reduce((a, v) => a + v * DT_H, 0));
  }
  const carKwh = car.reduce((a, v) => a + v * DT_H, 0);
  const byCar = quantile(
    totals.map((t, s) => Math.max(0, t - baseTotals[s]!)),
    0.5,
  );
  return {
    carKwh,
    carKw: car,
    grid: { p50: quantile(totals, 0.5), p10: quantile(totals, 0.1), p90: quantile(totals, 0.9) },
    gridByCar: byCar,
    gridKw: {
      p50: perStep.map((x) => quantile(x, 0.5)),
      p90: perStep.map((x) => quantile(x, 0.9)),
    },
    batteryKwh: {
      p50: batStep.map((x) => quantile(x, 0.5)),
      p10: batStep.map((x) => quantile(x, 0.1)),
    },
    windowGrid: inWin.map((x) => quantile(x, 0.5)),
    sunShare: carKwh > 0 ? Math.max(0, Math.min(1, 1 - byCar / carKwh)) : 1,
  };
}

/** Solar power per step: median and 10–90 % over the cases (for the drawing). */
export function sunBand(cases: Cases): { p10: number[]; p50: number[]; p90: number[] } {
  const col = (i: number) => cases.pv.map((r) => r[i]!);
  const out = { p10: [] as number[], p50: [] as number[], p90: [] as number[] };
  for (let i = 0; i < STEPS; i++) {
    const c = col(i);
    out.p10.push(quantile(c, 0.1));
    out.p50.push(quantile(c, 0.5));
    out.p90.push(quantile(c, 0.9));
  }
  return out;
}

/**
 * "Best suggestion": the sunniest quarter hours of a normal day (median surplus over the house load, with a small
 * margin) until the car's need is covered, merged into windows. Simple on purpose – a starting point to play from,
 * not the house's planner.
 */
export function suggest(cases: Cases, house: House, kw: number): Window[] {
  const surplus: number[] = [];
  for (let i = 0; i < STEPS; i++)
    surplus.push(
      quantile(
        cases.pv.map((r, s) => r[i]! - cases.load[s]![i]!),
        0.5,
      ),
    );
  const order = surplus
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v >= kw * 0.5)
    .sort((a, b) => b.v - a.v);
  const take = new Array<boolean>(STEPS).fill(false);
  let left = house.carNeedKwh;
  for (const { i } of order) {
    if (left <= 0) break;
    take[i] = true;
    left -= kw * DT_H;
  }
  // close single-step gaps, then cut into windows
  for (let i = 1; i < STEPS - 1; i++) if (!take[i] && take[i - 1] && take[i + 1]) take[i] = true;
  const out: Window[] = [];
  for (let i = 0; i < STEPS;) {
    if (!take[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < STEPS && take[j]) j++;
    out.push({ id: out.length + 1, from: i, to: j, kw });
    i = j;
  }
  return out;
}

/** Made-up house for the prototype: 31 weather cases (clear to grey), a usual load profile. */
export function demoCases(seed = 7, n = 31): Cases {
  let x = seed;
  const rnd = () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
  const pv: number[][] = [];
  const load: number[][] = [];
  for (let s = 0; s < n; s++) {
    const clear = 0.25 + 0.75 * (s / (n - 1)) ** 0.8; // spread from grey to clear
    const rowPv: number[] = [];
    const rowLoad: number[] = [];
    let cloud = 1;
    for (let i = 0; i < STEPS; i++) {
      const h = i * DT_H;
      const sun = h > 7.5 && h < 18.5 ? Math.sin((Math.PI * (h - 7.5)) / 11) ** 1.4 : 0;
      cloud = 0.85 * cloud + 0.15 * (0.6 + 0.8 * rnd());
      rowPv.push(Math.max(0, 15 * clear * sun * Math.min(1.1, cloud)));
      const base =
        0.35 + 0.5 * Math.exp(-(((h - 7.5) / 1.2) ** 2)) + 0.9 * Math.exp(-(((h - 19) / 1.8) ** 2));
      const cook = h > 12 && h < 12.75 ? 1.6 : 0;
      rowLoad.push(base + cook + 0.15 * rnd());
    }
    pv.push(rowPv);
    load.push(rowLoad);
  }
  return { pv, load };
}

export const DEMO_HOUSE: House = {
  batteryKwh: 20,
  startKwh: 7,
  reserveKwh: 2,
  carNeedKwh: 35,
  eta: 0.95,
  batteryKw: 10,
};
