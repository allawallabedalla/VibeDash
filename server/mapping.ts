/**
 * local/mapping.json: the only queries the server will ever run. Each entry
 * is a named series from InfluxDB or Home Assistant; the browser can ask for a
 * name, never for a query. Validated strictly at start so typos fail loudly
 * instead of showing wrong data.
 */
import { isHaEntityId, type HaMapping } from '../src/adapters/homeassistant';
import type { InfluxMapping } from '../src/adapters/influx1';
import type { RoofPlane } from '../src/adapters/openmeteo';
import type { EntityKind } from '../src/model/types';

/** One part of a derived counter: power to integrate or a meter to add/subtract. */
export interface DerivedTerm {
  how: 'integrate' | 'counter';
  /** Name of an influx or homeassistant series in this mapping. */
  series: string;
  sign: 1 | -1;
}

/** A counter computed from other series (src/model/derive.ts); always kWh. */
export interface DerivedMapping {
  entity: InfluxMapping['entity'];
  stepMs: number;
  terms: DerivedTerm[];
}

export type SeriesMapping = (
  | ({ source: 'influx' } & InfluxMapping)
  | ({ source: 'homeassistant' } & HaMapping)
  | ({ source: 'derived' } & DerivedMapping)
) & {
  /** Only an input for other series: not listed in /api/entities. */
  helper?: boolean;
};

/** Factor from a unit to kW (power) or kWh (energy); undefined if not convertible. */
export const POWER_TO_KW: Record<string, number> = { W: 0.001, kW: 1 };
export const ENERGY_TO_KWH: Record<string, number> = { Wh: 0.001, kWh: 1 };

/** A daily forecast made by the forecasting service from a meter reading. */
export interface ForecastMapping {
  /** Energy counter series the daily values come from. */
  from: string;
  /** Pass the weather forecast (sunshine, radiation) as features known in advance. */
  weather: boolean;
}

/** The PV plant for the hourly forecast (M11); the person confirms the roof planes. */
export interface PvMapping {
  /** Energy counter of the PV generation. */
  from: string;
  planes: RoofPlane[];
  maxKw?: number;
}

/** The charge plan (M12, stage A: plan and show only); needs `pv`. */
export interface PlanMapping {
  /** Energy counter of the whole house (including the wallbox). */
  load: string;
  /** Energy counter of the wallbox; subtracted from `load` and used for "charged today". */
  carEnergy?: string;
  /** Home battery state of charge in %. */
  soc: string;
  battery: {
    capacityKwh: number;
    maxChargeKw: number;
    maxDischargeKw: number;
    minSocPct: number;
    reserveKwh: number;
  };
  vehicle: { capacityKwh: number; phases: 1 | 3; minA: number; maxA: number };
}

export interface Mapping {
  timeZone: string;
  series: Record<string, SeriesMapping>;
  forecasts: Record<string, ForecastMapping>;
  pv?: PvMapping;
  plan?: PlanMapping;
}

