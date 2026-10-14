/**
 * Charge plan for the demo household (LADESTEUERUNG.md, stage A): plan and show only.
 *
 * Demo simplifications (said in the model card): PV scenarios are the measured hourly
 * profiles of the 10 past days closest to a synthetic weather forecast (real clearness
 * ± 20 %); load scenarios are the hourly profiles of the last 21 complete days (summer: no heating, so no temperature model). The demo
 * home has no car – the plan answers "how much could a car have taken without grid power?".
 */
import { addDays, localHour, localMidnight } from '../model/time';
import { quantile } from '../model/series';
import {
  greedyPlan,
  pair,
  simulate,
  stepSoc,
  type Battery,
  type Car,
  type Plan,
  type Scenarios,
} from '../model/plan';
import type { Sample } from '../model/types';
import { BATTERY_CAPACITY_WH, CLEAR_SKY_DAY_KWH, clearSkyPower, type DemoData } from './generate';
import { gaussian, mulberry32 } from './random';

const HOUR = 3_600_000;
export const PAIRINGS = 300;
const SINGLES = 10;
const ANALOG = 21;
/** PV analog days: the closest by (synthetic) forecast clearness. */
const ANALOG_PV = 10;
/** Error of the synthetic demo weather forecast (log scale). */
const FORECAST_ERROR = 0.2;
const MIN_ANALOG = 10;

export const DEMO_BATTERY: Battery = {
  capacityKwh: BATTERY_CAPACITY_WH / 1000,
  maxChargeKw: 3,
  maxDischargeKw: 3,
  minSocPct: 5,
  reserveKwh: 1,
};

export const DEMO_CAR: Car = { capacityKwh: 60, phases: 3, minA: 6, maxA: 16, chargedTodayKwh: 0 };

/** Counter difference per hour [from, from + n h); null where the counter was silent. */
export function hourlyFromCounter(samples: readonly Sample[], from: number, n: number) {
  const at: (number | null)[] = [];
  let i = 0;
  for (let k = 0; k <= n; k++) {
    const t = from + k * HOUR;
    while (i < samples.length && samples[i]!.t <= t) i++;
    const s = samples[i - 1];
    at.push(s && t - s.t <= 15 * 60_000 ? s.v : null);
  }
  return Array.from({ length: n }, (_, k) =>
    at[k] == null || at[k + 1] == null ? null : Math.max(0, at[k + 1]! - at[k]!),
  );
}

/** Mean clear-sky energy (kWh) of the local hour starting at `t`. */
function clearHourKwh(t: number, tz: string): number {
  let sum = 0;
  for (let m = 0; m < 4; m++) sum += clearSkyPower(localHour(t + (m + 0.5) * 15 * 60_000, tz));
  return sum / 4 / 1000;
}

/**
 * Synthetic weather forecast for the demo: the day's real clearness with a fixed random
 * error (about ±20 %). Real homes use Open-Meteo's GTI forecast instead. Days without
 * data (tomorrow) have no forecast → null, all analog days count.
 */
const forecastCache = new WeakMap<DemoData, Map<number, number | null>>();

export function demoForecastFactor(data: DemoData, start: number): number | null {
  let cache = forecastCache.get(data);
  if (!cache) forecastCache.set(data, (cache = new Map()));
  if (!cache.has(start)) cache.set(start, forecastFactor(data, start));
  return cache.get(start)!;
}

function forecastFactor(data: DemoData, start: number): number | null {
  const tz = data.timeZone;
  const end = Math.min(addDays(start, 1, tz), Math.floor(data.now / HOUR) * HOUR);
  const n = Math.round((end - start) / HOUR);
  if (n < 6) return null;
  const pv = hourlyFromCounter(data.series.pv_energy!.samples, start, n);
  let got = 0;
  let clear = 0;
  pv.forEach((v, k) => {
    if (v === null) return;
    got += v;
    clear += clearHourKwh(start + k * HOUR, tz);
  });
  if (clear < 1) return null;
  const noise = gaussian(mulberry32(Math.floor(start / 86_400_000) * 7919));
  return (got / clear) * Math.exp(FORECAST_ERROR * noise);
}

interface PastDay {
  start: number;
  end: number;
  factor: number;
  load: number[]; // 24 hourly kWh by local hour index
  pv: number[];
}

const dayCache = new WeakMap<DemoData, PastDay[]>();

