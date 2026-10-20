/**
 * JSON API. Only GET, only named series, only whitelisted ranges. Errors are
 * short codes for the UI ("timeout", "upstream"), details stay in the server log.
 */
import { EvccError, type EvccNow, type EvccSession } from '../src/adapters/evcc';
import { HaError } from '../src/adapters/homeassistant';
import { InfluxError } from '../src/adapters/influx1';
import {
  validLocation,
  WeatherError,
  type Location,
  type WeatherDay,
} from '../src/adapters/openmeteo';
import type { ChargeSession, ChargingNow, PlanSummary } from './charging';
import type { ResolvedLocation } from './location';
import { thinBefore } from '../src/model/series';
import type { Series } from '../src/model/types';
import { sourcesOf, type BoardMapping, type Mapping, type SeriesMapping } from './mapping';
import type { DailyRow } from './backends';
import { ITEM_ID, sanitizeCalcResult, type Board } from '../src/model/board';
import {
  deviceBody,
  templatesFor,
  USAGES,
  type evccAdmin,
  type SetupState,
  type Usage,
} from './setup';
import {
  cleanText,
  KINDS,
  STATUSES,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackStore,
} from './feedback';
import { cleanPrefs, type TabPrefs } from './tabs';

export const RANGES = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '31d': 31 * 86_400_000,
} as const;
export type RangeName = keyof typeof RANGES;

/**
 * Long ranges are thinned out before they go over the wire: everything older
 * than FULL_MS keeps one value per THIN_MS slot. FULL_MS is a bit more than the
 * two days the UI checks for gaps and resets, so those checks see every sample.
 */
export const FULL_MS = 50 * 3_600_000;
export const THIN_MS = 5 * 60_000;
const ADDS_UP = new Set(['energy_counter', 'capacity']);

export interface ApiDeps {
  mode: 'live' | 'demo';
  /** id of the page build the server ships (pages reload themselves when it changes) */
  build?: string;
  mapping?: Mapping;
  series?: (m: SeriesMapping, fromMs: number, toMs: number) => Promise<Series>;
  /** Car charging from the house's records (read-only). */
  charging?: {
    now: () => Promise<ChargingNow>;
    sessions: (days: number) => Promise<ChargeSession[]>;
    plan: () => Promise<PlanSummary | null>;
  };
  /** A board's content from its house service, checked (src/model/board.ts). */
  board?: (b: BoardMapping) => Promise<Board | null>;
  /** Daily energy of a meter, [local day start, kWh or null]. */
  daily?: (m: SeriesMapping, fromMs: number, toMs: number) => Promise<DailyRow[]>;
  now: () => number;
  log: (msg: string) => void;
  /**
   * Short answer cache (Audit02 B-08): the same series asked again within a
   * few seconds – by another tile, tab or device – costs no new query.
   */
  cache?: Map<string, { at: number; result: Promise<ApiResult> }>;
  evcc?: {
    now: () => Promise<EvccNow>;
    sessions: (year?: number) => Promise<EvccSession[]>;
  };
  pv?: {
    read: (what: 'prognose' | 'guete' | 'status') => Promise<{ status: number; body: unknown }>;
  };
  plan?: {
    read: () => Promise<{ status: number; body: unknown }>;
    accuracy: () => Promise<{ status: number; body: unknown }>;
  };
  forecast?: {
    names: string[];
    read: (
      name: string,
      what: 'status' | 'guete' | 'prognose',
    ) => Promise<{ status: number; body: unknown }>;
  };
  /** Board item clicked (done, ack, comment, delete, undo): passed on to the board's house service. */
  boardAction?: (
    b: BoardMapping,
    a: BoardActionRequest,
  ) => Promise<{ status: number; body: unknown }>;
  /** Calculator value (slider) sent to the board's house service, which only calculates. */
  boardCalc?: (b: BoardMapping, value: number) => Promise<{ status: number; body: unknown }>;
  /** The local feedback backlog (server/feedback.ts). */
  feedback?: FeedbackStore;
  /** Setup assistant (server/setup.ts): only with the starter pack (EVCC + SETUP_CODE). */
  setup?: SetupDeps;
  /** Which tabs show and their order (server/tabs.ts), one list for the house. */
  tabs?: { writable: boolean; read: () => TabPrefs; write: (t: TabPrefs) => TabPrefs };
  weather?: {
    /** false when WEATHER=off: no external request at all */
    enabled: boolean;
    /** false when LOCATION_WRITE=off: the location can only be set in .env */
    writable?: boolean;
    location: () => Promise<ResolvedLocation | null>;
    setLocation: (l: Location & { name?: string }) => Promise<ResolvedLocation>;
    geocode: (place: string, language: string) => Promise<(Location & { name: string }) | null>;
    forecast: (l: Location) => Promise<WeatherDay[]>;
  };
}

