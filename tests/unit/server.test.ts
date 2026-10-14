import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { influxClient } from '../../src/adapters/influx1';
import { handleApi, type ApiDeps } from '../../server/api';
import { readConfig } from '../../server/config';
import { validateMapping } from '../../server/mapping';
import { staticFile } from '../../server/static';

const example = JSON.parse(readFileSync('local/mapping.example.json', 'utf8'));

describe('mapping schema', () => {
  it('accepts the example file', () => {
    const r = validateMapping(example);
    expect(r.ok).toBe(true);
  });

  it('rejects typos, bad names, bad kinds and bad time zones with clear messages', () => {
    const r = validateMapping({
      timeZone: 'Mars/Base',
      series: {
        'Bad-Name': {
          name: 'x',
          kind: 'power',
          unit: 'W',
          measurement: 'm',
          field: 'f',
          stepMs: 60000,
        },
        ok_name: { name: 'x', kind: 'volts', unit: 'W', measurment: 'm', field: 'f', stepMs: 5 },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join('\n');
    expect(all).toMatch(/timeZone/);
    expect(all).toMatch(/Bad-Name: name must match/);
    expect(all).toMatch(/ok_name.kind/);
    expect(all).toMatch(/ok_name.measurment: unknown key/);
    expect(all).toMatch(/ok_name.measurement: required/);
    expect(all).toMatch(/ok_name.stepMs/);
  });
});

describe('config', () => {
  it('refuses credentials inside the URL and names only the variable', () => {
    const { errors } = readConfig({ INFLUX_URL: 'http://user:secret@db:8086', INFLUX_DB: 'x' });
    expect(errors.join()).toMatch(/INFLUX_URL/);
    expect(errors.join()).not.toMatch(/secret/);
  });

  it('defaults to port 8080 and local/mapping.json', () => {
    const { config, errors } = readConfig({});
    expect(errors).toEqual([]);
    expect(config.port).toBe(8080);
    expect(config.mappingPath).toBe('local/mapping.json');
    expect(config.timeoutMs).toBe(10_000);
  });
});

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  const r = validateMapping(example);
  if (!r.ok) throw new Error('example invalid');
  return {
    mode: 'influx',
    mapping: r.mapping,
    series: async (m, from, to) => ({
      entityId: m.entity.id,
      source: 'test',
      stepMs: m.stepMs,
      samples: [
        { t: from, v: 1 },
        { t: to - 1, v: 2 },
      ],
    }),
    now: () => 1_000_000_000,
    log: () => {},
    ...over,
  };
}

const get = (path: string, d = deps()) => handleApi('GET', new URL(path, 'http://x'), d);

describe('API', () => {
  it('serves a named series for a whitelisted range', async () => {
    const r = await get('/api/series/pv_power?range=24h');
    expect(r.status).toBe(200);
    const body = r.body as { samples: number[][]; entity: { id: string } };
    expect(body.entity.id).toBe('pv_power');
    expect(body.samples).toHaveLength(2);
  });

  it('never runs anything that is not a mapped name', async () => {
    expect((await get('/api/series/unknown')).status).toBe(404);
    expect((await get('/api/series/pv_power%20OR%201')).status).toBe(404);
    expect((await get('/api/series/__proto__')).status).toBe(404);
    expect((await get('/api/query?q=DROP%20DATABASE%20x')).status).toBe(404);
    expect((await get('/api/series/pv_power?range=999d')).status).toBe(400);
    expect((await handleApi('POST', new URL('http://x/api/series/pv_power'), deps())).status).toBe(
      405,
    );
  });

  it('exposes entities but not measurements, fields or tags', async () => {
    const r = await get('/api/entities');
    const text = JSON.stringify(r.body);
    expect(text).toContain('pv_power');
    expect(text).not.toContain('example_inverter');
    expect(text).not.toContain('ac_power');
  });

  it('answers 504 "timeout" when Influx does not respond within the timeout', async () => {
    const client = influxClient(
      { url: 'http://influx.example', database: 'x' },
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
      50,
    );
    const r = await get(
      '/api/series/pv_power',
      deps({ series: (m, f, t) => client.series(m, f, t) }),
    );
    expect(r.status).toBe(504);
    expect(r.body).toEqual({ error: 'timeout' });
  });

  it('answers 502 "upstream" on Influx errors without leaking details', async () => {
    const client = influxClient({ url: 'http://influx.example', database: 'x' }, async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'authorization failed for user secretuser',
    }));
    const logs: string[] = [];
    const r = await get(
      '/api/series/pv_power',
      deps({ series: (m, f, t) => client.series(m, f, t), log: (l) => logs.push(l) }),
    );
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('secretuser');
    expect(logs.length).toBe(1);
  });

  it('reports demo mode', async () => {
    const d: ApiDeps = { mode: 'demo', now: () => 0, log: () => {} };
    expect((await get('/api/health', d)).body).toMatchObject({ source: 'demo' });
    expect((await get('/api/series/pv_power', d)).status).toBe(404);
  });
});

describe('static files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets', 'a.js'), 'x');
  writeFileSync(join(tmpdir(), 'vd-secret.txt'), 'secret');

  it('serves index and assets', async () => {
    expect((await staticFile(dir, '/'))?.type).toMatch(/html/);
    expect((await staticFile(dir, '/assets/a.js'))?.immutable).toBe(true);
  });

  it('refuses path traversal', async () => {
    expect(await staticFile(dir, '/../vd-secret.txt')).toBeNull();
    expect(await staticFile(dir, '/%2e%2e/vd-secret.txt')).toBeNull();
    expect(await staticFile(dir, '/..%2fvd-secret.txt')).toBeNull();
    expect(await staticFile(dir, '/assets')).toBeNull();
  });
});
