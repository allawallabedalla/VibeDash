/**
 * A deliberately simple day-ahead PV model for the demo, plus its honest
 * evaluation.
 *
 * - The forecast for a day is made the evening before (20:00 local), using
 *   only days that were complete at that moment: no look into the future.
 * - All forecasts share the same lead time, so the evaluation is fair.
 * - The forecast is checked against the meter reading, never against itself.
 */
import { estimate, quantile, toGrid, valueAt } from '../model/series';
import type { Estimate, Forecast } from '../model/types';
import { localHour } from '../model/time';
import { CLEAR_SKY_DAY_KWH, clearSkyPower, type DemoData } from './generate';
import { completeDays } from './views';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Days of history the model looks at. */
const WINDOW = 7;
/** A day counts as "correct" if the actual yield is within ±20 % of the forecast. */
export const CORRECT_TOLERANCE = 0.2;

export interface DailyForecast {
  day: string;
  /** Local midnight of the forecast day, UTC ms. */
  start: number;
  createdAt: number;
  energy: Estimate;
}

export interface DayForecast extends DailyForecast {
  /** Clear-sky factor quantiles used for the power curve. */
  factor: { value: number; low: number; high: number };
}

export interface DayCheck {
  day: string;
  forecast: number;
  actual: number;
  correct: boolean;
}

/** Local midnight (UTC ms) of each complete day, from the first sample onward. */
function dayStarts(data: DemoData): { day: string; start: number }[] {
  // Demo period has no DST switch: local midnight = 22:00 UTC the day before.
  const days = completeDays(data, 'pv_energy');
  const lastStart = data.now - 14 * HOUR; // today 00:00 local
  return days.map((d, i) => ({ day: d.day, start: lastStart - (days.length - i) * DAY }));
}

/** Day-ahead forecasts for every complete day with enough history, plus today and tomorrow. */
export function dayAheadForecasts(data: DemoData): DayForecast[] {
  const days = completeDays(data, 'pv_energy');
  const starts = dayStarts(data);
  const todayStart = data.now - 14 * HOUR;
  const targets = [
    ...starts,
    { day: 'today', start: todayStart },
    { day: 'tomorrow', start: todayStart + DAY },
  ];

  const out: DayForecast[] = [];
  for (const target of targets) {
    // 20:00 local the evening before; for tomorrow that moment has not come
    // yet, so the forecast is "as of now" (shorter history is not possible,
    // only the timestamp is honest).
    const createdAt = Math.min(target.start - 4 * HOUR, data.now);
    // Only days that ended before createdAt.
    const known = days.filter((_, i) => starts[i]!.start + DAY <= createdAt).slice(-WINDOW);
    if (known.length < WINDOW) continue;
    const factors = known.map((d) => d.value / CLEAR_SKY_DAY_KWH);
    const f = {
      value: quantile(factors, 0.5),
      low: quantile(factors, 0.1),
      high: quantile(factors, 0.9),
    };
    out.push({
      day: target.day,
      start: target.start,
      createdAt,
      energy: {
        value: f.value * CLEAR_SKY_DAY_KWH,
        low: f.low * CLEAR_SKY_DAY_KWH,
        high: f.high * CLEAR_SKY_DAY_KWH,
        n: known.length,
      },
      factor: f,
    });
  }
  return out;
}

/** Power forecast curve (W) for one day on a fixed step. */
export function powerCurve(fc: DayForecast, timeZone: string, stepMs = 15 * 60_000): Forecast[] {
  const out: Forecast[] = [];
  for (let at = fc.start; at < fc.start + DAY; at += stepMs) {
    const clear = clearSkyPower(localHour(at, timeZone));
    out.push({
      at,
      createdAt: fc.createdAt,
      leadMs: at - fc.createdAt,
      value: clear * fc.factor.value,
      low: clear * fc.factor.low,
      high: clear * fc.factor.high,
    });
  }
  return out;
}

/** Compare each past day-ahead forecast with the meter reading. */
export function checkForecasts(
  data: DemoData,
  forecasts: DailyForecast[] = dayAheadForecasts(data),
  counterId = 'pv_energy',
): DayCheck[] {
  const actual = new Map(completeDays(data, counterId).map((d) => [d.day, d.value]));
  return forecasts
    .filter((f) => actual.has(f.day))
    .map((f) => {
      const a = actual.get(f.day)!;
      return {
        day: f.day,
        forecast: f.energy.value,
        actual: a,
        correct: Math.abs(a - f.energy.value) <= CORRECT_TOLERANCE * f.energy.value,
      };
    });
}

/**
 * Day-ahead forecast of the house's daily consumption: median of the last 7
 * complete days, made the evening before. Same rules as the PV model.
 */
export function dayAheadLoad(data: DemoData): DailyForecast[] {
  const days = completeDays(data, 'load_energy');
  const starts = dayStarts(data);
  const todayStart = data.now - 14 * HOUR;
  const targets = [
    ...starts,
    { day: 'today', start: todayStart },
    { day: 'tomorrow', start: todayStart + DAY },
  ];
  const out: DailyForecast[] = [];
  for (const target of targets) {
    const createdAt = Math.min(target.start - 4 * HOUR, data.now);
    const known = days.filter((_, i) => starts[i]!.start + DAY <= createdAt).slice(-WINDOW);
    if (known.length < WINDOW) continue;
    out.push({
      day: target.day,
      start: target.start,
      createdAt,
      energy: estimate(known.map((d) => d.value)),
    });
  }
  return out;
}