/** Extra request details for the one write endpoint (location). */
export interface RequestInfo {
  body?: string;
  contentType?: string;
  origin?: string;
  host?: string;
  /** Sec-Fetch-Site from the browser: "same-origin" for the page itself. */
  fetchSite?: string;
}

function timeoutOr(e: Error, log: (m: string) => void, what: string): ApiResult {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    log(`${what}: timeout`);
    return json(504, { error: 'timeout' });
  }
  log(`${what}: ${e instanceof WeatherError || e instanceof EvccError ? e.message : e.name}`);
  return json(502, { error: 'upstream' });
}

/**
 * Every write: the page itself only (Origin = Host, Sec-Fetch-Site same-origin),
 * JSON, small body. Null when fine, else the refusal (Audit01 S-02, Audit02 B-04).
 */
function writeGuard(req: RequestInfo, maxBody = 1024): ApiResult | null {
  const originHost = (() => {
    try {
      return req.origin ? new URL(req.origin).host : null;
    } catch {
      return null;
    }
  })();
  if (!originHost || !req.host || originHost !== req.host)
    return json(403, { error: 'cross_origin' });
  if (req.fetchSite && req.fetchSite !== 'same-origin') return json(403, { error: 'cross_origin' });
  if (!(req.contentType ?? '').includes('application/json'))
    return json(415, { error: 'json_required' });
  if (!req.body || req.body.length > maxBody) return json(400, { error: 'bad_body' });
  return null;
}

