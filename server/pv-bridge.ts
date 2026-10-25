/**
 * Hourly PV forecast (M11) bridge: sends the plant, hourly generation from the
 * meter reading and the GTI forecast per roof plane to the forecasting service.
 *
 * GTI timestamps of "known when" (stand):
 * - current forecast: now (only hours of days that have not begun count, the
 *   service checks this);
 * - archive (first sync): Open-Meteo's day-ahead forecasts (previous_day1),
 *   stamped one day before the hour – what was known then.
 */
import type { FetchLike } from '../src/adapters/influx1';
import { fetchGti, type HourValue, type Location } from '../src/adapters/openmeteo';
import { dropCounterGlitches } from '../src/model/series';
import type { Series } from '../src/model/types';
import type { Mapping, PvMapping, SeriesMapping } from './mapping';

const H = 3_600_000;
const DAY = 24 * H;
/**
 * quietWhenIdle: largest step (counter unit, e.g. kWh) across a gap that still counts as
 * "stood still, then started". Wallboxes book 10–25 Wh as a charge starts, before they report
 * again; a larger step across a gap is more likely lost readings and stays unknown.
 */
export const QUIET_START_STEP = 0.05;

/**
 * kWh per UTC hour from a meter: reading at the hour end minus at the start;
 * read errors and resets dropped.
 */
export function hourlyFromCounter(
  s: Series,
  now: number,
  quietWhenIdle = false,
): { zeit: string; wert: number }[] {
  const boundary = new Map<number, number>();
  const maxAge = Math.max(s.stepMs * 2.5, 15 * 60_000);
  const samples = dropCounterGlitches(s.samples);
  for (const x of samples) {
    const h = Math.ceil(x.t / H) * H; // the next hour boundary at or after the sample
    // the latest sample before (or at) the boundary is the reading at the boundary
    if (h - x.t <= maxAge) boundary.set(h, x.v);
  }
  // A counter that reports only while it moves: the same reading before and after a gap
  // means it stood still – every hour boundary in the gap has that reading. A small step up
  // (≤ QUIET_START_STEP) means it stood still until a charge started at the end of the gap:
  // the step belongs to the hour the charge starts in. After the last reading it stands
  // still until now (it would report if it moved).
  if (quietWhenIdle) {
    samples.forEach((a, i) => {
      const b = samples[i + 1];
      if (b && (b.v < a.v || b.v - a.v > QUIET_START_STEP + 1e-9)) return;
      const end = b ? b.t : now;
      for (let h = Math.ceil(a.t / H) * H; h <= end; h += H)
        if (!boundary.has(h)) boundary.set(h, a.v);
    });
  }
  const out: { zeit: string; wert: number }[] = [];
  for (const [h, v] of boundary) {
    const prev = boundary.get(h - H);
    if (prev === undefined || h > now) continue;
    const kwh = v - prev;
    if (kwh < 0) continue; // meter reset: no value rather than a wrong one
    out.push({ zeit: new Date(h - H).toISOString(), wert: Math.round(kwh * 1000) / 1000 });
  }
  return out.sort((a, b) => a.zeit.localeCompare(b.zeit));
}

export interface PvBridgeDeps {
  url: string;
  mapping: Mapping & { pv: PvMapping };
  fetchFn: FetchLike;
  series: (m: SeriesMapping, from: number, to: number) => Promise<Series>;
  location: () => Promise<Location | null>;
  weatherOn: boolean;
  now: () => number;
  log: (msg: string) => void;
  timeoutMs?: number;
}

export function pvBridge(deps: PvBridgeDeps) {
  const timeout = deps.timeoutMs ?? 10_000;
  let archived = false;

  async function call(path: string, method = 'GET', body?: unknown) {
    const res = await deps.fetchFn(`${deps.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
    return { status: res.status, body: await res.json() };
  }

  async function sync() {
    const pv = deps.mapping.pv;
    const l = deps.weatherOn ? await deps.location() : null;
    if (!l) {
      deps.log('pv: no location or WEATHER=off – hourly PV forecast paused');
      return;
    }
    const now = deps.now();
    await call('/pv/pv/anlage', 'PUT', {
      lat: l.lat,
      lon: l.lon,
      tz: deps.mapping.timeZone,
      flaechen: pv.planes.map((p) => ({
        name: p.name,
        neigung: p.tilt,
        azimut: p.azimuth,
        kwp: p.kwp,
      })),
      ...(pv.maxKw ? { max_kw: pv.maxKw } : {}),
    });
    const src = deps.mapping.series[pv.from]!;
    const s = await deps.series(src, now - (archived ? 3 : 62) * DAY, now);
    const gti: { zeit: string; flaeche: string; wert: number; stand: string }[] = [];
    for (const plane of pv.planes) {
      const add = (rows: HourValue[], stand: (t: number) => number) => {
        for (const r of rows) {
          gti.push({
            zeit: new Date(r.t).toISOString(),
            flaeche: plane.name,
            wert: r.v,
            stand: new Date(stand(r.t)).toISOString(),
          });
        }
      };
      add(await fetchGti(deps.fetchFn, l, plane, false, timeout), () => now);
      if (!archived) {
        add(await fetchGti(deps.fetchFn, l, plane, true, timeout), (t) => t - DAY - 60_000);
      }
    }
    const r = await call('/pv/pv/daten', 'PUT', { stunden: hourlyFromCounter(s, now), gti });
    if (r.status === 200) archived = true;
  }

  return {
    async syncAll() {
      try {
        await sync();
      } catch (e) {
        deps.log(`pv: ${(e as Error).name}`);
      }
    },
    async read(what: 'prognose' | 'guete' | 'status') {
      try {
        return await call(`/pv/pv/${what}`);
      } catch (e) {
        const err = e as Error;
        return err.name === 'TimeoutError' || err.name === 'AbortError'
          ? { status: 504, body: { error: 'timeout' } }
          : { status: 502, body: { error: 'upstream' } };
      }
    },
  };
}