/** Share of correct days (0–100) overall and as a rolling 7-day trend; null while n < 7. */
export function accuracy(checks: DayCheck[]): {
  pct: number | null;
  n: number;
  history: (number | null)[];
} {
  const pct = (c: DayCheck[]) => (c.filter((x) => x.correct).length / c.length) * 100;
  const history = checks.map((_, i) =>
    i + 1 >= WINDOW ? pct(checks.slice(i + 1 - WINDOW, i + 1)) : null,
  );
  return { pct: checks.length >= WINDOW ? pct(checks) : null, n: checks.length, history };
}

/** Ratio actual / forecast over past days, as a range for new forecasts. */
export function errorRange(checks: DayCheck[]): Estimate {
  return estimate(checks.map((c) => c.actual / c.forecast));
}

export interface OutlookDay {
  offset: number;
  start: number;
  sky: 'sun' | 'cloudSun' | 'cloud' | 'rain';
  tempLow: number;
  tempHigh: number;
  rainMm: number;
  sunHours: number;
  energy: Estimate;
}

/**
 * Synthetic 7-day weather outlook (made up, seeded) with the PV yield it
 * implies; the range comes from how far past forecasts were off.
 */
export function outlook(data: DemoData, rand: () => number): OutlookDay[] {
  const range = errorRange(checkForecasts(data));
  const todayStart = data.now - 14 * HOUR;
  return Array.from({ length: 7 }, (_, offset) => {
    const c = 0.2 + 0.8 * rand();
    const value = CLEAR_SKY_DAY_KWH * c;
    return {
      offset,
      start: todayStart + offset * DAY,
      sky: c > 0.8 ? 'sun' : c > 0.55 ? 'cloudSun' : c > 0.35 ? 'cloud' : 'rain',
      tempLow: Math.round(11 + 4 * c + rand() * 2),
      tempHigh: Math.round(18 + 10 * c + rand() * 2),
      rainMm: c > 0.35 ? 0 : Math.round((1 - c) * 9 * 10) / 10,
      sunHours: Math.round(15.5 * c * 0.85 * 10) / 10,
      energy: { value, low: value * range.low, high: value * range.high, n: range.n },
    };
  });
}

/**
 * Where the house's power comes from at time t: sun, battery, grid (W).
 * Returns null if a sensor was silent at t: a gap is not "unchanged".
 */
export function sourcesAt(
  data: DemoData,
  t: number,
): { sun: number; battery: number; grid: number; total: number } | null {
  const at = (id: string): number | null => {
    const series = data.series[id]!;
    const s = valueAt(series.samples, t);
    return s && t - s.t <= series.stepMs * 2.5 ? s.v : null;
  };
  const load = at('load_power');
  const pv = at('pv_power');
  const bat = at('battery_power');
  if (load === null || pv === null || bat === null) return null;
  const sun = Math.min(pv, load);
  const battery = Math.min(Math.max(-bat, 0), load - sun);
  const grid = Math.max(load - sun - battery, 0);
  return { sun, battery, grid, total: load };
}

export type Period = 'day' | 'week' | 'month';

export interface PvSeries {
  x: number[];
  actual: (number | null)[];
  forecast: (number | null)[];
  low: (number | null)[];
  high: (number | null)[];
  unit: 'kW' | 'kWh';
}

/**
 * PV actual and day-ahead forecast for a period.
 * - day: power in kW, 15-min steps (actual until now, forecast for the whole day)
 * - week/month: daily energy in kWh from the meter; today is still running, so
 *   it has a forecast but no actual yet.
 */
export function pvTimeSeries(data: DemoData, period: Period): PvSeries {
  const todayStart = data.now - 14 * HOUR;
  const forecasts = dayAheadForecasts(data);

  if (period === 'day') {
    const step = 15 * 60_000;
    const to = todayStart + DAY;
    const x: number[] = [];
    for (let t = todayStart; t < to; t += step) x.push(t);
    const actualW = toGrid(data.series.pv_power!.samples, todayStart, to, step);
    const today = forecasts.find((f) => f.start === todayStart);
    const fc = new Map((today ? powerCurve(today, data.timeZone, step) : []).map((f) => [f.at, f]));
    const kw = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 1000);
    return {
      x,
      actual: actualW.map((v, i) => (x[i]! < data.now ? kw(v) : null)),
      forecast: x.map((t) => kw(fc.get(t)?.value)),
      low: x.map((t) => kw(fc.get(t)?.low)),
      high: x.map((t) => kw(fc.get(t)?.high)),
      unit: 'kW',
    };
  }

  const count = period === 'week' ? 7 : 30;
  const days = completeDays(data, 'pv_energy');
  const x: number[] = [];
  const actual: (number | null)[] = [];
  const forecast: (number | null)[] = [];
  const low: (number | null)[] = [];
  const high: (number | null)[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const start = todayStart - k * DAY;
    x.push(start + 12 * HOUR);
    // completeDays ends yesterday; index from the end.
    actual.push(k === 0 ? null : (days[days.length - k]?.value ?? null));
    const f = forecasts.find((d) => d.start === start);
    forecast.push(f ? f.energy.value : null);
    low.push(f ? f.energy.low : null);
    high.push(f ? f.energy.high : null);
  }
  return { x, actual, forecast, low, high, unit: 'kWh' };
}