function parseBody(req: RequestInfo): Record<string, unknown> | null {
  try {
    const b = JSON.parse(req.body ?? '');
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface SetupDeps {
  checkCode: (code: unknown) => 'ok' | 'wrong' | 'locked';
  /** general stick: the first visitor claims the assistant and gets the code (null = already claimed) */
  claim?: () => string | null;
  state: { read: () => SetupState; write: (s: SetupState) => void };
  evcc: ReturnType<typeof evccAdmin>;
  scanCidr: string | null;
  scan: (cidr: string) => Promise<{ host: string; ports: number[] }[]>;
  allowDemo: boolean;
}

/** Series of the starter mapping (mapping.evcc.json) that the assistant's check of one device confirms. */
const CONFIRMS: Record<Usage, string[]> = {
  pv: ['pv_power', 'pv_energy'],
  grid: ['grid_power'],
  battery: ['battery_power', 'battery_soc'],
};

/** The safety questions (RISIKEN.md) the assistant asks first – all must be "yes". */
export const SETUP_QUESTIONS = ['own_home', 'read_only', 'no_opening', 'ask_if_unsure'] as const;

let setupTemplates: { at: number; raw: unknown } | null = null;

async function handleSetup(
  path: string,
  method: string,
  deps: ApiDeps,
  req: RequestInfo,
): Promise<ApiResult> {
  const st = deps.setup;
  if (!st) return json(404, { error: 'no_setup' });
  const state = st.state.read();
  if (path === '/api/setup' && method === 'GET') {
    return json(200, {
      open: !state.done,
      done: state.done ?? null,
      scan: Boolean(st.scanCidr),
      questions: SETUP_QUESTIONS,
      answered: SETUP_QUESTIONS.every((q) => state.answers?.[q] === true),
      claimable: Boolean(st.claim) && !state.owner && !state.done,
    });
  }
  if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const refused = writeGuard(req, 8192);
  if (refused) return refused;
  const body = parseBody(req);
  if (!body) return json(400, { error: 'bad_body' });
  if (state.done) return json(409, { error: 'setup_closed' });
  if (path === '/api/setup/claim') {
    if (!st.claim) return json(404, { error: 'no_claim' });
    const given = st.claim();
    return given ? json(200, { code: given }) : json(409, { error: 'claimed' });
  }
  const code = st.checkCode(body.code);
  if (code === 'locked') return json(429, { error: 'too_many_tries' });
  if (code !== 'ok') return json(403, { error: 'wrong_code' });
  const step = path.slice('/api/setup/'.length);
  if (step === 'unlock') return json(200, { ok: true });
  if (step === 'answers') {
    const a = isObjRec(body.answers) ? body.answers : {};
    const answers = Object.fromEntries(SETUP_QUESTIONS.map((q) => [q, a[q] === true]));
    st.state.write({ ...state, answers });
    return json(200, { ok: true, all: SETUP_QUESTIONS.every((q) => answers[q]) });
  }
  // everything below needs all safety questions answered with yes
  if (!SETUP_QUESTIONS.every((q) => state.answers?.[q] === true)) {
    return json(409, { error: 'questions_first' });
  }
  if (step === 'scan') {
    if (body.allowed !== true) return json(400, { error: 'scan_needs_yes' });
    if (!st.scanCidr) return json(200, { found: [], note: 'scan_off' });
    if (tooMany(deps.now())) return json(429, { error: 'too_many' });
    return json(200, { found: await st.scan(st.scanCidr) });
  }
  if (step === 'finish') {
    st.state.write({ ...state, done: new Date(deps.now()).toISOString() });
    await st.evcc.restart().catch(() => null);
    return json(200, { ok: true });
  }
  const usage = USAGES.includes(body.usage as Usage) ? (body.usage as Usage) : null;
  if (!usage) return json(400, { error: 'bad_usage' });
  try {
    if (!setupTemplates || deps.now() - setupTemplates.at > 600_000) {
      const r = await st.evcc.templates();
      if (r.status !== 200) return json(502, { error: 'evcc_templates' });
      setupTemplates = { at: deps.now(), raw: r.data };
    }
    const list = templatesFor(setupTemplates.raw, usage, st.allowDemo);
    if (step === 'templates') return json(200, { templates: list });
    const t = list.find((x) => x.template === body.template);
    if (!t) return json(400, { error: 'unknown_template' });
    const values = isObjRec(body.values) ? body.values : {};
    const dev = deviceBody(t, usage, values);
    if ('error' in dev) return json(400, { error: dev.error });
    if (step === 'test') {
      const r = await st.evcc.test(dev.body);
      return json(r.status === 200 ? 200 : 502, { result: r.data });
    }
    if (step === 'save') {
      // the same device saved twice ("back" in the assistant) must not count twice (Fremdtest 7)
      const same = await sameDevice(st, dev.body);
      let name = same ?? '';
      if (!same) {
        const c = await st.evcc.create(dev.body);
        name = isObjRec(c.data) ? String(c.data.name ?? '') : '';
        if (c.status >= 300 || !name) return json(502, { error: 'evcc_create', result: c.data });
      }
      const site = await st.evcc.site();
      const cur = isObjRec(site.data) ? site.data : {};
      const list2 = (k: string) => (Array.isArray(cur[k]) ? (cur[k] as unknown[]).map(String) : []);
      const update =
        usage === 'grid'
          ? { grid: name }
          : { [usage]: [...list2(usage).filter((x) => x !== name), name] };
      const u = await st.evcc.updateSite(update);
      if (u.status >= 300) return json(502, { error: 'evcc_site', result: u.data });
      // saved only after the person's yes (and the direction for grid and battery): confirmed
      const fresh = st.state.read();
      st.state.write({ ...fresh, confirmed: { ...fresh.confirmed, [usage]: true } });
      return json(200, { ok: true, name });
    }
  } catch (e) {
    return timeoutOr(e as Error, deps.log, 'setup');
  }
  return json(404, { error: 'unknown_step' });
}

/** Name of a device evcc already has with the same template, address and use – or null. */
async function sameDevice(st: SetupDeps, body: Record<string, unknown>): Promise<string | null> {
  const r = await st.evcc.devices().catch(() => null);
  const list: unknown[] = Array.isArray(r?.data)
    ? r.data
    : isObjRec(r?.data) && Array.isArray(r.data.result)
      ? r.data.result
      : [];
  const want = (isObjRec(body.config) ? body.config : body) as Record<string, unknown>;
  for (const d of list) {
    if (!isObjRec(d)) continue;
    const c = isObjRec(d.config) ? d.config : {};
    const same = ['template', 'host', 'usage', 'port', 'id'].every(
      (k) => want[k] === undefined || String(c[k] ?? '') === String(want[k]),
    );
    if (same && typeof d.name === 'string' && d.name) return d.name;
  }
  return null;
}

const isObjRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export const BOARD_ACTIONS = [
  'done',
  'ack',
  'comment',
  'delete',
  'undo',
  'snooze',
  'choose',
] as const;
export type BoardAction = (typeof BOARD_ACTIONS)[number];
export interface BoardActionRequest {
  board: string;
  item: string;
  action: BoardAction;
  text?: string;
  date?: string;
  /** "choose": the option picked in a choice section (a-z0-9_-) */
  value?: string;
}

/** Simple brake against a stuck button or a loop: at most 30 writes a minute. */
const writes: number[] = [];
function tooMany(now: number): boolean {
  while (writes.length && now - writes[0]! > 60_000) writes.shift();
  if (writes.length >= 30) return true;
  writes.push(now);
  return false;
}

async function handleBoardAction(id: string, deps: ApiDeps, req: RequestInfo): Promise<ApiResult> {
  const b = deps.mapping?.boards?.find((x) => x.id === id);
  if (!b || !(b.actionUrl || b.module) || !deps.boardAction)
    return json(404, { error: 'no_actions' });
  const refused = writeGuard(req);
  if (refused) return refused;
  const body = parseBody(req);
  if (!body) return json(400, { error: 'bad_body' });
  const item = typeof body.item === 'string' ? body.item : '';
  const action = body.action as BoardAction;
  if (!ITEM_ID.test(item) || !BOARD_ACTIONS.includes(action))
    return json(400, { error: 'bad_action' });
  const text = action === 'comment' ? cleanText(body.text, 500) : undefined;
  if (action === 'comment' && !text) return json(400, { error: 'empty_comment' });
  const date =
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined;
  if (action === 'snooze' && !date) return json(400, { error: 'date_required' });
  const value =
    action === 'choose' && typeof body.value === 'string' && /^[a-z0-9_-]{1,32}$/.test(body.value)
      ? body.value
      : undefined;
  if (action === 'choose' && !value) return json(400, { error: 'value_required' });
  if (tooMany(deps.now())) return json(429, { error: 'too_many' });
  try {
    const r = await deps.boardAction(b, {
      board: b.id,
      item,
      action,
      ...(text ? { text } : {}),
      ...(date ? { date } : {}),
      ...(value ? { value } : {}),
    });
    // the board shows the change on the next look
    deps.cache?.delete(`board|${b.id}`);
    const ok = r.status >= 200 && r.status < 300;
    const said = (r.body as { text?: unknown } | null)?.text;
    return json(ok ? 200 : 502, { ok, text: cleanText(said, 120) });
  } catch (e) {
    return timeoutOr(e as Error, deps.log, `board ${b.id} action`);
  }
}

/** A calculation can take a while: at most 6 a minute, one at a time. */
const calcs: number[] = [];
let calcBusy = false;

async function handleBoardCalc(id: string, deps: ApiDeps, req: RequestInfo): Promise<ApiResult> {
  const b = deps.mapping?.boards?.find((x) => x.id === id);
  if (!b || !(b.calcUrl || b.module) || !deps.boardCalc) return json(404, { error: 'no_calc' });
  const refused = writeGuard(req, 200);
  if (refused) return refused;
  const body = parseBody(req);
  const value = body?.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000)
    return json(400, { error: 'bad_value' });
  const now = deps.now();
  while (calcs.length && now - calcs[0]! > 60_000) calcs.shift();
  if (calcBusy || calcs.length >= 6) return json(429, { error: 'too_many' });
  calcs.push(now);
  calcBusy = true;
  try {
    const r = await deps.boardCalc(b, value);
    const sections = r.status >= 200 && r.status < 300 ? sanitizeCalcResult(r.body) : null;
    if (!sections) return json(502, { error: 'upstream' });
    return json(200, { sections });
  } catch (e) {
    return timeoutOr(e as Error, deps.log, `board ${b.id} calc`);
  } finally {
    calcBusy = false;
  }
}

async function handleFeedback(method: string, deps: ApiDeps, req: RequestInfo): Promise<ApiResult> {
  const f = deps.feedback;
  if (!f) return json(404, { error: 'no_feedback' });
  if (method === 'GET') {
    const entries = f.list();
    return json(200, { entries: entries.slice(-200).reverse() });
  }
  const refused = writeGuard(req, 2048);
  if (refused) return refused;
  const body = parseBody(req);
  if (!body) return json(400, { error: 'bad_body' });
  if (tooMany(deps.now())) return json(429, { error: 'too_many' });
  if (typeof body.id === 'string') {
    const status = body.status as FeedbackStatus;
    if (!STATUSES.includes(status)) return json(400, { error: 'bad_status' });
    const e = f.setStatus(body.id.slice(0, 20), status);
    return e ? json(200, { entry: e }) : json(404, { error: 'unknown_entry' });
  }
  const text = cleanText(body.text, 1000);
  const page = cleanText(body.page, 60);
  const kind = KINDS.includes(body.kind as FeedbackKind) ? (body.kind as FeedbackKind) : 'idea';
  if (!text || !page) return json(400, { error: 'bad_body' });
  return json(200, { entry: f.add({ page, kind, text }) });
}

function handleTabs(method: string, deps: ApiDeps, req: RequestInfo): ApiResult {
  const t = deps.tabs;
  if (!t) return json(404, { error: 'not_found' });
  if (method === 'GET') return json(200, { tabs: t.read(), writable: t.writable });
  if (!t.writable) return json(403, { error: 'tabs_write_off' });
  const refused = writeGuard(req, 4096);
  if (refused) return refused;
  let prefs: TabPrefs | null;
  try {
    prefs = cleanPrefs(JSON.parse(req.body ?? ''));
  } catch {
    prefs = null;
  }
  if (!prefs) return json(400, { error: 'bad_body' });
  return json(200, { tabs: t.write(prefs) });
}

async function handleLocation(method: string, deps: ApiDeps, req: RequestInfo): Promise<ApiResult> {
  const w = deps.weather;
  if (!w) return json(404, { error: 'not_found' });
  if (method === 'GET') {
    return json(200, { enabled: w.enabled, location: w.enabled ? await w.location() : null });
  }
  // The only write: switchable, same origin, JSON, tiny body.
  if (!w.enabled) return json(409, { error: 'weather_off' });
  if (w.writable === false) return json(403, { error: 'location_write_off' });
  // every browser sends Origin on a POST; without it (curl, scripts) no write (Audit02 B-04)
  const refused = writeGuard(req);
  if (refused) return refused;
  let body: { lat?: unknown; lon?: unknown; place?: unknown; language?: unknown };
  try {
    body = JSON.parse(req.body ?? '');
  } catch {
    return json(400, { error: 'bad_body' });
  }
  try {
    if (typeof body.place === 'string') {
      const place = body.place.trim().slice(0, 80);
      if (!place) return json(400, { error: 'bad_body' });
      const lang = body.language === 'en' ? 'en' : 'de';
      const found = await w.geocode(place, lang);
      if (!found) return json(404, { error: 'place_not_found' });
      return json(200, { location: await w.setLocation(found) });
    }
    const l = { lat: Number(body.lat), lon: Number(body.lon) };
    if (!validLocation(l)) return json(400, { error: 'bad_location' });
    return json(200, { location: await w.setLocation(l) });
  } catch (e) {
    return timeoutOr(e as Error, deps.log, 'location');
  }
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResult => ({ status, body });

/** Does evcc know a wallbox? Asked at most every 5 minutes; when evcc does not answer: yes (as before). */
async function evccHasLoadpoint(deps: ApiDeps): Promise<boolean> {
  const r = await cached(deps, 'evcc|loadpoints', 300_000, async () => {
    try {
      const n = await deps.evcc!.now();
      return json(200, { has: n.loadpoints.length > 0 });
    } catch {
      return json(200, { has: true }); // kept too: a silent evcc must not slow every page load
    }
  });
  return (r.body as { has: boolean }).has;
}

/** TTL of cached answers: "now" ranges briefly, long ranges and days longer. */
export const CACHE_MS = { short: 20_000, long: 120_000, daily: 600_000 } as const;

/** One answer per key and TTL; concurrent asks share it; only 200s are kept. */
function cached(
  deps: ApiDeps,
  key: string,
  ttlMs: number,
  make: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const c = deps.cache;
  if (!c) return make();
  const now = deps.now();
  const hit = c.get(key);
  if (hit && now - hit.at < ttlMs) return hit.result;
  const result = make().then((r) => {
    if (r.status !== 200) c.delete(key);
    return r;
  });
  c.set(key, { at: now, result });
  // keep the map small: drop what is old
  if (c.size > 500) for (const [k, v] of c) if (now - v.at > CACHE_MS.daily) c.delete(k);
  return result;
}

export async function handleApi(
  method: string,
  url: URL,
  deps: ApiDeps,
  req: RequestInfo = {},
): Promise<ApiResult> {
  const path = url.pathname;
  if (path === '/api/location' && (method === 'GET' || method === 'POST')) {
    return handleLocation(method, deps, req);
  }
  if (path === '/api/setup' || path.startsWith('/api/setup/')) {
    return handleSetup(path, method, deps, req);
  }
  if (path === '/api/tabs' && (method === 'GET' || method === 'POST')) {
    return handleTabs(method, deps, req);
  }
  if (path === '/api/feedback' && (method === 'GET' || method === 'POST')) {
    return handleFeedback(method, deps, req);
  }
  const ba = /^\/api\/board\/([a-z][a-z0-9_-]{0,31})\/action$/.exec(path);
  if (ba && method === 'POST') return handleBoardAction(ba[1]!, deps, req);
  const bc = /^\/api\/board\/([a-z][a-z0-9_-]{0,31})\/calc$/.exec(path);
  if (bc && method === 'POST') return handleBoardCalc(bc[1]!, deps, req);
  if (method !== 'GET') return json(405, { error: 'method_not_allowed' });

  if (path === '/api/evcc/now' || path === '/api/evcc/sessions') {
    if (!deps.evcc) return json(404, { error: 'no_evcc' });
    try {
      if (path === '/api/evcc/now') return json(200, await deps.evcc.now());
      const y = url.searchParams.get('year');
      if (y !== null && !/^20\d{2}$/.test(y)) return json(400, { error: 'bad_year' });
      return json(200, { sessions: await deps.evcc.sessions(y ? Number(y) : undefined) });
    } catch (e) {
      return timeoutOr(e as Error, deps.log, 'evcc');
    }
  }

  if (path === '/api/weather') {
    const w = deps.weather;
    if (!w || !w.enabled) return json(404, { error: 'weather_off' });
    const l = await w.location();
    if (!l) return json(404, { error: 'no_location' });
    try {
      return json(200, { location: l, days: await w.forecast(l) });
    } catch (e) {
      return timeoutOr(e as Error, deps.log, 'weather');
    }
  }

  if (path === '/api/health') {
    return json(200, {
      ok: true,
      source: deps.mode,
      backends: deps.mapping ? sourcesOf(deps.mapping) : [],
      // evcc without a wallbox (only reading the meters) is no charging page (Fremdtest 10)
      evcc: deps.evcc ? await evccHasLoadpoint(deps) : false,
      charging: Boolean(deps.charging),
      pv: Boolean(deps.pv),
      plan: Boolean(deps.plan),
      timeZone: deps.mapping?.timeZone ?? null,
      boards: (deps.mapping?.boards ?? []).map(
        ({ id, title, icon, actionUrl, module, calcUrl, onPage }) => ({
          id,
          title,
          icon,
          ...(module ? { module } : {}),
          ...((actionUrl || module) && deps.boardAction ? { actions: true } : {}),
          ...(calcUrl && deps.boardCalc ? { calc: true } : {}),
          ...(onPage ? { onPage } : {}),
        }),
      ),
      feedback: Boolean(deps.feedback),
      ...(deps.tabs ? { tabs: deps.tabs.read(), tabsWritable: deps.tabs.writable } : {}),
      build: deps.build ?? null,
      setup: deps.setup ? !deps.setup.state.read().done : false,
    });
  }

  const bm = /^\/api\/board\/([a-z][a-z0-9_-]{0,31})$/.exec(path);
  if (bm) {
    const b = deps.mapping?.boards?.find((x) => x.id === bm[1]);
    if (!b || !deps.board) return json(404, { error: 'unknown_board' });
    const get = deps.board;
    return cached(deps, `board|${b.id}`, CACHE_MS.long / 2, async () => {
      try {
        const board = await get(b);
        return board ? json(200, board) : json(502, { error: 'not_a_board' });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          return json(504, { error: 'timeout' });
        deps.log(`board ${b.id}: ${e.message}`);
        return json(502, { error: 'upstream' });
      }
    });
  }

  if (deps.mode === 'demo' || !deps.mapping || !deps.series) {
    return json(404, { error: 'demo_mode' });
  }

  const pvm = /^\/api\/pv\/(prognose|guete|status)$/.exec(path);
  if (pvm) {
    if (!deps.pv) return json(404, { error: 'no_pv_forecast' });
    const r = await deps.pv.read(pvm[1] as 'prognose' | 'guete' | 'status');
    return json(r.status, r.body);
  }

  if (path === '/api/plan' || path === '/api/plan/guete') {
    if (!deps.plan) return json(404, { error: 'no_charge_plan' });
    const r = path === '/api/plan' ? await deps.plan.read() : await deps.plan.accuracy();
    return json(r.status, r.body);
  }

  if (path === '/api/forecasts') {
    return json(200, { names: deps.forecast?.names ?? [] });
  }
  const fc = /^\/api\/forecast\/([a-z][a-z0-9_]{0,63})\/(status|guete|prognose)$/.exec(path);
  if (fc) {
    if (!deps.forecast) return json(404, { error: 'no_forecast_service' });
    const r = await deps.forecast.read(fc[1]!, fc[2] as 'status' | 'guete' | 'prognose');
    return json(r.status, r.body);
  }

  if (path === '/api/charging') {
    if (!deps.charging) return json(404, { error: 'no_charging' });
    const days = Number(url.searchParams.get('days') ?? '31');
    if (!Number.isInteger(days) || days < 1 || days > 400) return json(400, { error: 'bad_days' });
    try {
      const [now, sessions, plan] = await Promise.all([
        deps.charging.now(),
        deps.charging.sessions(days),
        deps.charging.plan().catch((e: Error) => {
          deps.log(`charging plan: ${e.message}`);
          return null;
        }),
      ]);
      const c = deps.mapping.charging;
      return json(200, {
        now,
        sessions,
        plan,
        maxKw: c?.maxKw ?? null,
        powerSeries: c?.power ?? null,
        span: c?.plan?.span ?? null,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError')
        return json(504, { error: 'timeout' });
      deps.log(`charging: ${e instanceof InfluxError ? e.message : e.name}`);
      return json(502, { error: 'upstream' });
    }
  }

  if (path === '/api/notes') {
    return json(200, { notes: deps.mapping.notes ?? [] });
  }

  if (path === '/api/entities') {
    // what the person confirmed in the setup assistant (yes + direction) is no longer "being checked" (Fremdtest 11)
    const ok = deps.setup?.state.read().confirmed ?? {};
    const byAssistant = (id: string) =>
      Object.entries(CONFIRMS).some(([u, ids]) => ok[u as Usage] && ids.includes(id)) ||
      (id.startsWith('load_') && ok.grid === true && ok.pv === true);
    return json(200, {
      timeZone: deps.mapping.timeZone,
      entities: Object.entries(deps.mapping.series)
        .filter(([, m]) => !m.helper)
        .map(([id, m]) => ({
          ...m.entity,
          ...(byAssistant(id) ? { confirmed: true } : {}),
          stepMs: m.stepMs,
        })),
    });
  }

  const dm = /^\/api\/daily\/([a-z][a-z0-9_]{0,63})$/.exec(path);
  if (dm) {
    const name = dm[1]!;
    const m = Object.hasOwn(deps.mapping.series, name) ? deps.mapping.series[name] : undefined;
    if (!m || m.helper) return json(404, { error: 'unknown_series' });
    if (!deps.daily || m.source !== 'influx' || m.entity.kind !== 'energy_counter') {
      return json(400, { error: 'not_a_meter' });
    }
    const days = Number(url.searchParams.get('days') ?? '400');
    if (!Number.isInteger(days) || days < 1 || days > 800) return json(400, { error: 'bad_days' });
    const daily = deps.daily;
    return cached(deps, `daily|${name}|${days}`, CACHE_MS.daily, async () => {
      const now = deps.now();
      try {
        const rows = await daily(m, now - days * 86_400_000, now);
        return json(200, { name, unit: 'kWh', days: rows });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          return json(504, { error: 'timeout' });
        deps.log(`daily ${name}: ${e instanceof InfluxError ? e.message : e.name}`);
        return json(502, { error: 'upstream' });
      }
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
    const ttl = range === '1h' || range === '24h' ? CACHE_MS.short : CACHE_MS.long;
    const read = deps.series;
    return cached(deps, `series|${name}|${range}`, ttl, async () => {
      const now = deps.now();
      const from = now - RANGES[range as RangeName];
      // forecasts are stored ahead of time: read them up to aheadMs into the future
      const to = now + (m.aheadMs ?? 0);
      try {
        const s = await read(m, from, to);
        const before = Math.floor((now - FULL_MS) / THIN_MS) * THIN_MS;
        const samples =
          m.stepMs < THIN_MS && before > from
            ? thinBefore(s.samples, before, THIN_MS, ADDS_UP.has(m.entity.kind) ? 'last' : 'mean')
            : s.samples;
        return json(200, {
          name,
          entity: m.entity,
          stepMs: m.stepMs,
          from,
          to,
          samples: samples.map((x) => [x.t, x.v]),
          ...(s.held ? { held: s.held } : {}),
        });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          deps.log(`series ${name}: timeout`);
          return json(504, { error: 'timeout' });
        }
        const known = e instanceof InfluxError || e instanceof HaError;
        deps.log(`series ${name}: ${known ? e.message : e.name}`);
        return json(502, { error: 'upstream' });
      }
    });
  }

  return json(404, { error: 'not_found' });
}
