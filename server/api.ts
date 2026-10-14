/**
 * JSON API. Only GET, only named series, only whitelisted ranges. Errors are
 * short codes for the UI ("timeout", "upstream"), details stay in the server log.
 */
import { EvccError, type EvccNow, type EvccSession } from '../src/adapters/evcc';
import { HaError } from '../src/adapters/homeassistant';
import { InfluxError } from '../src/adapters/influx1';
import {
  validLocation,
  WeatherError,
  type Location,
  type WeatherDay,
} from '../src/adapters/openmeteo';
import type { ResolvedLocation } from './location';
import { thinBefore } from '../src/model/series';
import type { Series } from '../src/model/types';
import { sourcesOf, type Mapping, type SeriesMapping } from './mapping';

export const RANGES = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '31d': 31 * 86_400_000,
} as const;
export type RangeName = keyof typeof RANGES;

/**
 * Long ranges are thinned out before they go over the wire: everything older
 * than FULL_MS keeps one value per THIN_MS slot. FULL_MS is a bit more than the
 * two days the UI checks for gaps and resets, so those checks see every sample.
 */
export const FULL_MS = 50 * 3_600_000;
export const THIN_MS = 5 * 60_000;
const ADDS_UP = new Set(['energy_counter', 'capacity']);

export interface ApiDeps {
  mode: 'live' | 'demo';
  mapping?: Mapping;
  series?: (m: SeriesMapping, fromMs: number, toMs: number) => Promise<Series>;
  now: () => number;
  log: (msg: string) => void;
  evcc?: {
    now: () => Promise<EvccNow>;
    sessions: (year?: number) => Promise<EvccSession[]>;
  };
  pv?: {
    read: (what: 'prognose' | 'guete' | 'status') => Promise<{ status: number; body: unknown }>;
  };
  plan?: {
    read: () => Promise<{ status: number; body: unknown }>;
    accuracy: () => Promise<{ status: number; body: unknown }>;
  };
  forecast?: {
    names: string[];
    read: (
      name: string,
      what: 'status' | 'guete' | 'prognose',
    ) => Promise<{ status: number; body: unknown }>;
  };
  weather?: {
    /** false when WEATHER=off: no external request at all */
    enabled: boolean;
    location: () => Promise<ResolvedLocation | null>;
    setLocation: (l: Location & { name?: string }) => Promise<ResolvedLocation>;
    geocode: (place: string, language: string) => Promise<(Location & { name: string }) | null>;
    forecast: (l: Location) => Promise<WeatherDay[]>;
  };
}

/** Extra request details for the one write endpoint (location). */
export interface RequestInfo {
  body?: string;
  contentType?: string;
  origin?: string;
  host?: string;
}

function timeoutOr(e: Error, log: (m: string) => void, what: string): ApiResult {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    log(`${what}: timeout`);
    return json(504, { error: 'timeout' });
  }
  log(`${what}: ${e instanceof WeatherError || e instanceof EvccError ? e.message : e.name}`);
  return json(502, { error: 'upstream' });
}

