/**
 * Where the pages get their data from.
 * - With the VibeDash server in live mode: named series via /api (never queries),
 *   from InfluxDB and/or Home Assistant.
 * - Without a server (static build, dev, tests): the synthetic demo household.
 * Every request has a timeout; the UI never waits forever.
 */
import { ENTITIES, generateDemo, type DemoData, type DemoIssue } from '../demo';
import { explainedBy, type Note } from '../model/notes';
import { newBuild } from '../model/release';
import { counterResets, findGaps, joinRecent } from '../model/series';
import type { Entity, Series } from '../model/types';
import { loading, thin } from './loading';
import { NO_PREFS, type TabPrefs } from './tabs';

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
/** time of the snapshot shown until fresh data are in (null = fresh) */
let stale = $state<number | null>(null);
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
  /** the board's calculators (slider + button) may send values */
  calc?: boolean;
  /** shown on that page instead of a tab of its own */
  onPage?: 'charging';
  /** the VibeDash module behind it (modules/), if any */
  module?: string;
}
let boards = $state<BoardTab[]>([]);
/** the server keeps a local feedback backlog (button on every page) */
let feedback = $state(false);
/** the person's tab choice (server/tabs.ts) and whether it may be changed here */
let tabPrefs = $state<TabPrefs>(NO_PREFS);
let tabsWritable = $state(false);
/** the setup assistant is still open (starter pack, not finished) */
let setupOpen = $state(false);
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

type Ready = Extract<State, { status: 'ready' }>;

