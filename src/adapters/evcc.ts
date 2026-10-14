/**
 * evcc adapter (read only).
 *
 * - /api/state: values for "now" only (evcc keeps no history there).
 * - /api/sessions: evcc stores every charging session in its own database
 *   (energy in kWh, solar share in %, price, CO2, SoC) – the charging history
 *   comes straight from evcc, without InfluxDB or Home Assistant.
 *
 * Sign convention: evcc counts grid import and battery discharge as positive.
 * VibeDash uses feed-in positive and battery charging positive, so both are
 * flipped here, in one place.
 *
 * Older evcc versions wrap responses in {"result": …}; both forms are read.
 */
import type { FetchLike } from './influx1';

export interface EvccConfig {
  /** e.g. http://evcc.local:7070 – from .env */
  url: string;
}

export class EvccError extends Error {}

export interface EvccLoadpoint {
  title: string;
  connected: boolean;
  charging: boolean;
  chargePowerW: number | null;
  sessionEnergyKWh: number | null;
  sessionSolarPct: number | null;
  vehicleSoc: number | null;
}

export interface EvccNow {
  pvW: number | null;
  homeW: number | null;
  /** + feed-in, − import (VibeDash convention) */
  gridW: number | null;
  /** + charging, − discharging (VibeDash convention) */
  batteryW: number | null;
  batterySoc: number | null;
  loadpoints: EvccLoadpoint[];
}

export interface EvccSession {
  start: number;
  end: number | null;
  loadpoint: string;
  vehicle: string;
  energyKWh: number;
  /** null when evcc did not record a solar share */
  solarPct: number | null;
  price: number | null;
  socStart: number | null;
  socEnd: number | null;
}

const unwrap = (body: unknown): unknown =>
  body && typeof body === 'object' && !Array.isArray(body) && 'result' in body
    ? (body as { result: unknown }).result
    : body;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const neg = (v: number | null): number | null => (v === null ? null : v === 0 ? 0 : -v);
/** The loadpoint reports the running session's energy in Wh (chargedEnergy, older: sessionEnergy). */
const wh = (v: number | null): number | null => (v === null ? null : v / 1000);

export function parseState(body: unknown): EvccNow {
  const s = unwrap(body) as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') throw new EvccError('unexpected state response');
  const grid = (s.grid ?? {}) as Record<string, unknown>;
  const battery = (s.battery ?? {}) as Record<string, unknown>;
  const gridImport = num(grid.power) ?? num(s.gridPower);
  const batteryDischarge = num(battery.power) ?? num(s.batteryPower);
  const lps = Array.isArray(s.loadpoints) ? (s.loadpoints as Record<string, unknown>[]) : [];
  return {
    pvW: num(s.pvPower),
    homeW: num(s.homePower),
    gridW: neg(gridImport),
    batteryW: neg(batteryDischarge),
    batterySoc: num(battery.soc) ?? num(s.batterySoc),
    loadpoints: lps.map((lp, i) => ({
      title: typeof lp.title === 'string' && lp.title ? lp.title : `#${i + 1}`,
      connected: lp.connected === true,
      charging: lp.charging === true,
      chargePowerW: num(lp.chargePower),
      sessionEnergyKWh: wh(num(lp.chargedEnergy) ?? num(lp.sessionEnergy)),
      // only older evcc versions publish a live solar share; else it is in the stored session
      sessionSolarPct: num(lp.sessionSolarPercentage),
      vehicleSoc: num(lp.vehicleSoc),
    })),
  };
}

export function parseSessions(body: unknown): EvccSession[] {
  const list = unwrap(body);
  if (!Array.isArray(list)) throw new EvccError('unexpected sessions response');
  const out: EvccSession[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const start = Date.parse(String(raw.created ?? ''));
    const energy = num(raw.chargedEnergy);
    if (!Number.isFinite(start) || energy === null) continue;
    const end = Date.parse(String(raw.finished ?? ''));
    out.push({
      start,
      // evcc writes a zero time for running sessions
      end: Number.isFinite(end) && end > start ? end : null,
      loadpoint: String(raw.loadpoint ?? ''),
      vehicle: String(raw.vehicle ?? ''),
      energyKWh: energy,
      solarPct: num(raw.solarPercentage),
      price: num(raw.price),
      socStart: num(raw.socStart),
      socEnd: num(raw.socEnd),
    });
  }
  return out.sort((a, b) => b.start - a.start);
}

/**
 * Solar share over several sessions, weighted by energy. Sessions without a
 * recorded share are left out and counted, never treated as 0 % or 100 %.
 */
export function solarShare(sessions: readonly EvccSession[]): {
  pct: number | null;
  n: number;
  withoutShare: number;
  energyKWh: number;
} {
  let e = 0;
  let solar = 0;
  let n = 0;
  let without = 0;
  let total = 0;
  for (const s of sessions) {
    total += s.energyKWh;
    if (s.solarPct === null) {
      without++;
      continue;
    }
    e += s.energyKWh;
    solar += s.energyKWh * (s.solarPct / 100);
    n++;
  }
  return { pct: e > 0 ? (solar / e) * 100 : null, n, withoutShare: without, energyKWh: total };
}

export function evccClient(config: EvccConfig, fetchFn: FetchLike, timeoutMs = 10_000) {
  const base = config.url.replace(/\/$/, '');
  async function get(path: string): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new EvccError(`HTTP ${res.status}`);
    return res.json();
  }
  return {
    async now(): Promise<EvccNow> {
      return parseState(await get('/api/state'));
    },
    async sessions(year?: number): Promise<EvccSession[]> {
      const q = year ? `?year=${year}` : '';
      return parseSessions(await get(`/api/sessions${q}`));
    },
  };
}