async function handleLocation(method: string, deps: ApiDeps, req: RequestInfo): Promise<ApiResult> {
  const w = deps.weather;
  if (!w) return json(404, { error: 'not_found' });
  if (method === 'GET') {
    return json(200, { enabled: w.enabled, location: w.enabled ? await w.location() : null });
  }
  // The only write: same origin, JSON, tiny body.
  if (!w.enabled) return json(409, { error: 'weather_off' });
  if (req.origin && req.host && new URL(req.origin).host !== req.host) {
    return json(403, { error: 'cross_origin' });
  }
  if (!(req.contentType ?? '').includes('application/json')) {
    return json(415, { error: 'json_required' });
  }
  if (!req.body || req.body.length > 1024) return json(400, { error: 'bad_body' });
  let body: { lat?: unknown; lon?: unknown; place?: unknown; language?: unknown };
  try {
    body = JSON.parse(req.body);
  } catch {
    return json(400, { error: 'bad_body' });
  }
  try {
    if (typeof body.place === 'string') {
      const place = body.place.trim().slice(0, 80);
      if (!place) return json(400, { error: 'bad_body' });
      const lang = body.language === 'en' ? 'en' : 'de';
      const found = await w.geocode(place, lang);
      if (!found) return json(404, { error: 'place_not_found' });
      return json(200, { location: await w.setLocation(found) });
    }
    const l = { lat: Number(body.lat), lon: Number(body.lon) };
    if (!validLocation(l)) return json(400, { error: 'bad_location' });
    return json(200, { location: await w.setLocation(l) });
  } catch (e) {
    return timeoutOr(e as Error, deps.log, 'location');
  }
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResult => ({ status, body });

export async function handleApi(
  method: string,
  url: URL,
  deps: ApiDeps,
  req: RequestInfo = {},
): Promise<ApiResult> {
  const path = url.pathname;
  if (path === '/api/location' && (method === 'GET' || method === 'POST')) {
    return handleLocation(method, deps, req);
  }
  if (method !== 'GET') return json(405, { error: 'method_not_allowed' });

  if (path === '/api/evcc/now' || path === '/api/evcc/sessions') {
    if (!deps.evcc) return json(404, { error: 'no_evcc' });
    try {
      if (path === '/api/evcc/now') return json(200, await deps.evcc.now());
      const y = url.searchParams.get('year');
      if (y !== null && !/^20\d{2}$/.test(y)) return json(400, { error: 'bad_year' });
      return json(200, { sessions: await deps.evcc.sessions(y ? Number(y) : undefined) });
    } catch (e) {
      return timeoutOr(e as Error, deps.log, 'evcc');
    }
  }

  if (path === '/api/weather') {
    const w = deps.weather;
    if (!w || !w.enabled) return json(404, { error: 'weather_off' });
    const l = await w.location();
    if (!l) return json(404, { error: 'no_location' });
    try {
      return json(200, { location: l, days: await w.forecast(l) });
    } catch (e) {
      return timeoutOr(e as Error, deps.log, 'weather');
    }
  }

  if (path === '/api/health') {
    return json(200, {
      ok: true,
      source: deps.mode,
      backends: deps.mapping ? sourcesOf(deps.mapping) : [],
      evcc: Boolean(deps.evcc),
      pv: Boolean(deps.pv),
      plan: Boolean(deps.plan),
      timeZone: deps.mapping?.timeZone ?? null,
    });
  }

  if (deps.mode === 'demo' || !deps.mapping || !deps.series) {
    return json(404, { error: 'demo_mode' });
  }

  const pvm = /^\/api\/pv\/(prognose|guete|status)$/.exec(path);
  if (pvm) {
    if (!deps.pv) return json(404, { error: 'no_pv_forecast' });
    const r = await deps.pv.read(pvm[1] as 'prognose' | 'guete' | 'status');
    return json(r.status, r.body);
  }

  if (path === '/api/plan' || path === '/api/plan/guete') {
    if (!deps.plan) return json(404, { error: 'no_charge_plan' });
    const r = path === '/api/plan' ? await deps.plan.read() : await deps.plan.accuracy();
    return json(r.status, r.body);
  }

  if (path === '/api/forecasts') {
    return json(200, { names: deps.forecast?.names ?? [] });
  }
  const fc = /^\/api\/forecast\/([a-z][a-z0-9_]{0,63})\/(status|guete|prognose)$/.exec(path);
  if (fc) {
    if (!deps.forecast) return json(404, { error: 'no_forecast_service' });
    const r = await deps.forecast.read(fc[1]!, fc[2] as 'status' | 'guete' | 'prognose');
    return json(r.status, r.body);
  }

  if (path === '/api/entities') {
    return json(200, {
      timeZone: deps.mapping.timeZone,
      entities: Object.values(deps.mapping.series)
        .filter((m) => !m.helper)
        .map((m) => ({ ...m.entity, stepMs: m.stepMs })),
    });
  }

  const match = /^\/api\/series\/([a-z][a-z0-9_]{0,63})$/.exec(path);
  if (match) {
    const name = match[1]!;
    const m = Object.hasOwn(deps.mapping.series, name) ? deps.mapping.series[name] : undefined;
    if (!m) return json(404, { error: 'unknown_series' });
    const range = url.searchParams.get('range') ?? '24h';
    if (!Object.hasOwn(RANGES, range)) {
      return json(400, { error: 'bad_range', allowed: Object.keys(RANGES) });
    }
    const to = deps.now();
    const from = to - RANGES[range as RangeName];
    try {
      const s = await deps.series(m, from, to);
      const before = Math.floor((to - FULL_MS) / THIN_MS) * THIN_MS;
      const samples =
        m.stepMs < THIN_MS && before > from
          ? thinBefore(s.samples, before, THIN_MS, ADDS_UP.has(m.entity.kind) ? 'last' : 'mean')
          : s.samples;
      return json(200, {
        name,
        entity: m.entity,
        stepMs: m.stepMs,
        from,
        to,
        samples: samples.map((x) => [x.t, x.v]),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        deps.log(`series ${name}: timeout`);
        return json(504, { error: 'timeout' });
      }
      const known = e instanceof InfluxError || e instanceof HaError;
      deps.log(`series ${name}: ${known ? e.message : e.name}`);
      return json(502, { error: 'upstream' });
    }
  }

  return json(404, { error: 'not_found' });
}
