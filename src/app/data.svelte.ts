/**
 * Where the pages get their data from.
 * - With the VibeDash server in live mode: named series via /api (never queries),
 *   from InfluxDB and/or Home Assistant.
 * - Without a server (static build, dev, tests): the synthetic demo household.
 * Every request has a timeout; the UI never waits forever.
 */
import { ENTITIES, generateDemo, type DemoData, type DemoIssue } from '../demo';
import { counterResets, findGaps } from '../model/series';
import type { Entity, Series } from '../model/types';

export type HouseData = DemoData;
export type Source = 'demo' | 'live';
export type Backend = 'influx' | 'homeassistant';
export type Reason = 'timeout' | 'upstream' | 'network' | 'not_mapped';

type State =
  | { status: 'loading' }
  | {
      status: 'ready';
      source: Source;
      backends: Backend[];
      data: HouseData;
      missing: { id: string; reason: Reason }[];
    }
  | { status: 'error'; reason: Reason };

const CLIENT_TIMEOUT_MS = 15_000; // server gives up after 10 s
const RECENT_MS = 48 * 3_600_000; // only ask about gaps from the last two days

let state = $state<State>({ status: 'loading' });
let version = $state(0);
let evcc = $state(false);
let pv = $state(false);

async function getJson(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) });
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') return { status: 504, body: { error: 'timeout' } };
    return null;
  }
}

function reasonOf(r: { status: number; body: unknown } | null): Reason {
  if (!r) return 'network';
  const code = (r.body as { error?: string })?.error;
  return code === 'timeout' ? 'timeout' : 'upstream';
}

/** Gaps and meter resets from real data become issues → questions to the person. */
function detectIssues(series: Record<string, Series>, now: number): DemoIssue[] {
  const out: DemoIssue[] = [];
  for (const s of Object.values(series)) {
    for (const g of findGaps(s)) {
      if (g.to > now - RECENT_MS) out.push({ kind: 'gap', entityIds: [s.entityId], ...g });
    }
    for (const r of counterResets(s.samples)) {
      if (r.t > now - RECENT_MS) {
        out.push({ kind: 'artifact', entityIds: [s.entityId], from: r.t, to: r.t });
      }
    }
  }
  return out;
}

async function loadLive(timeZone: string, backends: Backend[]): Promise<State> {
  const ents = await getJson('/api/entities');
  if (!ents || ents.status !== 200) return { status: 'error', reason: reasonOf(ents) };
  const mapped = (ents.body as { entities: (Entity & { stepMs: number })[] }).entities;
  const byId = new Map(mapped.map((e) => [e.id, e]));

  // Standard entities the pages use; unmapped ones stay empty and are reported.
  const wanted = [...new Set([...ENTITIES.map((e) => e.id), ...byId.keys()])];
  const missing: { id: string; reason: Reason }[] = [];
  const now = Date.now();
  const series: Record<string, Series> = {};

  await Promise.all(
    wanted.map(async (id) => {
      const ent = byId.get(id);
      series[id] = { entityId: id, source: 'live', stepMs: ent?.stepMs ?? 60_000, samples: [] };
      if (!ent) {
        missing.push({ id, reason: 'not_mapped' });
        return;
      }
      const r = await getJson(`/api/series/${id}?range=31d`);
      if (!r || r.status !== 200) {
        missing.push({ id, reason: reasonOf(r) });
        return;
      }
      const rows = (r.body as { samples: [number, number][] }).samples;
      series[id]!.samples = rows.map(([t, v]) => ({ t, v }));
    }),
  );

  const entities = wanted.map((id) => byId.get(id) ?? ENTITIES.find((e) => e.id === id)!);
  return {
    status: 'ready',
    source: 'live',
    backends,
    data: { now, timeZone, entities, series, issues: detectIssues(series, now) },
    missing: missing.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function load(): Promise<void> {
  state = { status: 'loading' };
  const health = await getJson('/api/health');
  const body = health?.body as
    | { source?: string; timeZone?: string; backends?: Backend[]; evcc?: boolean; pv?: boolean }
    | undefined;
  evcc = body?.evcc === true;
  pv = body?.pv === true;
  if (health?.status === 200 && body?.source === 'live' && body.timeZone) {
    state = await loadLive(body.timeZone, body.backends ?? []);
  } else {
    state = { status: 'ready', source: 'demo', backends: [], data: generateDemo(), missing: [] };
  }
  version++;
}

export const store = {
  get state(): State {
    return state;
  },
  /** The hourly PV forecast (M11) is configured. */
  get pv(): boolean {
    return pv;
  },
  /** evcc is connected: charging page with sessions. */
  get evcc(): boolean {
    return evcc;
  },
  /** Changes on every (re)load; pages are keyed on it. */
  get version(): number {
    return version;
  },
};

/** The loaded data; only call while state is "ready" (pages are rendered only then). */
export function currentData(): HouseData {
  if (state.status !== 'ready') throw new Error('data not ready');
  return state.data;
}

export function currentSource(): Source {
  return state.status === 'ready' ? state.source : 'demo';
}

export function currentBackends(): Backend[] {
  return state.status === 'ready' ? state.backends : [];
}
