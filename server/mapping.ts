/**
 * local/mapping.json: the only queries the server will ever run. Each entry
 * is a named series from InfluxDB or Home Assistant; the browser can ask for a
 * name, never for a query. Validated strictly at start so typos fail loudly
 * instead of showing wrong data.
 */
import { isHaEntityId, type HaMapping } from '../src/adapters/homeassistant';
import type { InfluxMapping } from '../src/adapters/influx1';
import type { EntityKind } from '../src/model/types';

export type SeriesMapping =
  ({ source: 'influx' } & InfluxMapping) | ({ source: 'homeassistant' } & HaMapping);

export interface Mapping {
  timeZone: string;
  series: Record<string, SeriesMapping>;
}

const KINDS: EntityKind[] = [
  'power',
  'energy_counter',
  'state_of_charge',
  'temperature',
  'humidity',
];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const COMMON_KEYS = ['source', 'name', 'kind', 'unit', 'room', 'scale', 'stepMs'];
const INFLUX_KEYS = [...COMMON_KEYS, 'measurement', 'field', 'tags'];
const HA_KEYS = [...COMMON_KEYS, 'entityId', 'maxHoldMs'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateMapping(
  raw: unknown,
): { ok: true; mapping: Mapping } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['mapping: must be a JSON object'] };

  for (const key of Object.keys(raw)) {
    if (!['timeZone', 'series', '$comment'].includes(key)) {
      errors.push(`mapping.${key}: unknown key`);
    }
  }
  if (!isText(raw.timeZone) || !validTimeZone(raw.timeZone)) {
    errors.push('mapping.timeZone: must be an IANA time zone, e.g. "Europe/Berlin"');
  }
  if (!isObj(raw.series) || Object.keys(raw.series).length === 0) {
    errors.push('mapping.series: must be an object with at least one entry');
    return { ok: false, errors };
  }

  const series: Record<string, SeriesMapping> = {};
  for (const [id, entry] of Object.entries(raw.series)) {
    const at = `mapping.series.${id}`;
    if (!NAME.test(id)) errors.push(`${at}: name must match ${NAME}`);
    if (!isObj(entry)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    const source = entry.source ?? 'influx';
    if (source !== 'influx' && source !== 'homeassistant') {
      errors.push(`${at}.source: "influx" or "homeassistant"`);
      continue;
    }
    const allowed = source === 'influx' ? INFLUX_KEYS : HA_KEYS;
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) errors.push(`${at}.${key}: unknown key for source ${source}`);
    }
    if (!isText(entry.name)) errors.push(`${at}.name: required text`);
    if (!KINDS.includes(entry.kind as EntityKind)) {
      errors.push(`${at}.kind: one of ${KINDS.join(', ')}`);
    }
    if (!isText(entry.unit, 20)) errors.push(`${at}.unit: required text`);
    if (entry.room !== undefined && !isText(entry.room)) errors.push(`${at}.room: text`);
    if (
      entry.scale !== undefined &&
      (typeof entry.scale !== 'number' || !Number.isFinite(entry.scale) || entry.scale === 0)
    ) {
      errors.push(`${at}.scale: non-zero number`);
    }
    if (
      typeof entry.stepMs !== 'number' ||
      !Number.isInteger(entry.stepMs) ||
      entry.stepMs < 1_000 ||
      entry.stepMs > 86_400_000
    ) {
      errors.push(`${at}.stepMs: integer between 1000 and 86400000`);
    }

    const entity = {
      id,
      name: entry.name as string,
      kind: entry.kind as EntityKind,
      unit: entry.unit as string,
      ...(entry.room ? { room: entry.room as string } : {}),
    };
    const common = {
      entity,
      ...(entry.scale !== undefined ? { scale: entry.scale as number } : {}),
      stepMs: entry.stepMs as number,
    };

    if (source === 'influx') {
      if (!isText(entry.measurement)) errors.push(`${at}.measurement: required text`);
      if (!isText(entry.field)) errors.push(`${at}.field: required text`);
      if (entry.tags !== undefined) {
        if (!isObj(entry.tags) || !Object.values(entry.tags).every((v) => isText(v))) {
          errors.push(`${at}.tags: object of text values`);
        }
      }
      series[id] = {
        source: 'influx',
        ...common,
        measurement: entry.measurement as string,
        field: entry.field as string,
        ...(entry.tags ? { tags: entry.tags as Record<string, string> } : {}),
      };
    } else {
      if (typeof entry.entityId !== 'string' || !isHaEntityId(entry.entityId)) {
        errors.push(`${at}.entityId: Home Assistant entity id like "sensor.example_power"`);
      }
      if (
        entry.maxHoldMs !== undefined &&
        (typeof entry.maxHoldMs !== 'number' ||
          !Number.isInteger(entry.maxHoldMs) ||
          entry.maxHoldMs < 60_000)
      ) {
        errors.push(`${at}.maxHoldMs: integer ≥ 60000`);
      }
      series[id] = {
        source: 'homeassistant',
        ...common,
        haEntityId: entry.entityId as string,
        ...(entry.maxHoldMs !== undefined ? { maxHoldMs: entry.maxHoldMs as number } : {}),
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, mapping: { timeZone: raw.timeZone as string, series } };
}

/** Which back-ends a mapping needs. */
export function sourcesOf(mapping: Mapping): ('influx' | 'homeassistant')[] {
  return [...new Set(Object.values(mapping.series).map((s) => s.source))].sort();
}
