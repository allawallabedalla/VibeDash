/**
 * Home Assistant adapter (REST API). Pure functions plus a small client that
 * takes `fetch` as a parameter, so it runs in Node and is testable.
 *
 * Data truth for Home Assistant:
 * - HA records **state changes**, not regular samples. A value that does not
 *   change for hours is still valid – it is held until the next change.
 * - "unavailable", "unknown" and non-numeric states are real gaps (null).
 * - The entity state is what the device reports (feedback), not a command.
 * - Times are parsed from ISO strings into UTC milliseconds.
 */
import type { Entity, EntityKind, Sample, Series } from '../model/types';
import type { FetchLike } from './influx1';

export interface HaConfig {
  /** e.g. http://homeassistant.local:8123 – from .env, never committed */
  url: string;
  /** Long-lived access token of a dedicated non-admin user – from .env */
  token: string;
}

export interface HaMapping {
  entity: Entity;
  /** Home Assistant entity id, e.g. sensor.example_power */
  haEntityId: string;
  scale?: number;
  /** Step used to turn state changes into a regular series. */
  stepMs: number;
  /**
   * A value is held at most this long after its last change; then it counts
   * as a gap. Protects against devices that go silent without reporting
   * "unavailable". Default 24 h.
   */
  maxHoldMs?: number;
}

export const DEFAULT_MAX_HOLD_MS = 24 * 3_600_000;

export class HaError extends Error {}

/** One state change; v = null means unavailable/unknown (a gap starts). */
export interface StateChange {
  t: number;
  v: number | null;
}

interface HaState {
  entity_id?: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
  attributes?: Record<string, unknown>;
}

const HA_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export function isHaEntityId(id: string): boolean {
  return HA_ID.test(id);
}

function toNumber(state: string): number | null {
  if (state === 'unavailable' || state === 'unknown' || state.trim() === '') return null;
  if (state === 'on') return 1;
  if (state === 'off') return 0;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse /api/history/period responses (with minimal_response). Order is kept
 * as returned; entries for other entities are ignored.
 */
export function parseHistory(body: unknown, entityId: string): StateChange[] {
  if (!Array.isArray(body)) throw new HaError('unexpected history response');
  const out: StateChange[] = [];
  for (const list of body) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const first = list[0] as HaState;
    if (first.entity_id && first.entity_id !== entityId) continue;
    for (const raw of list as HaState[]) {
      const when = raw.last_changed ?? raw.last_updated;
      const t = when ? Date.parse(when) : Number.NaN;
      if (!Number.isFinite(t)) throw new HaError('history entry without valid time');
      out.push({ t, v: toNumber(String(raw.state)) });
    }
  }
  return out;
}

/**
 * Turn state changes into a regular series on [from, to): each step holds the
 * last reported value; steps after "unavailable" stay empty (gap), and so do
 * steps more than `maxHoldMs` after the last change. Steps before the first
 * known state stay empty, too.
 */
export function toSamples(
  changes: readonly StateChange[],
  from: number,
  to: number,
  stepMs: number,
  scale = 1,
  maxHoldMs = DEFAULT_MAX_HOLD_MS,
): Sample[] {
  const out: Sample[] = [];
  let i = 0;
  let current: number | null = null;
  let since = 0;
  let known = false;
  const start = Math.ceil(from / stepMs) * stepMs;
  for (let t = start; t < to; t += stepMs) {
    while (i < changes.length && changes[i]!.t <= t) {
      current = changes[i]!.v;
      since = changes[i]!.t;
      known = true;
      i++;
    }
    if (known && current !== null && t - since <= maxHoldMs) out.push({ t, v: current * scale });
  }
  return out;
}

export interface HaSuggestion {
  haEntityId: string;
  friendlyName: string;
  kind: EntityKind;
  unit: string;
  /** Why this kind was suggested – the person confirms before it is saved. */
  because: string;
}

/**
 * Suggest mapping candidates from /api/states. Only a suggestion: the person
 * confirms every mapping (see AGENT.md, onboarding).
 */
export function suggestFromStates(states: unknown): HaSuggestion[] {
  if (!Array.isArray(states)) throw new HaError('unexpected states response');
  const out: HaSuggestion[] = [];
  for (const s of states as HaState[]) {
    const id = s.entity_id ?? '';
    if (!id.startsWith('sensor.')) continue;
    const a = s.attributes ?? {};
    const deviceClass = String(a.device_class ?? '');
    const stateClass = String(a.state_class ?? '');
    const unit = String(a.unit_of_measurement ?? '');
    const name = String(a.friendly_name ?? id);
    let kind: EntityKind | undefined;
    if (deviceClass === 'energy' && stateClass.startsWith('total')) kind = 'energy_counter';
    else if (deviceClass === 'power') kind = 'power';
    else if (deviceClass === 'battery' && unit === '%') kind = 'state_of_charge';
    else if (deviceClass === 'temperature') kind = 'temperature';
    else if (deviceClass === 'humidity') kind = 'humidity';
    if (!kind) continue;
    out.push({
      haEntityId: id,
      friendlyName: name,
      kind,
      unit,
      because: `device_class=${deviceClass}${stateClass ? `, state_class=${stateClass}` : ''}`,
    });
  }
  return out.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.haEntityId.localeCompare(b.haEntityId),
  );
}

/**
 * Minimal client. Bearer token in a header, never in the URL. Every request
 * is aborted after `timeoutMs` (default 10 s).
 */
export function haClient(config: HaConfig, fetchFn: FetchLike, timeoutMs = 10_000) {
  const base = config.url.replace(/\/$/, '');
  async function get(path: string): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new HaError(`HTTP ${res.status}`);
    return res.json();
  }

  return {
    get,
    async states(): Promise<unknown> {
      return get('/api/states');
    },
    async series(m: HaMapping, fromMs: number, toMs: number): Promise<Series> {
      if (!isHaEntityId(m.haEntityId)) throw new HaError('invalid entity id');
      const params = new URLSearchParams({
        filter_entity_id: m.haEntityId,
        end_time: new Date(toMs).toISOString(),
        minimal_response: '',
        no_attributes: '',
        significant_changes_only: '0',
      });
      const body = await get(
        `/api/history/period/${encodeURIComponent(new Date(fromMs).toISOString())}?${params}`,
      );
      const changes = parseHistory(body, m.haEntityId);
      return {
        entityId: m.entity.id,
        source: `homeassistant:${m.haEntityId}`,
        stepMs: m.stepMs,
        samples: toSamples(changes, fromMs, toMs, m.stepMs, m.scale, m.maxHoldMs),
      };
    },
  };
}
