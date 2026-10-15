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
import { reportedSamples } from '../model/series';
import { readSky, type Sky } from '../model/sky';
import { addDays, localDateKey, localMidnight } from '../model/time';

export interface WeatherDay {
  offset: number;
  start: number;
  measured: boolean;
  /** where the past values come from */
  source?: { temp: 'sensor' | 'model'; sun: 'pv' | 'model'; rain: 'model' };
  /** past days: the sky read from the PV curve */
  sky?: Sky;
  clarity?: number;
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

/**
 * High and low of a day from the house's outdoor sensor (`outdoor_temp`), if
 * it reported over the day (from before 06:00 to after 18:00, at least six
 * reports – a sensor that sends on change reports seldom when it is calm).
 * Only real reports count, never values held forward (N-03).
 */
export function sensorHighLow(
  data: DemoData,
  start: number,
  end: number,
): { high: number; low: number } | null {
  const s = reportedSamples(data.series.outdoor_temp).filter((x) => x.t >= start && x.t < end);
  if (s.length < 6) return null;
  if (s[0]!.t > start + 6 * 3_600_000 || s.at(-1)!.t < start + 18 * 3_600_000) return null;
  return { high: Math.max(...s.map((x) => x.v)), low: Math.min(...s.map((x) => x.v)) };
}

export function weatherDays(
  data: DemoData,
  back = 3,
  ahead = 3,
  where: { lat: number; lon: number } | null = null,
): WeatherDay[] {
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
    // past days: own sensors first (outdoor sensor, PV), the weather model only where they are missing
    const end = addDays(start, 1, data.timeZone);
    const own = past ? sensorHighLow(data, start, end) : null;
    const read =
      past && data.series.pv_power?.samples.length
        ? readSky(
            data.series.pv_power.samples,
            Array.from({ length: 15 }, (_, j) => addDays(start, j - 14, data.timeZone)),
            where,
          )
        : null;
    const sunPv = read?.sunHours ?? null;
    out.push({
      offset: k,
      start,
      measured: past && (own !== null || onDay(data, 'weather_tmax_measured', start) !== null),
      ...(past
        ? {
            source: {
              temp: own ? ('sensor' as const) : ('model' as const),
              sun: sunPv !== null ? ('pv' as const) : ('model' as const),
              rain: 'model' as const,
            },
          }
        : {}),
      ...(read ? { sky: read.sky, clarity: read.clarity } : {}),
      tempHigh: own?.high ?? pick('weather_tmax'),
      tempLow: own?.low ?? pick('weather_tmin'),
      rainMm: pick('weather_rain'),
      sunHours: sunPv ?? pick('weather_sun'),
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
