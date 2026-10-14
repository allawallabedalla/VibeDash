/**
 * VibeDash server: serves the built app and a small read-only JSON API.
 * The browser only ever talks to this server; it never sees Influx or
 * credentials and cannot send queries (only names from local/mapping.json).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { influxClient } from '../src/adapters/influx1';
import { handleApi, type ApiDeps } from './api';
import { readConfig } from './config';
import { validateMapping } from './mapping';
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
  if (!config.influx) fail(['INFLUX_URL: required when a mapping file exists']);
  const client = influxClient(config.influx, fetch, config.timeoutMs);
  deps = {
    mode: 'influx',
    mapping: result.mapping,
    series: (m, from, to) => client.series(m, from, to),
    now: Date.now,
    log,
  };
  log(
    `influx mode: ${Object.keys(result.mapping.series).length} named series from ${config.mappingPath}`,
  );
} else {
  log(`no ${config.mappingPath}: demo mode (synthetic data in the browser)`);
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
      const r = await handleApi(req.method ?? 'GET', url, deps);
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
