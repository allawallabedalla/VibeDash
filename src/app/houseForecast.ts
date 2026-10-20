/**
 * The house's own day-ahead PV forecast as daily forecasts, for judging it on
 * the forecasts page (kept out of the first page: only that page loads it).
 */
import type { DemoData } from '../demo/generate';
import type { DailyForecast } from '../demo/forecast';
import { localDateKey, localMidnight } from '../model/time';

const HOUR = 3_600_000;

/**
 * The house's own day-ahead PV forecasts (series pv_forecast_day, optional
 * _low/_high; one value per day at local midnight, made the evening before).
 * Empty when the house has none – then the built-in rule is judged instead.
 * G-13: the forecast shown is the one that is judged.
 */
export function houseDayForecasts(data: DemoData): DailyForecast[] {
  const s = data.series.pv_forecast_day?.samples ?? [];
  const at = (id: string, t: number) => data.series[id]?.samples.find((p) => p.t === t)?.v;
  return s.map((p) => {
    const start = localMidnight(p.t + 3 * HOUR, data.timeZone);
    return {
      day: localDateKey(start, data.timeZone),
      start,
      createdAt: start - 4 * HOUR,
      energy: {
        value: p.v,
        low: at('pv_forecast_day_low', p.t) ?? p.v,
        high: at('pv_forecast_day_high', p.t) ?? p.v,
        n: 0,
      },
    };
  });
}
