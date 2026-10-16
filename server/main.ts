/**
 * VibeDash server: serves the built app and a small read-only JSON API.
 * The browser only ever talks to this server; it never sees InfluxDB, Home
 * Assistant or credentials and cannot send queries (only names from
 * local/mapping.json).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { handleApi, type ApiDeps } from './api';
import { fileStore } from './feedback';
import { codeChecker, evccAdmin, scan, stateFile } from './setup';
import { createBackends } from './backends';
import { encodeBody, gzipStatic } from './compress';
import { chargeSessions, fetchPlan } from './charging';
import type { InfluxResponse } from '../src/adapters/influx1';
import { allowedHosts, hostOf } from './hosts';
import { evccClient } from '../src/adapters/evcc';
import { forecastBridge } from './forecast-bridge';
import { planBridge } from './plan-bridge';
import { pvBridge } from './pv-bridge';
import { weatherClient } from '../src/adapters/openmeteo';
import { fromEnv, fromHomeAssistant, readSettings, writeSettings } from './location';
import type { ResolvedLocation } from './location';
import { readConfig } from './config';
import { sourcesOf, validateMapping } from './mapping';
import { staticFile } from './static';
import { sanitizeBoard } from '../src/model/board';

const log = (msg: string) => console.log(`[vibedash] ${msg}`);

if (existsSync('.env')) process.loadEnvFile('.env');
const { config, errors } = readConfig(process.env);
if (errors.length) fail(errors);

let deps: ApiDeps = { mode: 'demo', now: Date.now, log };
let backendsQuery: ((q: string) => Promise<InfluxResponse>) | null = null;

if (existsSync(config.mappingPath)) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(config.mappingPath, 'utf8'));
  } catch (e) {
    fail([`${config.mappingPath}: not valid JSON (${(e as Error).message})`]);
  }
  const result = validateMapping(raw);
  if (!result.ok) fail(result.errors);
  const backends = createBackends(result.mapping, config, fetch);
  if (!backends.ok) fail(backends.errors);
  deps = {
    mode: 'live',
    mapping: result.mapping,
    series: backends.series,
    daily: backends.daily,
    now: Date.now,
    log,
    cache: new Map(),
  };
  backendsQuery = backends.query;
  log(
    `live mode (${sourcesOf(result.mapping).join(' + ')}): ${Object.keys(result.mapping.series).length} named series from ${config.mappingPath}`,
  );
} else {
  log(`no ${config.mappingPath}: demo mode (synthetic data in the browser)`);
}

// `--check`: validate .env and the mapping with this build, then exit (release.sh
// runs it before switching, so a release never starts on a mapping it rejects)
if (process.argv.includes('--check')) {
  log('check ok');
  process.exit(0);
}

// Boards: extra pages whose content a house service supplies; checked and trimmed here.
if (deps.mapping?.boards?.length) {
  deps.board = async (b) => {
    const r = await fetch(b.url, { signal: AbortSignal.timeout(config.timeoutMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return sanitizeBoard(await r.json());
  };
  log(`boards: ${deps.mapping.boards.map((b) => b.id).join(', ')}`);
  // clicks on board items go to the house service that made the board – only to the address in the mapping
  if (deps.mapping.boards.some((b) => b.actionUrl)) {
    deps.boardAction = async (b, a) => {
      const r = await fetch(b.actionUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Haus-Aktion': '1' },
        body: JSON.stringify(a),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
  }
}

// Setup assistant (starter pack): only with evcc, its admin password and a setup code from the installer.
if (config.evcc && process.env.SETUP_CODE && process.env.EVCC_ADMIN_PASSWORD) {
  deps.setup = {
    checkCode: codeChecker(process.env.SETUP_CODE),
    state: stateFile(process.env.SETUP_STATE_PATH ?? 'local/setup.json'),
    evcc: evccAdmin(config.evcc.url, process.env.EVCC_ADMIN_PASSWORD, fetch),
    scanCidr: process.env.SCAN_CIDR || null,
    scan: (cidr) => scan(cidr),
    allowDemo: process.env.SETUP_DEMO === 'on',
  };
  log('setup assistant: /#/einrichten');
}

// Feedback button on every page: a local backlog for VibeDash itself (FEEDBACK=off disables it).
if (process.env.FEEDBACK !== 'off') {
  deps.feedback = fileStore(process.env.FEEDBACK_PATH ?? 'local/feedback.json');
}

// Car charging from the house's own records (read-only), when mapped and Influx is there.
if (deps.mapping?.charging && backendsQuery) {
  const c = deps.mapping.charging;
  const q = backendsQuery;
  const fieldOf = (id: string | undefined) => {
    const m = id ? deps.mapping!.series[id] : undefined;
    return m && m.source === 'influx' ? m : null;
  };
  const meter = fieldOf(c.gridMeter);
  const readAt = async (t: number) => {
    if (!meter) return null;
    const tags = Object.entries(meter.tags ?? {})
      .map(([k, v]) => ` AND "${k}" = '${v.replace(/'/g, "\\'")}'`)
      .join('');
    const r = await q(
      `SELECT LAST("${meter.field}") FROM "${meter.measurement}" WHERE time <= ${Math.floor(t)}ms AND time > ${Math.floor(t) - 3_600_000}ms${tags}`,
    );
    const v = r.results?.[0]?.series?.[0]?.values?.[0]?.[1];
    return typeof v === 'number' ? v * (meter.scale ?? 1) : null;
  };
  deps.charging = {
    now: async () => {
      const t = Date.now();
      const list = await chargeSessions(q, c, t - 2 * 86_400_000, t + 60_000);
      const last = list.at(-1);
      const running = !!last && last.end === null;
      let powerW: number | null = null;
      let powerAt: number | null = null;
      let kwhSoFar: number | null = null;
      const pm = c.power ? deps.mapping!.series[c.power] : undefined;
      if (pm && deps.series) {
        const from = running ? Math.min(last!.start, t - 10 * 60_000) : t - 10 * 60_000;
        const s = await deps.series(pm, from, t);
        const p = s.samples.at(-1);
        if (p && t - p.t < 3 * 60_000) {
          powerW = p.v;
          powerAt = p.t;
        }
        if (running) {
          // the meter reading of the charge comes only at its end: sum up the power meanwhile (≈)
          let wh = 0;
          const own = s.samples.filter((x) => x.t >= last!.start);
          for (let i = 1; i < own.length; i++) {
            const dt = own[i]!.t - own[i - 1]!.t;
            if (dt <= 10 * 60_000) wh += ((own[i]!.v + own[i - 1]!.v) / 2) * (dt / 3_600_000);
          }
          kwhSoFar = Math.round(wh / 10) / 100;
        }
      }
      return {
        running,
        since: running ? last!.start : null,
        source: running ? last!.source : null,
        powerW,
        powerAt,
        kwhSoFar,
      };
    },
    sessions: async (days) => {
      const t = Date.now();
      const list = (await chargeSessions(q, c, t - days * 86_400_000, t + 60_000)).filter(
        (x) => x.end !== null,
      );
      // grid import during each charge (house included): an upper bound for grid energy into the car
      for (const s of list) {
        const [a, b] = await Promise.all([readAt(s.start), readAt(s.end!)]);
        s.gridKwh = a !== null && b !== null && b >= a ? Math.round((b - a) * 100) / 100 : null;
      }
      return list;
    },
    plan: async () => (c.plan ? fetchPlan(fetch, c.plan, config.timeoutMs) : null),
  };
  log('charging: from the house records (read-only)');
}

// evcc (optional): values for "now" and the charging sessions evcc stores itself.
if (config.evcc) {
  const evcc = evccClient(config.evcc, fetch, config.timeoutMs);
  deps.evcc = { now: evcc.now, sessions: evcc.sessions };
  log('evcc: charging sessions and current values');
}

// Weather: on by default (WEATHER=off disables every external request).
const weather = weatherClient(fetch, config.timeoutMs);
const settingsPath = process.env.SETTINGS_PATH ?? 'local/settings.json';
let haLocation: ResolvedLocation | null | undefined;
deps.weather = {
  enabled: process.env.WEATHER !== 'off',
  writable: process.env.LOCATION_WRITE !== 'off',
  location: async () => {
    const own = fromEnv(process.env) ?? readSettings(settingsPath);
    if (own) return own;
    if (config.homeassistant && haLocation === undefined) {
      haLocation = await fromHomeAssistant(config.homeassistant, fetch, config.timeoutMs).catch(
        () => null,
      );
    }
    return haLocation ?? null;
  },
  setLocation: async (l) => writeSettings(settingsPath, l),
  geocode: (place, language) => weather.geocode(place, language),
  forecast: (l) => weather.forecast(l, deps.mapping?.timeZone ?? 'Europe/Berlin'),
};

// Forecasting service (Python) behind this server – optional.
if (process.env.FORECAST_URL && deps.mapping && deps.series) {
  const bridge = forecastBridge({
    url: process.env.FORECAST_URL,
    mapping: deps.mapping,
    fetchFn: fetch,
    series: deps.series,
    weather: async () => {
      const w = deps.weather;
      const l = w?.enabled ? await w.location() : null;
      return l && w ? w.forecast(l) : null;
    },
    now: Date.now,
    log,
    timeoutMs: config.timeoutMs,
  });
  deps.forecast = { names: Object.keys(deps.mapping.forecasts), read: bridge.read };
  const mapping = deps.mapping;
  const pvb = mapping.pv
    ? pvBridge({
        url: process.env.FORECAST_URL,
        mapping: { ...mapping, pv: mapping.pv },
        fetchFn: fetch,
        series: deps.series,
        location: async () => (deps.weather?.enabled ? await deps.weather.location() : null),
        weatherOn: deps.weather?.enabled ?? false,
        now: Date.now,
        log,
        timeoutMs: config.timeoutMs,
      })
    : null;
  if (pvb) deps.pv = { read: pvb.read };
  // Charge plan (stage A): plans and shows only, never switches.
  const plb =
    mapping.pv && mapping.plan
      ? planBridge({
          url: process.env.FORECAST_URL,
          mapping: { ...mapping, plan: mapping.plan },
          fetchFn: fetch,
          series: deps.series,
          location: async () => (deps.weather?.enabled ? await deps.weather.location() : null),
          weatherOn: deps.weather?.enabled ?? false,
          now: Date.now,
          log,
          timeoutMs: config.timeoutMs,
        })
      : null;
  if (plb) deps.plan = { read: plb.read, accuracy: plb.accuracy };
  const run = async () => {
    void bridge.syncAll();
    // the plan needs the PV plant first
    if (pvb) await pvb.syncAll();
    if (plb) await plb.syncAll();
  };
  setTimeout(() => void run(), 5_000);
  setInterval(() => void run(), 3_600_000).unref();
  log(`forecast service: ${Object.keys(deps.mapping.forecasts).length} daily forecasts`);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

// Build id = hash of the shipped index.html (asset names change with every build): an open page
// asks /api/health now and then and reloads itself after a release (Audit03 follow-up).
try {
  deps.build = createHash('sha256')
    .update(readFileSync(join(config.distDir, 'index.html')))
    .digest('hex')
    .slice(0, 12);
} catch {
  /* no build (dev server): pages never reload themselves */
}

