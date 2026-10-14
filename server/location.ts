/**
 * Where is the house? Needed for the weather forecast only.
 * Order: LATITUDE/LONGITUDE in .env → local/settings.json (set once by the
 * person) → Home Assistant's own location (/api/config). Always rounded to
 * about 1 km. Stored only locally.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FetchLike } from '../src/adapters/influx1';
import { roundLocation, validLocation, type Location } from '../src/adapters/openmeteo';
import type { HaConfig } from '../src/adapters/homeassistant';

export type LocationSource = 'env' | 'settings' | 'homeassistant';

export interface ResolvedLocation extends Location {
  source: LocationSource;
  name?: string;
}

export function fromEnv(env: Record<string, string | undefined>): ResolvedLocation | null {
  if (!env.LATITUDE || !env.LONGITUDE) return null;
  const l = { lat: Number(env.LATITUDE), lon: Number(env.LONGITUDE) };
  return validLocation(l) ? { ...roundLocation(l), source: 'env' } : null;
}

export function readSettings(path: string): ResolvedLocation | null {
  if (!existsSync(path)) return null;
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as { location?: Location & { name?: string } };
    if (!validLocation(s.location)) return null;
    return {
      ...roundLocation(s.location),
      source: 'settings',
      ...(s.location.name ? { name: String(s.location.name).slice(0, 80) } : {}),
    };
  } catch {
    return null;
  }
}

export function writeSettings(path: string, l: Location & { name?: string }): ResolvedLocation {
  const r = roundLocation(l);
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      current = {};
    }
  }
  const name = l.name ? String(l.name).slice(0, 80) : undefined;
  current.location = { ...r, ...(name ? { name } : {}) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(current, null, 2) + '\n');
  return { ...r, source: 'settings', ...(name ? { name } : {}) };
}

export async function fromHomeAssistant(
  ha: HaConfig,
  fetchFn: FetchLike,
  timeoutMs = 10_000,
): Promise<ResolvedLocation | null> {
  const res = await fetchFn(`${ha.url.replace(/\/$/, '')}/api/config`, {
    headers: { Authorization: `Bearer ${ha.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const c = (await res.json()) as { latitude?: number; longitude?: number };
  const l = { lat: Number(c.latitude), lon: Number(c.longitude) };
  return validLocation(l) && !(l.lat === 0 && l.lon === 0)
    ? { ...roundLocation(l), source: 'homeassistant' }
    : null;
}
