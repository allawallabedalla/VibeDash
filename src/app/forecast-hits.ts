/**
 * "Day by day" view of a daily forecast (Audit05 I-6), kept out of the shared
 * demo module so the first page does not load it (budget).
 */
import { checkForecasts, type DailyForecast } from '../demo/forecast';
import type { DemoData } from '../demo/generate';
import { addDays, localDateKey, localMidnight } from '../model/time';

/** One day of the "day by day" chart (Audit05 I-6): forecast with its ranges and the meter's actual. */
export interface HitDay {
  day: string;
  /** Local midnight, UTC ms. */
  start: number;
  /** null: no forecast for that day (a gap stays a gap). */
  forecast: number | null;
  /** P10–P90 of the forecast (8 of 10 cases); null when the forecast has no span. */
  low: number | null;
  high: number | null;
  /** Meter yield; null for today (still running) or a meter gap. */
  actual: number | null;
  /** The same verdict as the accuracy card (checkForecasts, ±CORRECT_TOLERANCE); null = not judged. */
  correct: boolean | null;
  today: boolean;
}

/**
 * The last `count` days up to today with the evening-before forecast and the
 * actual. The verdict per day is taken from checkForecasts, so the chart and
 * the accuracy card count with one rule.
 */
export function forecastHitDays(
  data: DemoData,
  forecasts: DailyForecast[],
  count: number,
  counterId = 'pv_energy',
): HitDay[] {
  const checks = new Map(checkForecasts(data, forecasts, counterId).map((c) => [c.day, c]));
  const todayStart = localMidnight(data.now, data.timeZone);
  const out: HitDay[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const start = addDays(todayStart, -k, data.timeZone);
    const day = localDateKey(start, data.timeZone);
    const f = forecasts.find((x) => x.start === start);
    const c = k === 0 ? undefined : checks.get(day);
    const spread = f && f.energy.high > f.energy.low;
    out.push({
      day,
      start,
      forecast: f ? f.energy.value : null,
      low: spread ? f.energy.low : null,
      high: spread ? f.energy.high : null,
      actual: c ? c.actual : null,
      correct: c ? c.correct : null,
      today: k === 0,
    });
  }
  return out;
}

/**
 * Counts for the chart head: k of n judged days correct (the card's rule) and,
 * separately named, how often the actual lay inside P10–P90 (should be ≈ 8 of 10).
 */
export function hitCounts(days: HitDay[]): { k: number; n: number; inSpan: number; nSpan: number } {
  const judged = days.filter((d) => d.correct !== null);
  const spanned = judged.filter((d) => d.low !== null && d.high !== null);
  return {
    k: judged.filter((d) => d.correct).length,
    n: judged.length,
    inSpan: spanned.filter((d) => d.actual! >= d.low! && d.actual! <= d.high!).length,
    nSpan: spanned.length,
  };
}
