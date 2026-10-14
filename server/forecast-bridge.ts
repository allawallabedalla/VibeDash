/**
 * Bridge to the forecasting service (Python, ANLEITUNG.md section 11). The
 * service sits behind this server; the browser never talks to it.
 *
 * Every hour: send complete days (from meter readings, local days) and the
 * weather forecast for coming days as features *known in advance*. The
 * service keeps the first scheduled forecast per day and evaluates it later.
 */
import type { FetchLike } from '../src/adapters/influx1';
import type { WeatherDay } from '../src/adapters/openmeteo';
import { dailyFromCounter } from '../src/model/series';
import { localDateKey } from '../src/model/time';
import type { Series } from '../src/model/types';
import type { ForecastMapping, Mapping, SeriesMapping } from './mapping';

export interface BridgeDeps {
  url: string;
  mapping: Mapping;
  fetchFn: FetchLike;
  series: (m: SeriesMapping, from: number, to: number) => Promise<Series>;
  weather: () => Promise<WeatherDay[] | null>;
  now: () => number;
  log: (msg: string) => void;
  timeoutMs?: number;
}

const DAY = 86_400_000;

/** Daily values for complete local days only (today is still running). */
export function completeDailyValues(
  s: Series,
  timeZone: string,
  now: number,
  maxPerDay?: number,
): { tag: string; wert: number }[] {
  const today = localDateKey(now, timeZone);
  return dailyFromCounter(s.samples, (t) => localDateKey(t, timeZone), maxPerDay)
    .filter((d) => d.day < today)
    .map((d) => ({ tag: d.day, wert: Math.round(d.value * 1000) / 1000 }));
}

/** Weather for days that have not started yet, stamped with the time it was known. */
export function weatherFeatures(
  days: WeatherDay[],
  timeZone: string,
  now: number,
): { tag: string; name: string; wert: number; stand: string }[] {
  const today = localDateKey(now, timeZone);
  const stand = new Date(now).toISOString();
  const out: { tag: string; name: string; wert: number; stand: string }[] = [];
  for (const d of days) {
    if (d.tag <= today) continue; // only days that have not begun
    if (d.sonneH !== null) out.push({ tag: d.tag, name: 'sonne_h', wert: d.sonneH, stand });
    if (d.strahlungMj !== null) {
      out.push({ tag: d.tag, name: 'strahlung_mj', wert: d.strahlungMj, stand });
    }
  }
  return out;
}

/** First sync sends long history (if the source has it), later ones only recent days. */
export const FIRST_SYNC_DAYS = 400;
export const LATER_SYNC_DAYS = 8;

export function forecastBridge(deps: BridgeDeps) {
  const timeout = deps.timeoutMs ?? 10_000;
  const synced = new Set<string>();

  async function call(path: string, method = 'GET', body?: unknown) {
    const res = await deps.fetchFn(`${deps.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
    return { status: res.status, body: await res.json() };
  }

  async function sync(name: string, f: ForecastMapping) {
    const src = deps.mapping.series[f.from]!;
    const now = deps.now();
    const days = synced.has(name) ? LATER_SYNC_DAYS : FIRST_SYNC_DAYS;
    const s = await deps.series(src, now - days * DAY, now);
    const werte = completeDailyValues(s, deps.mapping.timeZone, now, src.entity.maxPerDay);
    const weather = f.weather ? await deps.weather().catch(() => null) : null;
    const merkmale = weather ? weatherFeatures(weather, deps.mapping.timeZone, now) : [];
    await call('/reihen', 'POST', { id: name, einheit: src.entity.unit });
    const r = await call(`/reihen/${name}/werte`, 'PUT', { werte, merkmale });
    if (r.status === 200) synced.add(name);
  }

  return {
    async syncAll() {
      for (const [name, f] of Object.entries(deps.mapping.forecasts)) {
        try {
          await sync(name, f);
        } catch (e) {
          deps.log(`forecast ${name}: ${(e as Error).name}`);
        }
      }
    },
    /** Read-only proxy for the browser: status, accuracy, forecast of a named series. */
    async read(name: string, what: 'status' | 'guete' | 'prognose') {
      if (!Object.hasOwn(deps.mapping.forecasts, name))
        return { status: 404, body: { error: 'unknown_forecast' } };
      try {
        return await call(`/reihen/${name}/${what}`);
      } catch (e) {
        const err = e as Error;
        return err.name === 'TimeoutError' || err.name === 'AbortError'
          ? { status: 504, body: { error: 'timeout' } }
          : { status: 502, body: { error: 'upstream' } };
      }
    },
  };
}
