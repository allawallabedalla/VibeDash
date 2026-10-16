/**
 * Where the pages get their data from.
 * - With the VibeDash server in live mode: named series via /api (never queries),
 *   from InfluxDB and/or Home Assistant.
 * - Without a server (static build, dev, tests): the synthetic demo household.
 * Every request has a timeout; the UI never waits forever.
 */
import { ENTITIES, generateDemo, type DemoData, type DemoIssue } from '../demo';
import { explainedBy, type Note } from '../model/notes';
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
let charging = $state(false);
/** Extra pages from house services (mapping.boards): tab id, title, icon name. */
export interface BoardTab {
  id: string;
  title: string;
  icon: string;
  /** the board's items take clicks (done, ack, comment …) */
  actions?: boolean;
}
let boards = $state<BoardTab[]>([]);
/** the server keeps a local feedback backlog (button on every page) */
let feedback = $state(false);
let pv = $state(false);
let plan = $state(false);

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

const QUESTION_GAP = { steadyMs: 30 * 60_000, heldMs: 12 * 3_600_000 };

/** Gaps and meter resets from real data become issues → questions to the person. */
function detectIssues(
  series: Record<string, Series>,
  entities: Entity[],
  now: number,
  notes: Note[] = [],
): DemoIssue[] {
  const out: DemoIssue[] = [];
  const counters = new Set(entities.filter((e) => e.kind === 'energy_counter').map((e) => e.id));
  for (const s of Object.values(series)) {
    // a question only after a real silence: steady series ~30 min, sensors
    // that report on change only after ~12 h (answer to Audit02)
    for (const g of findGaps(s, 2.5, QUESTION_GAP)) {
      // a gap inside a known event (e.g. a server move) is no question
      if (g.to > now - RECENT_MS && !explainedBy(notes, g.from, g.to)) {
        out.push({ kind: 'gap', entityIds: [s.entityId], ...g });
      }
    }
    // Only meters can be reset; power or temperature going down is normal.
    if (!counters.has(s.entityId)) continue;
    for (const r of counterResets(s.samples)) {
      if (r.t > now - RECENT_MS && !explainedBy(notes, r.t, r.t)) {
        out.push({ kind: 'artifact', entityIds: [s.entityId], from: r.t, to: r.t });
      }
    }
  }
  return out;
}

async function loadLive(
  timeZone: string,
  backends: Backend[],
  range: '24h' | '31d',
): Promise<State> {
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
      const r = await getJson(`/api/series/${id}?range=${range}`);
      if (!r || r.status !== 200) {
        missing.push({ id, reason: reasonOf(r) });
        return;
      }
      const body = r.body as {
        samples: [number, number][];
        held?: { reports: number[]; holdMs: number };
      };
      series[id]!.samples = body.samples.map(([t, v]) => ({ t, v }));
      if (body.held && Array.isArray(body.held.reports)) series[id]!.held = body.held;
    }),
  );

  const entities = wanted.map((id) => byId.get(id) ?? ENTITIES.find((e) => e.id === id)!);
  const nb = await getJson('/api/notes');
  const notes = nb?.status === 200 ? ((nb.body as { notes?: Note[] }).notes ?? []) : [];
  return {
    status: 'ready',
    source: 'live',
    backends,
    data: {
      now,
      timeZone,
      entities,
      series,
      notes,
      issues: detectIssues(series, entities, now, notes),
    },
    missing: missing.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

let loads = 0;

export async function load(): Promise<void> {
  const run = ++loads;
  state = { status: 'loading' };
  const health = await getJson('/api/health');
  const body = health?.body as
    | {
        source?: string;
        timeZone?: string;
        backends?: Backend[];
        evcc?: boolean;
        pv?: boolean;
        plan?: boolean;
      }
    | undefined;
  evcc = body?.evcc === true;
  charging = (body as { charging?: boolean } | undefined)?.charging === true;
  const bs = (body as { boards?: unknown } | undefined)?.boards;
  boards = Array.isArray(bs)
    ? bs
        .filter(
          (b): b is BoardTab => !!b && typeof b.id === 'string' && typeof b.title === 'string',
        )
        .map((b) => ({
          id: b.id,
          title: b.title,
          icon: typeof b.icon === 'string' ? b.icon : 'info',
          ...((b as { actions?: unknown }).actions === true ? { actions: true } : {}),
        }))
    : [];
  feedback = (body as { feedback?: boolean } | undefined)?.feedback === true;
  pv = body?.pv === true;
  plan = body?.plan === true;
  if (health?.status === 200 && body?.source === 'live' && body.timeZone) {
    // The last day first, so the page is there quickly; the month follows.
    const quick = await loadLive(body.timeZone, body.backends ?? [], '24h');
    if (run !== loads) return;
    if (quick.status === 'ready') {
      state = quick;
      version++;
    }
    const full = await loadLive(body.timeZone, body.backends ?? [], '31d');
    if (run !== loads) return;
    // a failed month must not replace a working day
    if (full.status === 'ready' || quick.status !== 'ready') state = full;
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
  /** The charge plan (M12) is configured (live). The demo always has one. */
  get plan(): boolean {
    return plan;
  },
  /** evcc is connected: charging page with sessions. */
  get evcc(): boolean {
    return evcc;
  },
  /** charging from the house's own records (read-only), without evcc */
  get charging(): boolean {
    return charging;
  },
  /** Feedback button on every page (local backlog on the server). */
  get feedback(): boolean {
    return feedback;
  },
  /** Boards (extra pages from house services), in mapping order. */
  get boards(): BoardTab[] {
    return boards;
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
