/**
 * Weather days from the house's own series (e.g. a weather station plus its
 * forecast): three measured days, today, three forecast days, each with the
 * solar yield – measured from the meter, expected from a daily PV forecast.
 *
 * Series (all optional, one value per local day, time = local midnight):
 * weather_tmax / weather_tmin / weather_rain / weather_sun (forecast) and the
 * same with `_measured`; pv_forecast_day with pv_forecast_day_low / _high.
 */
import { daily, type DemoData } from '../demo';
import { addDays, localDateKey, localMidnight } from '../model/time';

export interface WeatherDay {
  offset: number;
  start: number;
  measured: boolean;
  tempHigh: number | null;
  tempLow: number | null;
  rainMm: number | null;
  sunHours: number | null;
  /** Yield: measured (past), expected with span (today, ahead), so far (today). */
  pv: { value: number; low?: number; high?: number; approx: boolean } | null;
  pvSoFar: number | null;
}

const DAY = 86_400_000;

function onDay(data: DemoData, id: string, start: number): number | null {
  const s = data.series[id]?.samples;
  if (!s) return null;
  // the value of a day carries its local midnight; allow a little drift
  const hit = s.find((p) => p.t >= start - 3 * 3_600_000 && p.t < start + DAY - 3 * 3_600_000);
  return hit ? hit.v : null;
}

export function hasWeatherDays(data: DemoData): boolean {
  return Boolean(data.series.weather_tmax?.samples.length);
}

export function weatherDays(data: DemoData, back = 3, ahead = 3): WeatherDay[] {
  const today = localMidnight(data.now, data.timeZone);
  const meter = data.series.pv_energy?.samples.length
    ? new Map(daily(data, 'pv_energy').map((d) => [d.day, d.value]))
    : new Map<string, number>();
  const out: WeatherDay[] = [];
  for (let k = -back; k <= ahead; k++) {
    const start = addDays(today, k, data.timeZone);
    const past = k < 0;
    const pick = (name: string) =>
      (past ? onDay(data, `${name}_measured`, start) : null) ?? onDay(data, name, start);
    const fc = onDay(data, 'pv_forecast_day', start);
    const got = meter.get(localDateKey(start, data.timeZone)) ?? null;
    out.push({
      offset: k,
      start,
      measured: past && onDay(data, 'weather_tmax_measured', start) !== null,
      tempHigh: pick('weather_tmax'),
      tempLow: pick('weather_tmin'),
      rainMm: pick('weather_rain'),
      sunHours: pick('weather_sun'),
      pv: past
        ? got === null
          ? null
          : { value: got, approx: false }
        : fc === null
          ? null
          : {
              value: fc,
              low: onDay(data, 'pv_forecast_day_low', start) ?? undefined,
              high: onDay(data, 'pv_forecast_day_high', start) ?? undefined,
              approx: true,
            },
      pvSoFar: k === 0 ? got : null,
    });
  }
  return out;
}
