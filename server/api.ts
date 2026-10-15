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
import type { ChargeSession, ChargingNow, PlanSummary } from './charging';
import type { ResolvedLocation } from './location';
import { thinBefore } from '../src/model/series';
import type { Series } from '../src/model/types';
import { sourcesOf, type BoardMapping, type Mapping, type SeriesMapping } from './mapping';
import type { Board } from '../src/model/board';

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
  /** Car charging from the house's records (read-only). */
  charging?: {
    now: () => Promise<ChargingNow>;
    sessions: (days: number) => Promise<ChargeSession[]>;
    plan: () => Promise<PlanSummary | null>;
  };
  /** A board's content from its house service, checked (src/model/board.ts). */
  board?: (b: BoardMapping) => Promise<Board | null>;
  /** Daily energy of a meter, [local day start, kWh or null]. */
  daily?: (m: SeriesMapping, fromMs: number, toMs: number) => Promise<[number, number | null][]>;
  now: () => number;
  log: (msg: string) => void;
  /**
   * Short answer cache (Audit02 B-08): the same series asked again within a
   * few seconds – by another tile, tab or device – costs no new query.
   */
  cache?: Map<string, { at: number; result: Promise<ApiResult> }>;
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
    /** false when LOCATION_WRITE=off: the location can only be set in .env */
    writable?: boolean;
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
  /** Sec-Fetch-Site from the browser: "same-origin" for the page itself. */
  fetchSite?: string;
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
  // The only write: switchable, same origin, JSON, tiny body.
  if (!w.enabled) return json(409, { error: 'weather_off' });
  if (w.writable === false) return json(403, { error: 'location_write_off' });
  // every browser sends Origin on a POST; without it (curl, scripts) no write (Audit02 B-04)
  const originHost = (() => {
    try {
      return req.origin ? new URL(req.origin).host : null;
    } catch {
      return null;
    }
  })();
  if (!originHost || !req.host || originHost !== req.host) {
    return json(403, { error: 'cross_origin' });
  }
  // a browser says where the request comes from; only the page itself may write
  if (req.fetchSite && req.fetchSite !== 'same-origin') {
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

/** TTL of cached answers: "now" ranges briefly, long ranges and days longer. */
export const CACHE_MS = { short: 20_000, long: 120_000, daily: 600_000 } as const;

/** One answer per key and TTL; concurrent asks share it; only 200s are kept. */
function cached(
  deps: ApiDeps,
  key: string,
  ttlMs: number,
  make: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const c = deps.cache;
  if (!c) return make();
  const now = deps.now();
  const hit = c.get(key);
  if (hit && now - hit.at < ttlMs) return hit.result;
  const result = make().then((r) => {
    if (r.status !== 200) c.delete(key);
    return r;
  });
  c.set(key, { at: now, result });
  // keep the map small: drop what is old
  if (c.size > 500) for (const [k, v] of c) if (now - v.at > CACHE_MS.daily) c.delete(k);
  return result;
}

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
      charging: Boolean(deps.charging),
      pv: Boolean(deps.pv),
      plan: Boolean(deps.plan),
      timeZone: deps.mapping?.timeZone ?? null,
      boards: (deps.mapping?.boards ?? []).map(({ id, title, icon }) => ({ id, title, icon })),
    });
  }

  const bm = /^\/api\/board\/([a-z][a-z0-9_-]{0,31})$/.exec(path);
  if (bm) {
    const b = deps.mapping?.boards?.find((x) => x.id === bm[1]);
    if (!b || !deps.board) return json(404, { error: 'unknown_board' });
    const get = deps.board;
    return cached(deps, `board|${b.id}`, CACHE_MS.long / 2, async () => {
      try {
        const board = await get(b);
        return board ? json(200, board) : json(502, { error: 'not_a_board' });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          return json(504, { error: 'timeout' });
        deps.log(`board ${b.id}: ${e.message}`);
        return json(502, { error: 'upstream' });
      }
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

  if (path === '/api/charging') {
    if (!deps.charging) return json(404, { error: 'no_charging' });
    const days = Number(url.searchParams.get('days') ?? '31');
    if (!Number.isInteger(days) || days < 1 || days > 400) return json(400, { error: 'bad_days' });
    try {
      const [now, sessions, plan] = await Promise.all([
        deps.charging.now(),
        deps.charging.sessions(days),
        deps.charging.plan().catch((e: Error) => {
          deps.log(`charging plan: ${e.message}`);
          return null;
        }),
      ]);
      const c = deps.mapping.charging;
      return json(200, {
        now,
        sessions,
        plan,
        maxKw: c?.maxKw ?? null,
        powerSeries: c?.power ?? null,
        span: c?.plan?.span ?? null,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError')
        return json(504, { error: 'timeout' });
      deps.log(`charging: ${e instanceof InfluxError ? e.message : e.name}`);
      return json(502, { error: 'upstream' });
    }
  }

  if (path === '/api/notes') {
    return json(200, { notes: deps.mapping.notes ?? [] });
  }

  if (path === '/api/entities') {
    return json(200, {
      timeZone: deps.mapping.timeZone,
      entities: Object.values(deps.mapping.series)
        .filter((m) => !m.helper)
        .map((m) => ({ ...m.entity, stepMs: m.stepMs })),
    });
  }

  const dm = /^\/api\/daily\/([a-z][a-z0-9_]{0,63})$/.exec(path);
  if (dm) {
    const name = dm[1]!;
    const m = Object.hasOwn(deps.mapping.series, name) ? deps.mapping.series[name] : undefined;
    if (!m || m.helper) return json(404, { error: 'unknown_series' });
    if (!deps.daily || m.source !== 'influx' || m.entity.kind !== 'energy_counter') {
      return json(400, { error: 'not_a_meter' });
    }
    const days = Number(url.searchParams.get('days') ?? '400');
    if (!Number.isInteger(days) || days < 1 || days > 800) return json(400, { error: 'bad_days' });
    const daily = deps.daily;
    return cached(deps, `daily|${name}|${days}`, CACHE_MS.daily, async () => {
      const now = deps.now();
      try {
        const rows = await daily(m, now - days * 86_400_000, now);
        return json(200, { name, unit: 'kWh', days: rows });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          return json(504, { error: 'timeout' });
        deps.log(`daily ${name}: ${e instanceof InfluxError ? e.message : e.name}`);
        return json(502, { error: 'upstream' });
      }
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
    const ttl = range === '1h' || range === '24h' ? CACHE_MS.short : CACHE_MS.long;
    const read = deps.series;
    return cached(deps, `series|${name}|${range}`, ttl, async () => {
      const now = deps.now();
      const from = now - RANGES[range as RangeName];
      // forecasts are stored ahead of time: read them up to aheadMs into the future
      const to = now + (m.aheadMs ?? 0);
      try {
        const s = await read(m, from, to);
        const before = Math.floor((now - FULL_MS) / THIN_MS) * THIN_MS;
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
          ...(s.held ? { held: s.held } : {}),
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
    });
  }

  return json(404, { error: 'not_found' });
}
