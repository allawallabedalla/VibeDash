/**
 * Open-Meteo (weather forecast, no API key). External access: only the rounded
 * location (about 1 km) leaves the house. On by default, `WEATHER=off` disables.
 */
import type { FetchLike } from './influx1';

export interface Location {
  lat: number;
  lon: number;
}

export interface WeatherDay {
  /** Local date YYYY-MM-DD */
  tag: string;
  sonneH: number | null;
  strahlungMj: number | null;
  tMin: number | null;
  tMax: number | null;
  regenMm: number | null;
}

export class WeatherError extends Error {}

/** Round to 2 decimals (about 1 km) before anything leaves the house. */
export function roundLocation(l: Location): Location {
  return { lat: Math.round(l.lat * 100) / 100, lon: Math.round(l.lon * 100) / 100 };
}

export function validLocation(l: unknown): l is Location {
  const x = l as Location;
  return (
    typeof x === 'object' &&
    x !== null &&
    Number.isFinite(x.lat) &&
    Number.isFinite(x.lon) &&
    Math.abs(x.lat) <= 90 &&
    Math.abs(x.lon) <= 180
  );
}

const DAILY = [
  'sunshine_duration',
  'shortwave_radiation_sum',
  'temperature_2m_min',
  'temperature_2m_max',
  'precipitation_sum',
] as const;

export function forecastUrl(l: Location, timeZone: string, days = 7): string {
  const r = roundLocation(l);
  const p = new URLSearchParams({
    latitude: String(r.lat),
    longitude: String(r.lon),
    daily: DAILY.join(','),
    timezone: timeZone,
    forecast_days: String(days),
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export function parseForecast(body: unknown): WeatherDay[] {
  const daily = (body as { daily?: Record<string, unknown[]> })?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new WeatherError('unexpected forecast response');
  const num = (key: string, i: number): number | null => {
    const v = daily[key]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return daily.time.map((t, i) => {
    const sun = num('sunshine_duration', i);
    return {
      tag: String(t),
      sonneH: sun === null ? null : Math.round((sun / 3600) * 10) / 10,
      strahlungMj: num('shortwave_radiation_sum', i),
      tMin: num('temperature_2m_min', i),
      tMax: num('temperature_2m_max', i),
      regenMm: num('precipitation_sum', i),
    };
  });
}

export function geocodeUrl(place: string, language: string): string {
  const p = new URLSearchParams({ name: place, count: '1', language, format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${p}`;
}

export function parseGeocode(body: unknown): (Location & { name: string }) | null {
  const r = (body as { results?: { name?: string; latitude?: number; longitude?: number }[] })
    ?.results?.[0];
  if (!r || !validLocation({ lat: r.latitude, lon: r.longitude })) return null;
  return { ...roundLocation({ lat: r.latitude!, lon: r.longitude! }), name: String(r.name ?? '') };
}

/** Client with timeout and a small cache (weather changes slowly). */
export function weatherClient(fetchFn: FetchLike, timeoutMs = 10_000, cacheMs = 3_600_000) {
  const cache = new Map<string, { at: number; days: WeatherDay[] }>();
  async function getJson(url: string): Promise<unknown> {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new WeatherError(`HTTP ${res.status}`);
    return res.json();
  }
  return {
    async forecast(l: Location, timeZone: string, now = Date.now()): Promise<WeatherDay[]> {
      const url = forecastUrl(l, timeZone);
      const hit = cache.get(url);
      if (hit && now - hit.at < cacheMs) return hit.days;
      const days = parseForecast(await getJson(url));
      cache.set(url, { at: now, days });
      return days;
    },
    async geocode(place: string, language: string) {
      return parseGeocode(await getJson(geocodeUrl(place, language)));
    },
  };
}

/** A roof plane in the Open-Meteo convention (azimuth 0 = south, -90 = east, 90 = west). */
export interface RoofPlane {
  name: string;
  tilt: number;
  azimuth: number;
  kwp: number;
}

/** Hourly irradiance on a tilted plane (W/m², hour start in UTC ms). */
export interface HourValue {
  t: number;
  v: number;
}

/**
 * GTI forecast for one roof plane. `archive`: the day-ahead forecasts of the
 * past days (Previous Runs API, `previous_day1`) – what was known about each
 * hour about one day earlier, for an honest backtest.
 */
export function gtiUrl(l: Location, plane: RoofPlane, archive: boolean, pastDays = 60): string {
  const r = roundLocation(l);
  const p = new URLSearchParams({
    latitude: String(r.lat),
    longitude: String(r.lon),
    hourly: archive ? 'global_tilted_irradiance_previous_day1' : 'global_tilted_irradiance',
    tilt: String(plane.tilt),
    azimuth: String(plane.azimuth),
    timezone: 'GMT',
    ...(archive ? { past_days: String(pastDays), forecast_days: '1' } : { forecast_days: '3' }),
  });
  const host = archive ? 'https://previous-runs-api.open-meteo.com' : 'https://api.open-meteo.com';
  return `${host}/v1/forecast?${p}`;
}

export function parseHourly(body: unknown, key: string): HourValue[] {
  const hourly = (body as { hourly?: Record<string, unknown[]> })?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) throw new WeatherError('unexpected hourly response');
  const out: HourValue[] = [];
  hourly.time.forEach((time, i) => {
    const v = hourly[key]?.[i];
    // timezone=GMT: times come without offset and are UTC
    const t = Date.parse(`${String(time)}:00Z`);
    if (Number.isFinite(t) && typeof v === 'number' && Number.isFinite(v)) out.push({ t, v });
  });
  return out;
}

export async function fetchGti(
  fetchFn: FetchLike,
  l: Location,
  plane: RoofPlane,
  archive: boolean,
  timeoutMs = 10_000,
): Promise<HourValue[]> {
  const res = await fetchFn(gtiUrl(l, plane, archive), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new WeatherError(`HTTP ${res.status}`);
  return parseHourly(
    await res.json(),
    archive ? 'global_tilted_irradiance_previous_day1' : 'global_tilted_irradiance',
  );
}
