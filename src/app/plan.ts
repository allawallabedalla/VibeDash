/**
 * The charge plan as the pages see it – from the demo (computed in the browser) or from
 * the forecasting service via the VibeDash server. Plans and shows only.
 */
import type { DemoData } from '../demo/generate';
import { DEMO_BATTERY, DEMO_CAR, demoPlan, type PlanCheck } from '../demo/plan';
import { quantile } from '../model/series';
import { socPath, type Battery, type Car, type Reason, type Scenarios } from '../model/plan';

export interface PlanView {
  hours: number[];
  carKw: number[];
  kwh: number;
  range: [number, number];
  reason: Reason;
  pv: { p10: number[]; p50: number[]; p90: number[] };
  load: number[];
  soc: { p10: number[]; p50: number[]; p90: number[] };
  battery: Battery;
  car: Car;
  soc0Kwh: number;
  scenarios: Scenarios;
  nPv: number;
  nLoad: number;
  /** "untested: no winter data yet" etc. */
  untested: boolean;
}

function bands(rows: Float64Array[], n: number) {
  const at = (q: number) =>
    Array.from({ length: n }, (_, t) =>
      quantile(
        rows.map((r) => r[t]!),
        q,
      ),
    );
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

function view(
  hours: number[],
  sc: Scenarios,
  carKw: number[],
  kwh: number,
  range: [number, number],
  reason: Reason,
  battery: Battery,
  car: Car,
  soc0Kwh: number,
  nPv: number,
  nLoad: number,
  untested: boolean,
): PlanView {
  const n = hours.length;
  return {
    hours,
    carKw,
    kwh,
    range,
    reason,
    pv: bands(sc.pv, n),
    load: bands(sc.load, n).p50,
    soc: socPath(sc, carKw, battery, soc0Kwh),
    battery,
    car,
    soc0Kwh,
    scenarios: sc,
    nPv,
    nLoad,
    untested,
  };
}

export function planFromDemo(data: DemoData): PlanView | null {
  const p = demoPlan(data);
  if (!p) return null;
  return view(
    p.input.hours,
    p.input.scenarios,
    p.plan.carKw,
    p.plan.kwh,
    p.range,
    p.plan.reason,
    DEMO_BATTERY,
    DEMO_CAR,
    p.input.soc0Kwh,
    p.input.nAnalog,
    p.input.nAnalog,
    false,
  );
}

/** Response of `/api/plan` (forecasting service, German keys like the other endpoints). */
export interface PlanApi {
  stunden: string[];
  auto_kw: number[];
  kwh: number;
  spanne: [number, number];
  grund: Reason;
  pv_listen: number[][];
  last_listen: number[][];
  paar_pv: number[];
  paar_last: number[];
  akku: {
    kapazitaet_kwh: number;
    max_laden_kw: number;
    max_entladen_kw: number;
    min_soc_pct: number;
    reserve_kwh: number;
  };
  auto: { kapazitaet_kwh: number; phasen: 1 | 3; min_a: number; max_a: number };
  soc_kwh: number;
  geladen_kwh: number;
  n_pv: number;
  n_last: number;
  ungeprueft: boolean;
}

export function planFromApi(b: PlanApi): PlanView {
  const pv = b.pv_listen.map((r) => Float64Array.from(r));
  const load = b.last_listen.map((r) => Float64Array.from(r));
  const sc: Scenarios = {
    pv: b.paar_pv.map((i) => pv[i]!),
    load: b.paar_last.map((j) => load[j]!),
  };
  const battery: Battery = {
    capacityKwh: b.akku.kapazitaet_kwh,
    maxChargeKw: b.akku.max_laden_kw,
    maxDischargeKw: b.akku.max_entladen_kw,
    minSocPct: b.akku.min_soc_pct,
    reserveKwh: b.akku.reserve_kwh,
  };
  const car: Car = {
    capacityKwh: b.auto.kapazitaet_kwh,
    phases: b.auto.phasen,
    minA: b.auto.min_a,
    maxA: b.auto.max_a,
    chargedTodayKwh: b.geladen_kwh,
  };
  return view(
    b.stunden.map((s) => Date.parse(s)),
    sc,
    b.auto_kw,
    b.kwh,
    b.spanne,
    b.grund,
    battery,
    car,
    b.soc_kwh,
    b.n_pv,
    b.n_last,
    b.ungeprueft,
  );
}

/** Summary of a plan backtest for the accuracy card. */
export interface PlanAccuracy {
  n: number;
  /** Share of days without grid import caused by the car (> 0.1 kWh), %. */
  pct: number | null;
  gridKwh: number;
  badDays: number;
  chargedKwh: number;
  possibleKwh: number;
  /** Median spread of the plan (p90 − p10 of single plans), kWh. */
  spreadKwh: number | null;
  /** Weekly share of good days, oldest first. */
  history: (number | null)[];
}

export const MIN_PLAN_DAYS = 7;

export function planAccuracy(checks: PlanCheck[]): PlanAccuracy {
  const n = checks.length;
  const bad = checks.filter((c) => c.gridKwh > 0.1).length;
  const history: (number | null)[] = [];
  for (let i = 0; i < n; i += 7) {
    const w = checks.slice(i, i + 7);
    history.push(w.length < 3 ? null : (w.filter((c) => c.gridKwh <= 0.1).length / w.length) * 100);
  }
  return {
    n,
    pct: n < MIN_PLAN_DAYS ? null : ((n - bad) / n) * 100,
    gridKwh: checks.reduce((a, c) => a + c.gridKwh, 0),
    badDays: bad,
    chargedKwh: checks.reduce((a, c) => a + c.chargedKwh, 0),
    possibleKwh: checks.reduce((a, c) => a + c.possibleKwh, 0),
    spreadKwh: n
      ? quantile(
          checks.map((c) => c.spreadKwh),
          0.5,
        )
      : null,
    history,
  };
}