/** Complete past days (PV factor and hourly load) that ended before `before`. */
function pastDays(data: DemoData, before: number): PastDay[] {
  let days = dayCache.get(data);
  if (!days) dayCache.set(data, (days = allDays(data)));
  return days.filter((d) => d.end <= before);
}

function allDays(data: DemoData): PastDay[] {
  const tz = data.timeZone;
  const before = data.now;
  const first = data.series.pv_energy!.samples[0]!.t;
  const out: PastDay[] = [];
  for (
    let start = addDays(localMidnight(first, tz), 1, tz);
    addDays(start, 1, tz) <= before;
    start = addDays(start, 1, tz)
  ) {
    const hours = Math.round((addDays(start, 1, tz) - start) / HOUR);
    const pv = hourlyFromCounter(data.series.pv_energy!.samples, start, hours);
    const load = hourlyFromCounter(data.series.load_energy!.samples, start, hours);
    if (load.some((v) => v === null)) continue;
    const pvSum = pv.every((v) => v !== null) ? pv.reduce<number>((a, v) => a + v!, 0) : null;
    // A PV gap leaves the day out of the PV factors only.
    out.push({
      start,
      end: addDays(start, 1, tz),
      factor: pvSum === null ? NaN : pvSum / CLEAR_SKY_DAY_KWH,
      load: load as number[],
      pv: pv.map((v) => v ?? 0),
    });
  }
  return out;
}

export interface PlanInput {
  from: number; // first hour (UTC ms, full hour)
  hours: number[]; // hour starts
  scenarios: Scenarios; // 300 pairings
  pvLists: Float64Array[]; // all PV scenarios (for the single plans)
  loadLists: Float64Array[];
  soc0Kwh: number;
  nAnalog: number;
  seed: number;
}

/** Scenarios from `from` to the end of the next local day, using only days before `from`. */
export function planInput(data: DemoData, from: number, soc0Kwh: number): PlanInput | null {
  const tz = data.timeZone;
  const days = pastDays(data, from).slice(-ANALOG);
  const nSunny = days.filter((d) => Number.isFinite(d.factor)).length;
  if (nSunny < MIN_ANALOG || days.length < MIN_ANALOG) return null;
  const end = addDays(localMidnight(from, tz), 2, tz);
  const hours: number[] = [];
  for (let t = from; t < end; t += HOUR) hours.push(t);
  const tomorrow = addDays(localMidnight(from, tz), 1, tz);
  const seed = Math.floor(localMidnight(from, tz) / 86_400_000);
  const rand = mulberry32(seed);
  const all = pastDays(data, from).filter((d) => Number.isFinite(d.factor));
  const analog = (fc: number | null) =>
    fc === null
      ? all.slice(-ANALOG)
      : [...all]
          .sort((a, b) => Math.abs(a.factor - fc) - Math.abs(b.factor - fc))
          .slice(0, ANALOG_PV);
  const pvToday = analog(demoForecastFactor(data, localMidnight(from, tz)));
  const pvTomorrow = analog(demoForecastFactor(data, tomorrow));
  const today = localMidnight(from, tz);
  const slot = hours.map((t) => Math.round((t - (t < tomorrow ? today : tomorrow)) / HOUR));
  const at = (d: PastDay, k: number, which: 'pv' | 'load') => {
    const row = d[which];
    return row[Math.min(slot[k]!, row.length - 1)]!;
  };
  // PV: measured hourly profiles of analog days (keeps passing clouds), today's rest
  // from one day, tomorrow from another (independent days).
  const pvLists = Array.from({ length: ANALOG }, () => {
    const a = pvToday[Math.floor(rand() * pvToday.length)]!;
    const b = pvTomorrow[Math.floor(rand() * pvTomorrow.length)]!;
    return Float64Array.from(hours, (t, k) => at(t < tomorrow ? a : b, k, 'pv'));
  });
  const loadLists = days.map(() => {
    const a = days[Math.floor(rand() * days.length)]!;
    const b = days[Math.floor(rand() * days.length)]!;
    return Float64Array.from(hours, (t, k) => at(t < tomorrow ? a : b, k, 'load'));
  });
  return {
    from,
    hours,
    scenarios: pair(pvLists, loadLists, rand, PAIRINGS),
    pvLists,
    loadLists,
    soc0Kwh,
    nAnalog: Math.min(nSunny, days.length),
    seed,
  };
}

export interface DemoPlan {
  input: PlanInput;
  plan: Plan;
  /** 10–90 % of the planned kWh over small single plans (30 pairings each). */
  range: [number, number];
}

