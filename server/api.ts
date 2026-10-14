/**
 * JSON API. Only GET, only named series, only whitelisted ranges. Errors are
 * short codes for the UI ("timeout", "upstream"), details stay in the server log.
 */
import { InfluxError, type InfluxMapping } from '../src/adapters/influx1';
import type { Series } from '../src/model/types';
import type { Mapping } from './mapping';

export const RANGES = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '31d': 31 * 86_400_000,
} as const;
export type RangeName = keyof typeof RANGES;

export interface ApiDeps {
  mode: 'influx' | 'demo';
  mapping?: Mapping;
  series?: (m: InfluxMapping, fromMs: number, toMs: number) => Promise<Series>;
  now: () => number;
  log: (msg: string) => void;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResult => ({ status, body });

export async function handleApi(method: string, url: URL, deps: ApiDeps): Promise<ApiResult> {
  if (method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const path = url.pathname;

  if (path === '/api/health') {
    return json(200, { ok: true, source: deps.mode, timeZone: deps.mapping?.timeZone ?? null });
  }

  if (deps.mode === 'demo' || !deps.mapping || !deps.series) {
    return json(404, { error: 'demo_mode' });
  }

  if (path === '/api/entities') {
    return json(200, {
      timeZone: deps.mapping.timeZone,
      entities: Object.values(deps.mapping.series).map((m) => ({ ...m.entity, stepMs: m.stepMs })),
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
      return json(200, {
        name,
        entity: m.entity,
        stepMs: m.stepMs,
        from,
        to,
        samples: s.samples.map((x) => [x.t, x.v]),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        deps.log(`series ${name}: timeout`);
        return json(504, { error: 'timeout' });
      }
      deps.log(`series ${name}: ${e instanceof InfluxError ? e.message : e.name}`);
      return json(502, { error: 'upstream' });
    }
  }

  return json(404, { error: 'not_found' });
}
