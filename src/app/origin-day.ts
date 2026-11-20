/**
 * "Where did the power come from today – hour by hour?" (Audit05 I-1): today
 * 00:00–24:00 on 15-minute slots from the house's power series, and from "now"
 * on the faint forecast (usual consumption of past days, sun forecast if the
 * house has one). Only the "now" page needs it.
 */
import type { DemoData } from '../demo/generate';
import { forecastStack, originSlots, originTotals, type OriginSlots } from '../model/origin';
import { quantile, toGrid } from '../model/series';
import { addDays, localMidnight } from '../model/time';

export const ORIGIN_STEP_MS = 15 * 60_000;

export interface OriginDay {
  from: number;
  to: number;
  stepMs: number;
  now: number;
  slots: OriginSlots;
  totals: ReturnType<typeof originTotals>;
  /** from "now" on: usual consumption and the part the sun forecast covers (kW) */
  forecast: {
    load: (number | null)[];
    sun: (number | null)[];
    days: number;
    withSun: boolean;
  } | null;
}

const grid = (data: DemoData, id: string, from: number, to: number) =>
  toGrid(data.series[id]?.samples ?? [], from, to, ORIGIN_STEP_MS);

/** Slots of one local day [from, to); slots that start after `until` stay empty. */
function slotsOf(data: DemoData, from: number, to: number, until = Infinity): OriginSlots {
  const cut = (v: (number | null)[]) =>
    v.map((x, i) => (from + i * ORIGIN_STEP_MS < until ? x : null));
  return originSlots(
    cut(grid(data, 'pv_power', from, to)),
    cut(grid(data, 'battery_power', from, to)),
    cut(grid(data, 'grid_power', from, to)),
    cut(grid(data, 'load_power', from, to)),
  );
}

/**
 * Usual consumption per slot: the median over up to 28 past days (only days
 * before today, never today against itself); a slot needs ≥ 3 days.
 */
export function usualLoad(
  data: DemoData,
  from: number,
  slots: number,
  maxDays = 28,
): { values: (number | null)[]; days: number } {
  const per: number[][] = Array.from({ length: slots }, () => []);
  let days = 0;
  for (let d = 1; d <= maxDays; d++) {
    const start = addDays(from, -d, data.timeZone);
    const end = addDays(start, 1, data.timeZone);
    const load = slotsOf(data, start, end).load;
    if (!load.some((v) => v !== null)) continue;
    days++;
    for (let i = 0; i < Math.min(slots, load.length); i++) {
      const v = load[i];
      if (v !== null && v !== undefined) per[i]!.push(v);
    }
  }
  return { values: per.map((v) => (v.length >= 3 ? quantile(v, 0.5) : null)), days };
}

/**
 * Today on slots. `sunForecastKw(t)` gives the sun forecast at a slot start
 * (kW) or null; without it only the usual consumption is drawn ahead.
 */
export function originToday(
  data: DemoData,
  sunForecastKw?: ((t: number) => number | null) | null,
): OriginDay | null {
  if (!data.series.pv_power || !data.series.battery_power) return null;
  const from = localMidnight(data.now, data.timeZone);
  const to = addDays(from, 1, data.timeZone);
  const slots = slotsOf(data, from, to, data.now);
  if (!slots.load.some((v) => v !== null)) return null;
  const n = slots.load.length;
  const usual = usualLoad(data, from, n);
  const ahead = (i: number) => from + (i + 1) * ORIGIN_STEP_MS > data.now;
  const load = usual.values.map((v, i) => (ahead(i) ? v : null));
  const sun = sunForecastKw
    ? load.map((_, i) => (ahead(i) ? sunForecastKw(from + i * ORIGIN_STEP_MS) : null))
    : null;
  const withSun = !!sun?.some((v) => v !== null);
  const fc = forecastStack(load, withSun ? sun : null);
  return {
    from,
    to,
    stepMs: ORIGIN_STEP_MS,
    now: data.now,
    slots,
    totals: originTotals(slots, ORIGIN_STEP_MS),
    forecast: load.some((v) => v !== null) ? { ...fc, days: usual.days, withSun } : null,
  };
}

/** Step function over forecast points (start time, step, kW): the value of the step a time falls in. */
export function stepLookup(
  at: number[],
  stepMs: number,
  values: (number | null)[],
): (t: number) => number | null {
  return (t) => {
    const k = at.findIndex((a) => t >= a && t < a + stepMs);
    return k < 0 ? null : (values[k] ?? null);
  };
}