async function loadLive(
  timeZone: string,
  backends: Backend[],
  range: '24h' | '31d',
  /** called with the house so far while the series arrive (at most every 150 ms) */
  progress?: (partial: Ready) => void,
  /** series to show until the fresh ones are in (snapshot of the last visit) */
  base?: Record<string, Series>,
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
  const entities = wanted.map((id) => byId.get(id) ?? ENTITIES.find((e) => e.id === id)!);
  for (const id of wanted)
    series[id] = base?.[id] ?? {
      entityId: id,
      source: 'live',
      stepMs: byId.get(id)?.stepMs ?? 60_000,
      samples: [],
    };
  let left = wanted.filter((id) => byId.has(id)).length;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const partial = (): Ready => ({
    status: 'ready',
    source: 'live',
    backends,
    data: {
      now: base ? Date.now() : now,
      timeZone,
      entities,
      series: { ...series },
      notes: [],
      issues: [],
    },
    missing: [],
  });
  const flush = () => {
    timer = undefined;
    loading.pending = left;
    progress?.(partial());
  };
  if (progress) {
    loading.pending = left;
    if (!base) progress(partial());
  }

  await Promise.all(
    wanted.map(async (id) => {
      const ent = byId.get(id);
      if (!ent) {
        series[id] = { entityId: id, source: 'live', stepMs: 60_000, samples: [] };
        missing.push({ id, reason: 'not_mapped' });
        return;
      }
      const r = await getJson(`/api/series/${id}?range=${range}`);
      left--;
      if (!r || r.status !== 200) {
        series[id] = { entityId: id, source: 'live', stepMs: ent.stepMs ?? 60_000, samples: [] };
        missing.push({ id, reason: reasonOf(r) });
      } else {
        const body = r.body as {
          samples: [number, number][];
          held?: { reports: number[]; holdMs: number };
        };
        series[id] = {
          entityId: id,
          source: 'live',
          stepMs: ent.stepMs ?? 60_000,
          samples: body.samples.map(([t, v]) => ({ t, v })),
          ...(body.held && Array.isArray(body.held.reports) ? { held: body.held } : {}),
        };
      }
      // one tile after the other: hand over what is there, in small batches
      if (progress && !timer) timer = setTimeout(flush, 150);
    }),
  );
  if (timer) clearTimeout(timer);
  loading.pending = 0;

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

/**
 * Release check: the build id from /api/health at first load; every 5 minutes
 * and whenever the page becomes visible again (only while visible) the page
 * asks again and reloads itself when
 * a new build is live – so a phone tab never keeps old code for hours. Never
 * while a dialog is open or something is being typed.
 */
let build: string | null = null;
let buildTimer: ReturnType<typeof setInterval> | undefined;
export function busyTyping(): boolean {
  if (typeof document === 'undefined') return true;
  const el = document.activeElement;
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  return typing || !!document.querySelector('dialog[open]');
}
function watchBuild(first: unknown) {
  if (typeof first !== 'string' || !first || buildTimer || typeof window === 'undefined') return;
  build = first;
  const check = async () => {
    if (document.visibilityState !== 'visible' || busyTyping()) return;
    const h = await getJson('/api/health');
    if (newBuild(build, (h?.body as { build?: unknown } | undefined)?.build)) location.reload();
  };
  buildTimer = setInterval(() => void check(), 5 * 60_000);
  // A phone app kept in memory comes back without a reload: ask right away
  // when the page becomes visible again, not only on the next 5-minute tick.
  document.addEventListener('visibilitychange', () => void check());
}

/**
 * Keep an open page current (Nutzer 22.10.2026: a tab open since the morning still showed the morning's battery
 * level next to a fresh energy-flow card). Every minute while visible the last day is fetched again, the month only
 * every 15 minutes; a page that comes back after a while is refreshed at once. Never while something is typed.
 */
const REFRESH_MS = 60_000;
const REFRESH_MONTH_MS = 15 * 60_000;
let lastLoad = 0;
let lastMonth = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
export function keepFresh(): void {
  if (refreshTimer || typeof window === 'undefined') return;
  const tick = () => {
    if (document.visibilityState !== 'visible' || busyTyping() || state.status !== 'ready') return;
    if (Date.now() - lastLoad < REFRESH_MS - 1_000) return;
    void load({ month: Date.now() - lastMonth >= REFRESH_MONTH_MS });
  };
  refreshTimer = setInterval(tick, REFRESH_MS);
  document.addEventListener('visibilitychange', tick);
}

export async function load(opts: { month?: boolean } = {}): Promise<void> {
  const month = opts.month ?? true;
  lastLoad = Date.now();
  if (month) lastMonth = lastLoad;
  const run = ++loads;
  // a page that is there stays there while it is refreshed
  if (state.status !== 'ready') state = { status: 'loading' };
  const health = await getJson('/api/health');
  watchBuild((health?.body as { build?: unknown } | undefined)?.build);
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
        // the flags (actions, calc, onPage) come from this server's own answer, already checked
        .map((b) => ({ ...b, icon: typeof b.icon === 'string' ? b.icon : 'info' }))
    : [];
  feedback = (body as { feedback?: boolean } | undefined)?.feedback === true;
  setupOpen = (body as { setup?: boolean } | undefined)?.setup === true;
  const tp = (body as { tabs?: Partial<TabPrefs> } | undefined)?.tabs;
  tabPrefs = {
    hidden: Array.isArray(tp?.hidden) ? tp.hidden.filter((x) => typeof x === 'string') : [],
    order: Array.isArray(tp?.order) ? tp.order.filter((x) => typeof x === 'string') : [],
  };
  tabsWritable = (body as { tabsWritable?: boolean } | undefined)?.tabsWritable === true;
  pv = body?.pv === true;
  plan = body?.plan === true;
  if (health?.status === 200 && body?.source === 'live' && body.timeZone) {
    // At once: the last visit's snapshot (if any), marked with its time; then the last day series by series,
    // so tile after tile turns fresh; the month follows. The page stays (no reload between the steps).
    const snap = state.status === 'ready' ? null : readSnapshot(body.timeZone);
    if (snap) {
      state = snap;
      stale = snap.data.now;
    }
    const keep = state.status === 'ready' ? state.data.series : undefined;
    const quick = await loadLive(
      body.timeZone,
      body.backends ?? [],
      '24h',
      (p) => {
        if (run === loads) state = p;
      },
      keep,
    );
    if (run !== loads) return;
    if (quick.status === 'ready') {
      state = quick;
      stale = null;
      saveSnapshot(quick);
    } else if (state.status !== 'ready') state = quick;
    if (!month) {
      // only the last day was fetched: keep the older part of the month the page already has
      if (quick.status === 'ready' && keep) {
        const series = Object.fromEntries(
          Object.entries(quick.data.series).map(([id, x]) => [id, joinRecent(keep[id], x)]),
        );
        const d = quick.data;
        state = {
          ...quick,
          data: { ...d, series, issues: detectIssues(series, d.entities, d.now, d.notes) },
        };
      }
      return;
    }
    const full = await loadLive(body.timeZone, body.backends ?? [], '31d');
    if (run !== loads) return;
    // a failed month must not replace a working day
    if (full.status === 'ready' || quick.status !== 'ready') state = full;
  } else {
    state = { status: 'ready', source: 'demo', backends: [], data: generateDemo(), missing: [] };
    version++;
  }
}

// ── snapshot of the last visit (this device only) ─────────────────────────────
const SNAP_KEY = 'vibedash.snapshot.v1';
const SNAP_MAX_AGE_MS = 24 * 3_600_000;
const SNAP_POINTS = 300;

function saveSnapshot(st: Ready) {
  try {
    const series: Record<string, Series> = {};
    for (const [id, x] of Object.entries(st.data.series))
      series[id] = { ...x, samples: thin(x.samples, SNAP_POINTS) };
    localStorage.setItem(
      SNAP_KEY,
      JSON.stringify({ v: 1, backends: st.backends, data: { ...st.data, series } }),
    );
  } catch {
    /* private mode, full storage: the next visit simply loads as before */
  }
}

function readSnapshot(timeZone: string): Ready | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as { v?: number; backends?: Backend[]; data?: HouseData };
    const d = x.data;
    if (x.v !== 1 || !d || d.timeZone !== timeZone || typeof d.now !== 'number') return null;
    if (Date.now() - d.now > SNAP_MAX_AGE_MS || !d.series || !Array.isArray(d.entities))
      return null;
    return { status: 'ready', source: 'live', backends: x.backends ?? [], data: d, missing: [] };
  } catch {
    return null;
  }
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
  /** The setup assistant is open (banner on the pages). */
  get setupOpen(): boolean {
    return setupOpen;
  },
  /** Feedback button on every page (local backlog on the server). */
  get feedback(): boolean {
    return feedback;
  },
  /** Hidden tabs and their order, as the person chose (one list for the house). */
  get tabPrefs(): TabPrefs {
    return tabPrefs;
  },
  set tabPrefs(p: TabPrefs) {
    tabPrefs = p;
  },
  /** The tab choice may be changed on this server. */
  get tabsWritable(): boolean {
    return tabsWritable;
  },
  /** Boards (extra pages from house services), in mapping order. */
  get boards(): BoardTab[] {
    return boards;
  },
  /** Time of the last visit's snapshot while it is shown (null when the data are fresh). */
  get stale(): number | null {
    return stale;
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
