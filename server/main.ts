/**
 * VibeDash server: serves the built app and a small read-only JSON API.
 * The browser only ever talks to this server; it never sees InfluxDB, Home
 * Assistant or credentials and cannot send queries (only names from
 * local/mapping.json).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { handleApi, type ApiDeps } from './api';
import { createBackends } from './backends';
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

const log = (msg: string) => console.log(`[vibedash] ${msg}`);

if (existsSync('.env')) process.loadEnvFile('.env');
const { config, errors } = readConfig(process.env);
if (errors.length) fail(errors);

let deps: ApiDeps = { mode: 'demo', now: Date.now, log };

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
  deps = { mode: 'live', mapping: result.mapping, series: backends.series, now: Date.now, log };
  log(
    `live mode (${sourcesOf(result.mapping).join(' + ')}): ${Object.keys(result.mapping.series).length} named series from ${config.mappingPath}`,
  );
} else {
  log(`no ${config.mappingPath}: demo mode (synthetic data in the browser)`);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body: string | undefined;
      if (req.method === 'POST') {
        body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) break;
        }
      }
      const r = await handleApi(req.method ?? 'GET', url, deps, {
        body,
        contentType: req.headers['content-type'],
        origin: req.headers.origin,
        host: req.headers.host,
      });
      res.writeHead(r.status, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(r.body));
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
    res.writeHead(file.status, {
      ...SECURITY_HEADERS,
      'Content-Type': file.type,
      'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : file.body);
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
