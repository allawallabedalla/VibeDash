/**
 * InfluxDB 1.x (InfluxQL) adapter core. Pure functions plus a small client
 * that takes `fetch` as a parameter, so it runs in Node (where credentials
 * live) and is testable without a database.
 *
 * Data truth rules applied here:
 * - Samples keep the order the database returns (time order; equal
 *   timestamps stay in arrival order, never sorted by value).
 * - null values are dropped, so they become visible gaps, not zeros.
 * - Times are UTC milliseconds (`epoch=ms`).
 */
import type { Entity, EntityKind, Sample, Series } from '../model/types';

export interface InfluxConfig {
  /** e.g. http://influx.local:8086 – never committed, comes from .env */
  url: string;
  database: string;
  username?: string;
  password?: string;
  retentionPolicy?: string;
}

/** How one entity is read from Influx. Written by the agent during inventory. */
export interface InfluxMapping {
  entity: Entity;
  measurement: string;
  field: string;
  tags?: Record<string, string>;
  /** Only rows whose fields have these numbers, e.g. { nachgerechnet: 0 } (forecasts made in time). */
  onlyWhere?: Record<string, number>;
  /** Multiply raw values, e.g. 0.001 for Wh → kWh. */
  scale?: number;
  /** Nominal sampling step in ms, used to detect gaps. */
  stepMs: number;
  /**
   * The sensor only reports on change: its last value stays valid this long
   * (written forward in steps); only after that it counts as a gap.
   */
  maxHoldMs?: number;
  /**
   * Meters only: an older measurement of the same meter, used for daily
   * values on days before this one has any (e.g. a replaced logger).
   */
  history?: { measurement: string; field: string; tags?: Record<string, string>; scale?: number };
}

