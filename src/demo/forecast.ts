/**
 * A deliberately simple day-ahead PV model for the demo, plus its honest
 * evaluation.
 *
 * - The forecast for a day is made the evening before (20:00 local), using
 *   only days that were complete at that moment: no look into the future.
 * - All forecasts share the same lead time, so the evaluation is fair.
 * - The forecast is checked against the meter reading, never against itself.
 */
import { estimate, freshFor, quantile, toGrid, valueAt } from '../model/series';
import type { Estimate, Forecast } from '../model/types';
import { addDays, dayStart, localDateKey, localHour, localMidnight } from '../model/time';
import { CLEAR_SKY_DAY_KWH, clearSkyPower, type DemoData } from './generate';
import { completeDays } from './views';
import { MIN_JUDGED_DAYS, wilson } from '../model/accuracy';

const HOUR = 3_600_000;
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
  return completeDays(data, 'pv_energy').map((d) => ({
    day: d.day,
    start: dayStart(d.day, data.timeZone),
  }));
}

/** Day-ahead forecasts for every complete day with enough history, plus today and tomorrow. */
export function dayAheadForecasts(data: DemoData): DayForecast[] {
  const days = completeDays(data, 'pv_energy');
  const starts = dayStarts(data);
  const todayStart = localMidnight(data.now, data.timeZone);
  const targets = [
    ...starts,
    { day: 'today', start: todayStart },
    { day: 'tomorrow', start: addDays(todayStart, 1, data.timeZone) },
  ];

  const out: DayForecast[] = [];
  for (const target of targets) {
    // 20:00 local the evening before; for tomorrow that moment has not come
    // yet, so the forecast is "as of now" (shorter history is not possible,
    // only the timestamp is honest).
    const createdAt = Math.min(target.start - 4 * HOUR, data.now);
    // Only days that ended before createdAt.
    const known = days
      .filter((_, i) => addDays(starts[i]!.start, 1, data.timeZone) <= createdAt)
      .slice(-WINDOW);
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
  const end = addDays(fc.start, 1, timeZone);
  for (let at = fc.start; at < end; at += stepMs) {
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
  const todayStart = localMidnight(data.now, data.timeZone);
  const targets = [
    ...starts,
    { day: 'today', start: todayStart },
    { day: 'tomorrow', start: addDays(todayStart, 1, data.timeZone) },
  ];
  const out: DailyForecast[] = [];
  for (const target of targets) {
    const createdAt = Math.min(target.start - 4 * HOUR, data.now);
    const known = days
      .filter((_, i) => addDays(starts[i]!.start, 1, data.timeZone) <= createdAt)
      .slice(-WINDOW);
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
/** Below this many checked days a share "correct" is no verdict yet (Audit02 P-06). */
export { MIN_JUDGED_DAYS, wilson } from '../model/accuracy';

export function accuracy(checks: DayCheck[]): {
  pct: number | null;
  n: number;
  history: (number | null)[];
  /** 95 % interval of the share correct, also while still open */
  interval: { low: number; high: number } | null;
} {
  const pct = (c: DayCheck[]) => (c.filter((x) => x.correct).length / c.length) * 100;
  const history = checks.map((_, i) =>
    i + 1 >= WINDOW ? pct(checks.slice(i + 1 - WINDOW, i + 1)) : null,
  );
  const k = checks.filter((x) => x.correct).length;
  return {
    pct: checks.length >= MIN_JUDGED_DAYS ? pct(checks) : null,
    n: checks.length,
    history,
    interval: checks.length ? wilson(k, checks.length) : null,
  };
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
  const todayStart = localMidnight(data.now, data.timeZone);
  return Array.from({ length: 7 }, (_, offset) => {
    const c = 0.2 + 0.8 * rand();
    const value = CLEAR_SKY_DAY_KWH * c;
    return {
      offset,
      start: addDays(todayStart, offset, data.timeZone),
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
 * day: today · week/month: last 7/30 days · span1/span: one or three days
 * back to one or three days ahead, hourly
 */
export type Period = 'day' | 'week' | 'month' | 'span1' | 'span';

/**
 * Daily kWh of an hourly forecast series (kW per hour, stored at the hour's
 * start) on one local day; null when fewer than 20 hours are there.
 */
function dayKwh(data: DemoData, id: string, start: number): number | null {
  const s = data.series[id];
  if (!s?.samples.length) return null;
  const end = addDays(start, 1, data.timeZone);
  const unit = data.entities.find((e) => e.id === id)?.unit;
  const f = unit === 'W' ? 0.001 : 1;
  let sum = 0;
  let n = 0;
  for (const p of s.samples) {
    if (p.t < start || p.t >= end) continue;
    sum += p.v * f;
    n++;
  }
  return n >= 20 ? sum : null;
}

function houseDays(data: DemoData, todayStart: number, count: number): PvSeries | null {
  if (!data.series.pv_forecast?.samples.length) return null;
  const byDay = new Map(completeDays(data, 'pv_energy').map((d) => [d.day, d.value]));
  const x: number[] = [];
  const actual: (number | null)[] = [];
  const forecast: (number | null)[] = [];
  const recomputed: (number | null)[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const start = addDays(todayStart, -k, data.timeZone);
    x.push(start + 12 * HOUR);
    actual.push(k === 0 ? null : (byDay.get(localDateKey(start, data.timeZone)) ?? null));
    const real = dayKwh(data, 'pv_forecast', start);
    forecast.push(real);
    recomputed.push(real === null ? dayKwh(data, 'pv_forecast_recomputed', start) : null);
  }
  if (forecast.every((v) => v === null) && recomputed.every((v) => v === null)) return null;
  const none = x.map(() => null);
  return { kind: 'houseDays', x, actual, forecast, recomputed, low: none, high: none, unit: 'kWh' };
}

export interface PvSeries {
  /**
   * What the forecast line is: the built-in rule of thumb (median of the last
   * seven days), the house's own forecast made the evening before, or that
   * and – ahead – the house's newest run.
   */
  kind: 'rule' | 'house' | 'houseSpan' | 'houseDays';
  x: number[];
  actual: (number | null)[];
  forecast: (number | null)[];
  low: (number | null)[];
  high: (number | null)[];
  /** houseDays: days whose forecast was computed afterwards (weather of back then) */
  recomputed?: (number | null)[];
  unit: 'kW' | 'kWh';
}

/**
 * An hourly PV forecast stored by the house itself (series `pv_forecast`,
 * optional `pv_forecast_low` / `pv_forecast_high` for the 10–90 % span), each
 * value the mean power of the hour that starts at its time. Drawn through the
 * hour middles onto the slots `x`; null when the house has no such forecast
 * for these slots.
 */
export function hourlyPvForecast(
  data: DemoData,
  x: number[],
  id = 'pv_forecast',
): { value: (number | null)[]; low: (number | null)[]; high: (number | null)[] } | null {
  const toKw = (id: string) => {
    const unit = data.entities.find((e) => e.id === id)?.unit;
    return unit === 'kW' ? 1 : unit === 'W' ? 0.001 : null;
  };
  const curve = (id: string): (number | null)[] | null => {
    const s = data.series[id];
    const f = toKw(id);
    if (!s?.samples.length || f === null) return null;
    const mid = s.samples
      .map((p) => ({ t: p.t + HOUR / 2, v: p.v * f }))
      .filter((p) => p.t >= x[0]! - HOUR && p.t <= x.at(-1)! + HOUR)
      .sort((a, b) => a.t - b.t);
    if (mid.length < 2) return null;
    return x.map((t) => {
      if (t < mid[0]!.t - HOUR / 2 || t > mid.at(-1)!.t + HOUR / 2) return null;
      const j = mid.findIndex((p) => p.t >= t);
      if (j <= 0) return j === 0 ? mid[0]!.v : mid.at(-1)!.v;
      const a = mid[j - 1]!;
      const b = mid[j]!;
      // a missing hour stays a gap instead of a straight bridge
      if (b.t - a.t > 1.5 * HOUR) return null;
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    });
  };
  const value = curve(id);
  if (!value || value.every((v) => v === null)) return null;
  const low = curve(`${id}_low`) ?? x.map(() => null);
  const high = curve(`${id}_high`) ?? x.map(() => null);
  return { value, low, high };
}

/**
 * PV actual and day-ahead forecast for a period.
 * - day: power in kW, 15-min steps (actual until now, forecast for the whole day)
 * - week/month: daily energy in kWh from the meter; today is still running, so
 *   it has a forecast but no actual yet.
 */
export function pvTimeSeries(data: DemoData, period: Period): PvSeries {
  const todayStart = localMidnight(data.now, data.timeZone);
  const forecasts = dayAheadForecasts(data);

  if (period === 'day') {
    const step = 15 * 60_000;
    const to = addDays(todayStart, 1, data.timeZone);
    const x: number[] = [];
    for (let t = todayStart; t < to; t += step) x.push(t);
    const actualW = toGrid(data.series.pv_power!.samples, todayStart, to, step);
    const today = forecasts.find((f) => f.start === todayStart);
    const fc = new Map((today ? powerCurve(today, data.timeZone, step) : []).map((f) => [f.at, f]));
    const kw = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 1000);
    // the house's own hourly forecast wins over the spread-out daily one
    const hourly = hourlyPvForecast(data, x);
    if (hourly) {
      return {
        kind: 'house',
        x,
        actual: actualW.map((v, i) => (x[i]! < data.now ? kw(v) : null)),
        forecast: hourly.value,
        low: hourly.low,
        high: hourly.high,
        unit: 'kW',
      };
    }
    return {
      kind: 'rule',
      x,
      actual: actualW.map((v, i) => (x[i]! < data.now ? kw(v) : null)),
      forecast: x.map((t) => kw(fc.get(t)?.value)),
      low: x.map((t) => kw(fc.get(t)?.low)),
      high: x.map((t) => kw(fc.get(t)?.high)),
      unit: 'kW',
    };
  }

  if (period === 'span') return pvSpan(data, todayStart, forecasts, 3);
  if (period === 'span1') return pvSpan(data, todayStart, forecasts, 1);

  const count = period === 'week' ? 7 : 30;

  // Days: the house's own forecast where it exists (evening before; days
  // computed afterwards on their own dashed line), else the rule of thumb.
  const house = houseDays(data, todayStart, count);
  if (house) return house;

  const byDay = new Map(completeDays(data, 'pv_energy').map((d) => [d.day, d.value]));
  const x: number[] = [];
  const actual: (number | null)[] = [];
  const forecast: (number | null)[] = [];
  const low: (number | null)[] = [];
  const high: (number | null)[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const start = addDays(todayStart, -k, data.timeZone);
    x.push(start + 12 * HOUR);
    // Today is still running: forecast yes, actual not yet.
    actual.push(k === 0 ? null : (byDay.get(localDateKey(start, data.timeZone)) ?? null));
    const f = forecasts.find((d) => d.start === start);
    forecast.push(f ? f.energy.value : null);
    low.push(f ? f.energy.low : null);
    high.push(f ? f.energy.high : null);
  }
  return { kind: 'rule', x, actual, forecast, low, high, unit: 'kWh' };
}

/**
 * Three days back to three days ahead, hourly: actual power until now; the
 * forecast made the evening before for each hour where the house has it
 * (`pv_forecast`), else its newest run (`pv_forecast_latest`) – so the days
 * ahead show the freshest forecast. Without house forecasts: the built-in
 * daily forecast spread over its days.
 */
function pvSpan(
  data: DemoData,
  todayStart: number,
  forecasts: ReturnType<typeof dayAheadForecasts>,
  days: number,
): PvSeries {
  const from = addDays(todayStart, -days, data.timeZone);
  const to = addDays(todayStart, days + 1, data.timeZone);
  const x: number[] = [];
  for (let t = from; t < to; t += HOUR) x.push(t);
  const kw = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 1000);
  const actual = toGrid(data.series.pv_power!.samples, from, to, HOUR).map((v, i) =>
    x[i]! + HOUR <= data.now ? kw(v) : null,
  );
  // house values are means of the hour: read them at the hour middle, like the actual grid
  const mid = x.map((t) => t + HOUR / 2);
  const evening = hourlyPvForecast(data, mid);
  const latest = hourlyPvForecast(data, mid, 'pv_forecast_latest');
  if (evening || latest) {
    // past hours: only a forecast really made the evening before (never a later run)
    const pick = (k: 'value' | 'low' | 'high') =>
      x.map((t, i) => evening?.[k][i] ?? (t + HOUR > data.now ? (latest?.[k][i] ?? null) : null));
    return {
      kind: 'houseSpan',
      x,
      actual,
      forecast: pick('value'),
      low: pick('low'),
      high: pick('high'),
      unit: 'kW',
    };
  }
  const fc = new Map(
    forecasts.flatMap((f) => powerCurve(f, data.timeZone, HOUR)).map((f) => [f.at, f]),
  );
  return {
    kind: 'rule',
    x,
    actual,
    forecast: x.map((t) => kw(fc.get(t)?.value)),
    low: x.map((t) => kw(fc.get(t)?.low)),
    high: x.map((t) => kw(fc.get(t)?.high)),
    unit: 'kW',
  };
}
