/**
 * The 48-hour charge outlook (Audit05 I-5) from the house's own data: its hourly sun
 * forecast (newest run first, the one made the evening before second, the built-in
 * rule of thumb last), the usual house load of the last 14 days, the planner's charge
 * windows and the battery path computed from these. Read-only, nothing is switched.
 */
import { dayAheadForecasts, hourlyPvForecast, powerCurve, type DemoData } from '../demo';
import {
  batteryPath,
  hourlyFromBlocks,
  outlookHours,
  usualLoad,
  type TimeBlock,
} from '../model/charge-outlook';
import { socFloor } from '../model/reach';
import { localHour } from '../model/time';
import { batteryCapacityKwh, freshValue } from './tiles';

const HOUR = 3_600_000;
type Vals = (number | null)[];

export interface HouseOutlook {
  hours: number[];
  pv: { p10: Vals; p50: Vals; p90: Vals };
  load: Vals;
  /** days behind the usual load */
  nLoad: number;
  car: number[];
  soc: { p10: Vals; p50: Vals; p90: Vals } | null;
  floorPct: number | undefined;
}

/** The sun per hour ahead: the house's forecast with the most of value + band, else the rule of thumb. */
export function sunAhead(data: DemoData, hours: number[]): HouseOutlook['pv'] {
  const mids = hours.map((h) => h + HOUR / 2);
  const runs = ['pv_forecast_latest', 'pv_forecast']
    .map((id) => hourlyPvForecast(data, mids, id))
    .filter((r) => r !== null)
    .map((r) => ({
      r,
      score:
        r.value.filter((v) => v !== null).length * 2 +
        r.low.filter((v, i) => v !== null && r.high[i] !== null).length,
    }))
    .sort((a, b) => b.score - a.score);
  const best = runs[0]?.r;
  if (best) return { p10: best.low, p50: best.value, p90: best.high };
  const fc = new Map(
    dayAheadForecasts(data)
      .flatMap((f) => powerCurve(f, data.timeZone, HOUR))
      .map((f) => [f.at, f]),
  );
  const kw = (v: number | undefined) => (v === undefined ? null : v / 1000);
  return {
    p10: hours.map((h) => kw(fc.get(h)?.low)),
    p50: hours.map((h) => kw(fc.get(h)?.value)),
    p90: hours.map((h) => kw(fc.get(h)?.high)),
  };
}

export function houseOutlook(
  data: DemoData,
  blocks: readonly TimeBlock[],
  fallbackKw: number,
): HouseOutlook {
  const tz = data.timeZone;
  const hours = outlookHours(data.now);
  const pv = sunAhead(data, hours);
  const hourOf = (t: number) => Math.floor(localHour(t, tz));
  const usual = usualLoad(data.series.load_power?.samples ?? [], null, data.now, hourOf);
  const load = hours.map((h) => usual.kw[hourOf(h)] ?? null);
  const car = hourlyFromBlocks(hours, blocks, fallbackKw);
  const socNow = freshValue(data, 'battery_soc');
  const cap = batteryCapacityKwh(data);
  if (socNow === null || cap === null) {
    return { hours, pv, load, nLoad: usual.n, car, soc: null, floorPct: undefined };
  }
  const floor = socFloor(data.series.battery_soc?.samples ?? [], data.now).pct;
  const path = (sun: Vals) =>
    sun.some((v) => v !== null)
      ? batteryPath(socNow, cap, floor, sun, load, car)
      : hours.map(() => null);
  // little sun → the lowest battery: the 10 % sun case is the lower edge
  return {
    hours,
    pv,
    load,
    nLoad: usual.n,
    car,
    soc: { p10: path(pv.p10), p50: path(pv.p50), p90: path(pv.p90) },
    floorPct: floor,
  };
}