/** Quote an identifier for InfluxQL ("name", with " and \ escaped). */
export function ident(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Quote a string literal for InfluxQL ('value', with ' and \ escaped). */
export function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function from(m: InfluxMapping, rp?: string): string {
  return rp ? `${ident(rp)}.${ident(m.measurement)}` : ident(m.measurement);
}

/** Raw samples of one field in [fromMs, toMs). */
const onlyWhere = (m: InfluxMapping) =>
  Object.entries(m.onlyWhere ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => `${ident(k)} = ${Number(v)}`);

export function rawQuery(m: InfluxMapping, fromMs: number, toMs: number, rp?: string): string {
  const where = [
    `time >= ${Math.floor(fromMs)}ms`,
    `time < ${Math.floor(toMs)}ms`,
    ...Object.entries(m.tags ?? {}).map(([k, v]) => `${ident(k)} = ${literal(v)}`),
    ...onlyWhere(m),
  ];
  return `SELECT ${ident(m.field)} FROM ${from(m, rp)} WHERE ${where.join(' AND ')}`;
}

/** Last reading per local day in [fromMs, toMs) – cheap daily meter values for long ranges. */
export function dailyLastQuery(
  m: { measurement: string; field: string; tags?: Record<string, string> },
  fromMs: number,
  toMs: number,
  timeZone: string,
  rp?: string,
): string {
  const where = [
    `time >= ${Math.floor(fromMs)}ms`,
    `time < ${Math.floor(toMs)}ms`,
    ...Object.entries(m.tags ?? {}).map(([k, v]) => `${ident(k)} = ${literal(v)}`),
  ];
  const src = rp ? `${ident(rp)}.${ident(m.measurement)}` : ident(m.measurement);
  return `SELECT LAST(${ident(m.field)}) FROM ${src} WHERE ${where.join(' AND ')} GROUP BY time(1d) tz(${literal(timeZone)})`;
}

/** Last value at or before `atMs` (for "now" tiles). */
export function lastQuery(m: InfluxMapping, atMs: number, rp?: string): string {
  const where = [
    `time <= ${Math.floor(atMs)}ms`,
    ...Object.entries(m.tags ?? {}).map(([k, v]) => `${ident(k)} = ${literal(v)}`),
    ...onlyWhere(m),
  ];
  return `SELECT LAST(${ident(m.field)}) FROM ${from(m, rp)} WHERE ${where.join(' AND ')}`;
}

/** Inventory queries the agent runs before building pages. */
export const inventory = {
  measurements: () => 'SHOW MEASUREMENTS',
  fieldKeys: (measurement: string) => `SHOW FIELD KEYS FROM ${ident(measurement)}`,
  tagKeys: (measurement: string) => `SHOW TAG KEYS FROM ${ident(measurement)}`,
  tagValues: (measurement: string, key: string) =>
    `SHOW TAG VALUES FROM ${ident(measurement)} WITH KEY = ${ident(key)}`,
};

/** Shape of the InfluxDB 1.x /query JSON response. */
export interface InfluxResponse {
  results?: {
    statement_id?: number;
    error?: string;
    series?: {
      name: string;
      tags?: Record<string, string>;
      columns: string[];
      values?: unknown[][];
    }[];
  }[];
  error?: string;
}

export class InfluxError extends Error {}

/** Turn a SELECT response into samples; order is kept exactly as returned. */
export function parseSamples(res: InfluxResponse, scale = 1): Sample[] {
  if (res.error) throw new InfluxError(res.error);
  const out: Sample[] = [];
  for (const result of res.results ?? []) {
    if (result.error) throw new InfluxError(result.error);
    for (const s of result.series ?? []) {
      const ti = s.columns.indexOf('time');
      const vi = s.columns.findIndex((c, i) => i !== ti);
      if (ti < 0 || vi < 0) continue;
      for (const row of s.values ?? []) {
        const t = row[ti];
        const v = row[vi];
        if (typeof t !== 'number') throw new InfluxError('expected epoch=ms timestamps');
        if (v === null || v === undefined) continue; // gap, not zero
        const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number.NaN;
        if (!Number.isFinite(n)) continue;
        out.push({ t, v: n * scale });
      }
    }
  }
  return out;
}

/** First column of SHOW … responses, e.g. measurement names or tag values. */
export function parseList(res: InfluxResponse, column?: string): string[] {
  if (res.error) throw new InfluxError(res.error);
  const out: string[] = [];
  for (const result of res.results ?? []) {
    if (result.error) throw new InfluxError(result.error);
    for (const s of result.series ?? []) {
      const i = column ? s.columns.indexOf(column) : 0;
      for (const row of s.values ?? []) if (i >= 0) out.push(String(row[i]));
    }
  }
  return out;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/**
 * Minimal client: GET /query with basic auth; credentials never go into the
 * URL. Every request is aborted after `timeoutMs` (default 10 s).
 */
export function influxClient(config: InfluxConfig, fetchFn: FetchLike, timeoutMs = 10_000) {
  async function query(q: string): Promise<InfluxResponse> {
    const params = new URLSearchParams({ db: config.database, q, epoch: 'ms' });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.username !== undefined) {
      const token = btoa(`${config.username}:${config.password ?? ''}`);
      headers.Authorization = `Basic ${token}`;
    }
    const res = await fetchFn(`${config.url.replace(/\/$/, '')}/query?${params}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new InfluxError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as InfluxResponse;
  }

  return {
    query,
    async series(m: InfluxMapping, fromMs: number, toMs: number): Promise<Series> {
      const res = await query(rawQuery(m, fromMs, toMs, config.retentionPolicy));
      return {
        entityId: m.entity.id,
        source: `influx:${m.measurement}.${m.field}`,
        stepMs: m.stepMs,
        samples: parseSamples(res, m.scale),
      };
    },
    /** Last reading per local day (time = local midnight), nulls dropped. */
    async dailyLast(
      m: { measurement: string; field: string; tags?: Record<string, string>; scale?: number },
      fromMs: number,
      toMs: number,
      timeZone: string,
    ) {
      const res = await query(dailyLastQuery(m, fromMs, toMs, timeZone, config.retentionPolicy));
      return parseSamples(res, m.scale);
    },
    async measurements(): Promise<string[]> {
      return parseList(await query(inventory.measurements()));
    },
  };
}

/** Kinds whose values are cumulative meter readings. */
export const COUNTER_KINDS: EntityKind[] = ['energy_counter'];