export function makePlan(input: PlanInput, battery: Battery, car: Car): DemoPlan {
  const plan = greedyPlan(input.scenarios, battery, input.soc0Kwh, car);
  const singles: number[] = [];
  for (let s = 1; s <= SINGLES; s++) {
    const sc = pair(input.pvLists, input.loadLists, mulberry32(input.seed * 31 + s), 30);
    singles.push(greedyPlan(sc, battery, input.soc0Kwh, car).kwh);
  }
  return { input, plan, range: [quantile(singles, 0.1), quantile(singles, 0.9)] };
}

function socAt(data: DemoData, t: number): number | null {
  const s = data.series.battery_soc!.samples;
  let found: Sample | undefined;
  for (const x of s) {
    if (x.t > t) break;
    found = x;
  }
  return found && t - found.t <= 15 * 60_000 ? (found.v / 100) * DEMO_BATTERY.capacityKwh : null;
}

/** The plan right now (demo "now" rounded down to the hour). */
export function demoPlan(data: DemoData): DemoPlan | null {
  const from = Math.floor(data.now / HOUR) * HOUR;
  const soc = socAt(data, data.now);
  const input = soc === null ? null : planInput(data, from, soc);
  return input ? makePlan(input, DEMO_BATTERY, DEMO_CAR) : null;
}

export interface PlanCheck {
  start: number;
  plannedKwh: number; // first plan of the day (08:00)
  chargedKwh: number; // what the car got with hourly replanning
  possibleKwh: number; // with hindsight (actual PV and load), same rules, same day
  gridKwh: number; // grid import caused by the car until the end of the next day
  spreadKwh: number; // p90 − p10 of the single plans at 08:00
}

/**
 * Backtest with the same rules as live: from 08:00 to midnight, replan every hour from
 * data known then (battery state from the replay), charge only what the plan says for
 * the current hour, then replay the actual PV and load through the battery until the end
 * of the next day without further charging.
 */
export function backtestPlans(data: DemoData): PlanCheck[] {
  const tz = data.timeZone;
  const all = pastDays(data, data.now);
  const out: PlanCheck[] = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const day = all[i]!;
    const next = all[i + 1]!;
    if (next.start !== addDays(day.start, 1, tz)) continue;
    if (!Number.isFinite(day.factor) || !Number.isFinite(next.factor)) continue;
    const from = day.start + 8 * HOUR;
    const soc0 = socAt(data, from);
    if (soc0 === null) continue;
    const first = planInput(data, from, soc0);
    if (!first) continue;
    const firstPlan = makePlan(first, DEMO_BATTERY, DEMO_CAR);
    const hours = first.hours;
    const row = (t: number, which: 'pv' | 'load') => {
      const d = t < next.start ? day : next;
      return d[which][Math.round((t - d.start) / HOUR)] ?? 0;
    };
    const actual: Scenarios = {
      pv: [Float64Array.from(hours, (t) => row(t, 'pv'))],
      load: [Float64Array.from(hours, (t) => row(t, 'load'))],
    };
    const todayHours = hours.filter((t) => t < next.start).length;
    // Rolling execution: battery state from the replay of the actual day.
    const carKw = new Array<number>(hours.length).fill(0);
    let soc = soc0;
    let charged = 0;
    for (let k = 0; k < todayHours; k++) {
      const input = k === 0 ? first : planInput(data, hours[k]!, soc);
      const plan =
        k === 0
          ? firstPlan.plan
          : input &&
            greedyPlan(input.scenarios, DEMO_BATTERY, soc, {
              ...DEMO_CAR,
              chargedTodayKwh: charged,
            });
      carKw[k] = plan?.carKw[0] ?? 0;
      charged += carKw[k]!;
      soc = stepSoc(soc, row(hours[k]!, 'pv'), row(hours[k]!, 'load'), carKw[k]!, DEMO_BATTERY);
    }
    const zero = new Array<number>(hours.length).fill(0);
    const grid =
      simulate(actual, carKw, DEMO_BATTERY, soc0)[0]! -
      simulate(actual, zero, DEMO_BATTERY, soc0)[0]!;
    const possible = greedyPlan(actual, DEMO_BATTERY, soc0, DEMO_CAR, todayHours).kwh;
    out.push({
      start: day.start,
      plannedKwh: firstPlan.plan.kwh,
      chargedKwh: charged,
      possibleKwh: possible,
      gridKwh: Math.max(0, grid),
      spreadKwh: firstPlan.range[1] - firstPlan.range[0],
    });
  }
  return out;
}