const hosts = allowedHosts(process.env);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // a foreign name pointing at this server (DNS rebinding) gets nothing
  const host = hostOf(req.headers.host);
  if (!host || !hosts.has(host)) {
    res.writeHead(421, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('unknown host');
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      let body: string | undefined;
      if (req.method === 'POST') {
        body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) break;
        }
      }
      const r = await handleApi(req.method ?? 'GET', url, deps, {
        body,
        contentType: req.headers['content-type'],
        origin: req.headers.origin,
        fetchSite: req.headers['sec-fetch-site'] as string | undefined,
        host: req.headers.host,
      });
      const out = await encodeBody(JSON.stringify(r.body), req.headers['accept-encoding']);
      res.writeHead(r.status, {
        ...SECURITY_HEADERS,
        ...out.headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(out.body);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS).end();
      return;
    }
    const file = await staticFile(config.distDir, url.pathname);
    if (!file) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    // text files go gzipped (once per file, then from memory): Audit02 DE2-05
    const packed = await gzipStatic(
      file.path,
      file.type,
      file.body,
      req.headers['accept-encoding'],
      file.mtimeMs,
    );
    res.writeHead(file.status, {
      ...SECURITY_HEADERS,
      ...packed.headers,
      'Content-Type': file.type,
      'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : packed.body);
  } catch (e) {
    log(`request failed: ${(e as Error).name}`);
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
    res.end();
  }
});

server.listen(config.port, config.host, () =>
  log(`listening on http://${config.host}:${config.port}`),
);

function fail(lines: string[]): never {
  console.error('[vibedash] configuration error:\n' + lines.map((l) => `  - ${l}`).join('\n'));
  process.exit(1);
}