const KINDS: EntityKind[] = [
  'power',
  'energy_counter',
  'state_of_charge',
  'capacity',
  'temperature',
  'humidity',
];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const COMMON_KEYS = [
  'source',
  'name',
  'kind',
  'unit',
  'room',
  'device',
  'scale',
  'stepMs',
  'confirmed',
  'maxPerDay',
  'helper',
];
const INFLUX_KEYS = [...COMMON_KEYS, 'measurement', 'field', 'tags'];
const HA_KEYS = [...COMMON_KEYS, 'entityId', 'maxHoldMs', 'longTerm'];
const DERIVED_KEYS = [...COMMON_KEYS, 'terms'];

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
    if (!['timeZone', 'series', 'forecasts', 'pv', 'plan', '$comment'].includes(key)) {
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
    if (source !== 'influx' && source !== 'homeassistant' && source !== 'derived') {
      errors.push(`${at}.source: "influx", "homeassistant" or "derived"`);
      continue;
    }
    const allowed =
      source === 'influx' ? INFLUX_KEYS : source === 'homeassistant' ? HA_KEYS : DERIVED_KEYS;
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) errors.push(`${at}.${key}: unknown key for source ${source}`);
    }
    if (!isText(entry.name)) errors.push(`${at}.name: required text`);
    if (!KINDS.includes(entry.kind as EntityKind)) {
      errors.push(`${at}.kind: one of ${KINDS.join(', ')}`);
    }
    if (!isText(entry.unit, 20)) errors.push(`${at}.unit: required text`);
    if (entry.room !== undefined && !isText(entry.room)) errors.push(`${at}.room: text`);
    if (entry.device !== undefined && !isText(entry.device, 60)) {
      errors.push(`${at}.device: text`);
    }
    if (entry.confirmed !== undefined && typeof entry.confirmed !== 'boolean') {
      errors.push(`${at}.confirmed: true or false`);
    }
    if (entry.helper !== undefined && typeof entry.helper !== 'boolean') {
      errors.push(`${at}.helper: true or false`);
    }
    if (
      entry.maxPerDay !== undefined &&
      (entry.kind !== 'energy_counter' ||
        typeof entry.maxPerDay !== 'number' ||
        !(entry.maxPerDay > 0))
    ) {
      errors.push(`${at}.maxPerDay: number > 0, only for energy_counter`);
    }
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
      ...(entry.device ? { device: entry.device as string } : {}),
      // Unconfirmed until the person checked it against a source they trust.
      confirmed: entry.confirmed === true,
      ...(typeof entry.maxPerDay === 'number' ? { maxPerDay: entry.maxPerDay } : {}),
      ...(source === 'derived' &&
      Array.isArray(entry.terms) &&
      entry.terms.some((x: unknown) => isObj(x) && typeof x.integrate === 'string')
        ? { derived: true }
        : {}),
    };
    const common = {
      entity,
      ...(entry.helper === true ? { helper: true } : {}),
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
    } else if (source === 'derived') {
      if (entry.kind !== 'energy_counter' || entry.unit !== 'kWh') {
        errors.push(`${at}: a derived series is an energy_counter in kWh`);
      }
      if (entry.scale !== undefined) errors.push(`${at}.scale: not for derived series`);
      const terms: DerivedTerm[] = [];
      if (!Array.isArray(entry.terms) || entry.terms.length === 0 || entry.terms.length > 8) {
        errors.push(`${at}.terms: 1 to 8 terms`);
      } else {
        entry.terms.forEach((x: unknown, i: number) => {
          const ok =
            isObj(x) &&
            Object.keys(x).every((k) => ['integrate', 'counter', 'sign'].includes(k)) &&
            (typeof x.integrate === 'string') !== (typeof x.counter === 'string') &&
            (x.sign === undefined || x.sign === 1 || x.sign === -1);
          if (!ok) {
            errors.push(
              `${at}.terms[${i}]: {"integrate": <power series>} or {"counter": <series>}, optional "sign": 1 | -1`,
            );
            return;
          }
          terms.push({
            how: typeof x.integrate === 'string' ? 'integrate' : 'counter',
            series: String(x.integrate ?? x.counter),
            sign: x.sign === -1 ? -1 : 1,
          });
        });
      }
      series[id] = { source: 'derived', ...common, terms };
    } else {
      if (typeof entry.entityId !== 'string' || !isHaEntityId(entry.entityId)) {
        errors.push(`${at}.entityId: Home Assistant entity id like "sensor.example_power"`);
      }
      if (entry.longTerm !== undefined && typeof entry.longTerm !== 'boolean') {
        errors.push(`${at}.longTerm: true or false`);
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
        ...(entry.longTerm === false ? { longTerm: false } : {}),
      };
    }
  }

  // Derived terms must point at measured series of the right kind and unit.
  for (const [id, m] of Object.entries(series)) {
    if (m.source !== 'derived') continue;
    m.terms.forEach((term, i) => {
      const at = `mapping.series.${id}.terms[${i}]`;
      const ref = Object.hasOwn(series, term.series) ? series[term.series] : undefined;
      if (!ref || ref.source === 'derived') {
        errors.push(`${at}: "${term.series}" must be an influx or homeassistant series`);
      } else if (term.how === 'integrate') {
        if (ref.entity.kind !== 'power' || !(ref.entity.unit in POWER_TO_KW)) {
          errors.push(`${at}: "${term.series}" must be power in W or kW`);
        }
      } else if (ref.entity.kind !== 'energy_counter' || !(ref.entity.unit in ENERGY_TO_KWH)) {
        errors.push(`${at}: "${term.series}" must be an energy_counter in Wh or kWh`);
      }
    });
  }

  const forecasts: Record<string, ForecastMapping> = {};
  if (raw.forecasts !== undefined) {
    if (!isObj(raw.forecasts)) errors.push('mapping.forecasts: must be an object');
    else {
      for (const [id, entry] of Object.entries(raw.forecasts)) {
        const at = `mapping.forecasts.${id}`;
        if (!NAME.test(id)) errors.push(`${at}: name must match ${NAME}`);
        if (!isObj(entry)) {
          errors.push(`${at}: must be an object`);
          continue;
        }
        for (const key of Object.keys(entry)) {
          if (!['from', 'weather'].includes(key)) errors.push(`${at}.${key}: unknown key`);
        }
        const src = typeof entry.from === 'string' ? series[entry.from] : undefined;
        if (!src || src.entity.kind !== 'energy_counter') {
          errors.push(`${at}.from: name of an energy_counter series in this mapping`);
        }
        if (entry.weather !== undefined && typeof entry.weather !== 'boolean') {
          errors.push(`${at}.weather: true or false`);
        }
        forecasts[id] = { from: String(entry.from), weather: entry.weather === true };
      }
    }
  }

  let pv: PvMapping | undefined;
  if (raw.pv !== undefined) {
    const at = 'mapping.pv';
    const p = raw.pv;
    if (!isObj(p)) errors.push(`${at}: must be an object`);
    else {
      for (const key of Object.keys(p)) {
        if (!['from', 'planes', 'maxKw'].includes(key)) errors.push(`${at}.${key}: unknown key`);
      }
      const src = typeof p.from === 'string' ? series[p.from] : undefined;
      if (!src || src.entity.kind !== 'energy_counter') {
        errors.push(`${at}.from: name of the PV energy_counter series`);
      }
      const planes: RoofPlane[] = [];
      if (!Array.isArray(p.planes) || p.planes.length === 0 || p.planes.length > 8) {
        errors.push(`${at}.planes: 1 to 8 roof planes`);
      } else {
        p.planes.forEach((pl: unknown, i: number) => {
          const q = pl as Record<string, unknown>;
          const ok =
            isObj(q) &&
            typeof q.name === 'string' &&
            /^[a-z][a-z0-9_]{0,31}$/.test(q.name) &&
            typeof q.tilt === 'number' &&
            q.tilt >= 0 &&
            q.tilt <= 90 &&
            typeof q.azimuth === 'number' &&
            q.azimuth >= -180 &&
            q.azimuth <= 180 &&
            typeof q.kwp === 'number' &&
            q.kwp > 0;
          if (!ok) {
            errors.push(
              `${at}.planes[${i}]: {name (a-z), tilt 0–90, azimuth −180–180 (0 = south, −90 = east), kwp > 0}`,
            );
          } else {
            planes.push({
              name: q.name as string,
              tilt: q.tilt as number,
              azimuth: q.azimuth as number,
              kwp: q.kwp as number,
            });
          }
        });
      }
      if (p.maxKw !== undefined && (typeof p.maxKw !== 'number' || p.maxKw <= 0)) {
        errors.push(`${at}.maxKw: number > 0`);
      }
      pv = {
        from: String(p.from),
        planes,
        ...(typeof p.maxKw === 'number' ? { maxKw: p.maxKw } : {}),
      };
    }
  }

  let plan: PlanMapping | undefined;
  if (raw.plan !== undefined) {
    const at = 'mapping.plan';
    const p = raw.plan;
    if (!isObj(p)) errors.push(`${at}: must be an object`);
    else {
      for (const key of Object.keys(p)) {
        if (!['load', 'carEnergy', 'soc', 'battery', 'vehicle'].includes(key)) {
          errors.push(`${at}.${key}: unknown key`);
        }
      }
      if (!pv) errors.push(`${at}: needs mapping.pv (hourly PV forecast)`);
      const kindOf = (name: unknown) =>
        typeof name === 'string' && Object.hasOwn(series, name) ? series[name]!.entity.kind : null;
      if (kindOf(p.load) !== 'energy_counter') {
        errors.push(`${at}.load: name of the house energy_counter series`);
      }
      if (p.carEnergy !== undefined && kindOf(p.carEnergy) !== 'energy_counter') {
        errors.push(`${at}.carEnergy: name of the wallbox energy_counter series`);
      }
      if (kindOf(p.soc) !== 'state_of_charge') {
        errors.push(`${at}.soc: name of the battery state_of_charge series`);
      }
      const num = (o: unknown, k: string, lo: number, hi: number, def?: number) => {
        const v = isObj(o) ? o[k] : undefined;
        if (v === undefined && def !== undefined) return def;
        if (typeof v !== 'number' || !(v >= lo && v <= hi)) {
          errors.push(`${at}.${k}: number ${lo}–${hi}`);
          return NaN;
        }
        return v;
      };
      if (!isObj(p.battery)) errors.push(`${at}.battery: must be an object`);
      if (!isObj(p.vehicle)) errors.push(`${at}.vehicle: must be an object`);
      const b = p.battery;
      const v = p.vehicle;
      const phases = isObj(v) ? (v.phases ?? 3) : 3;
      if (phases !== 1 && phases !== 3) errors.push(`${at}.vehicle.phases: 1 or 3`);
      plan = {
        load: String(p.load),
        ...(typeof p.carEnergy === 'string' ? { carEnergy: p.carEnergy } : {}),
        soc: String(p.soc),
        battery: {
          capacityKwh: num(b, 'capacityKwh', 0.1, 1000),
          maxChargeKw: num(b, 'maxChargeKw', 0.1, 1000),
          maxDischargeKw: num(b, 'maxDischargeKw', 0.1, 1000),
          minSocPct: num(b, 'minSocPct', 0, 100, 5),
          reserveKwh: num(b, 'reserveKwh', 0, 1000, 2),
        },
        vehicle: {
          capacityKwh: num(v, 'capacityKwh', 1, 300),
          phases: phases as 1 | 3,
          minA: num(v, 'minA', 6, 32, 6),
          maxA: num(v, 'maxA', 6, 32, 16),
        },
      };
      if (plan.vehicle.minA > plan.vehicle.maxA) errors.push(`${at}.vehicle: minA > maxA`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    mapping: {
      timeZone: raw.timeZone as string,
      series,
      forecasts,
      ...(pv ? { pv } : {}),
      ...(plan ? { plan } : {}),
    },
  };
}

/** Which back-ends a mapping needs. */
export function sourcesOf(mapping: Mapping): ('influx' | 'homeassistant')[] {
  const measured = Object.values(mapping.series).flatMap((s) =>
    s.source === 'derived' ? [] : [s.source],
  );
  return [...new Set(measured)].sort();
}
