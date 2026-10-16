import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/adapters/influx1';
import { createBackends } from '../../server/backends';
import { FULL_MS, handleApi, THIN_MS, type ApiDeps } from '../../server/api';
import { acceptsGzip, encodeBody, gzipStatic } from '../../server/compress';
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

  it('marks entries unconfirmed unless the person set confirmed: true', () => {
    const r = validateMapping(example);
    if (!r.ok) throw new Error('invalid');
    expect(r.mapping.series.pv_power!.entity.confirmed).toBe(false);
    const ok = validateMapping({
      timeZone: example.timeZone,
      series: { pv_power: { ...example.series.pv_power, confirmed: true } },
    });
    if (!ok.ok) throw new Error('invalid');
    expect(ok.mapping.series.pv_power!.entity.confirmed).toBe(true);
    expect(
      validateMapping({
        ...example,
        series: { pv_power: { ...example.series.pv_power, confirmed: 'yes' } },
      }).ok,
    ).toBe(false);
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
    mode: 'live',
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

function liveSeries(fetchFn: FetchLike, timeoutMs = 10_000) {
  const r = validateMapping(example);
  if (!r.ok) throw new Error('example invalid');
  const { config } = readConfig({ INFLUX_URL: 'http://influx.example', INFLUX_DB: 'x' });
  const b = createBackends(r.mapping, { ...config, timeoutMs }, fetchFn);
  if (!b.ok) throw new Error(b.errors.join());
  return b.series;
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

  it('thins out long ranges before the last two days, keeps recent samples', async () => {
    const now = 40 * 86_400_000;
    const every =
      (step: number) =>
      async (m: { entity: { id: string }; stepMs: number }, from: number, to: number) => {
        const samples = [];
        for (let t = from; t < to; t += step) samples.push({ t, v: 1 });
        return { entityId: m.entity.id, source: 'test', stepMs: m.stepMs, samples };
      };
    const d = deps({ now: () => now, series: every(60_000) });
    const long = (await get('/api/series/pv_power?range=31d', d)).body as { samples: number[][] };
    const cut = now - FULL_MS;
    const old = long.samples.filter(([t]) => t! < cut - THIN_MS);
    const recent = long.samples.filter(([t]) => t! >= cut);
    expect(old.length).toBeLessThan(31 * 288);
    expect(old.every(([t]) => t! % THIN_MS === 0)).toBe(true);
    expect(recent.length).toBeGreaterThanOrEqual(FULL_MS / 60_000 - 1);
    const day = (await get('/api/series/pv_power?range=24h', d)).body as { samples: number[][] };
    expect(day.samples).toHaveLength(24 * 60);
    // already coarse series (5-min meters) are passed through untouched
    const meter = (
      await get('/api/series/pv_energy?range=31d', deps({ now: () => now, series: every(300_000) }))
    ).body as { samples: number[][] };
    expect(meter.samples).toHaveLength(31 * 288);
  });

  it('gzips larger answers only when the client accepts it', async () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1, gzip;q=0')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
    const big = JSON.stringify({ samples: Array.from({ length: 2000 }, (_, i) => [i, 1]) });
    const z = await encodeBody(big, 'gzip');
    expect(z.headers['Content-Encoding']).toBe('gzip');
    expect((z.body as Buffer).length).toBeLessThan(big.length / 3);
    expect((await encodeBody(big, undefined)).body).toBe(big);
    expect((await encodeBody('{}', 'gzip')).headers['Content-Encoding']).toBeUndefined();
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
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    const r = await get('/api/series/pv_power', deps({ series: liveSeries(hang, 50) }));
    expect(r.status).toBe(504);
    expect(r.body).toEqual({ error: 'timeout' });
  });

  it('answers 502 "upstream" on Influx errors without leaking details', async () => {
    const fail: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'authorization failed for user secretuser',
    });
    const logs: string[] = [];
    const r = await get(
      '/api/series/pv_power',
      deps({ series: liveSeries(fail), log: (l) => logs.push(l) }),
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

describe('example mappings', () => {
  it('the Home Assistant example is valid, too', () => {
    const ha = JSON.parse(readFileSync('local/mapping.example.homeassistant.json', 'utf8'));
    expect(validateMapping(ha).ok).toBe(true);
  });
});

describe('series stored ahead of time', () => {
  it('reads a forecast up to aheadMs into the future, and checks the key', async () => {
    const raw = JSON.parse(JSON.stringify(example));
    raw.series.pv_forecast = {
      source: 'influx',
      name: 'PV forecast',
      kind: 'power',
      unit: 'kW',
      measurement: 'forecast',
      field: 'kw',
      stepMs: 3_600_000,
      aheadMs: 86_400_000,
    };
    const r = validateMapping(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let asked = 0;
    const d: ApiDeps = {
      mode: 'live',
      mapping: r.mapping,
      series: async (m, from, to) => {
        asked = to;
        return { entityId: m.entity.id, source: 'test', stepMs: m.stepMs, samples: [] };
      },
      now: () => 1_000_000_000,
      log: () => {},
    };
    await handleApi('GET', new URL('http://x/api/series/pv_forecast?range=24h'), d);
    expect(asked).toBe(1_000_000_000 + 86_400_000);
    raw.series.pv_forecast.aheadMs = 30 * 86_400_000;
    expect(validateMapping(raw).ok).toBe(false);
  });
});

describe('host check and the one write (Audit01 S-01, S-02)', () => {
  it('knows localhost and the names given, nothing else', async () => {
    const { allowedHosts, hostOf } = await import('../../server/hosts');
    const h = allowedHosts({ ALLOWED_HOSTS: 'dashboard.home, 10.0.0.5' });
    expect(h.has('localhost') && h.has('127.0.0.1') && h.has('dashboard.home')).toBe(true);
    expect(h.has('10.0.0.5')).toBe(true);
    expect(h.has('evil.example')).toBe(false);
    expect(hostOf('Evil.Example:8095')).toBe('evil.example');
    expect(hostOf('[::1]:8095')).toBe('::1');
    expect(hostOf('localhost')).toBe('localhost');
  });

  it('with ALLOWED_HOSTS_EXACT=on: only localhost and the list (Audit02 B-02)', async () => {
    const { allowedHosts } = await import('../../server/hosts');
    const { hostname } = await import('node:os');
    const h = allowedHosts({ ALLOWED_HOSTS: 'dash.home, 10.0.0.5', ALLOWED_HOSTS_EXACT: 'on' });
    expect([...h].sort()).toEqual(['10.0.0.5', '127.0.0.1', '::1', 'dash.home', 'localhost']);
    expect(h.has(hostname().toLowerCase())).toBe(false);
  });

  it('binds to this machine only unless HOST says otherwise', () => {
    expect(readConfig({}).config.host).toBe('127.0.0.1');
    expect(readConfig({ HOST: '0.0.0.0' }).config.host).toBe('0.0.0.0');
  });

  it('refuses a location write from another site or when switched off', async () => {
    let saved = 0;
    const weather = {
      enabled: true,
      location: async () => null,
      setLocation: async (l: { lat: number; lon: number }) => {
        saved++;
        return { ...l, source: 'settings' as const };
      },
      geocode: async () => null,
      forecast: async () => [],
    };
    const post = (w: object, fetchSite?: string, origin: string | null = 'http://x') =>
      handleApi('POST', new URL('http://x/api/location'), deps({ weather: w as never }), {
        body: '{"lat":50,"lon":8}',
        contentType: 'application/json',
        host: 'x',
        fetchSite,
        ...(origin ? { origin } : {}),
      });
    expect((await post(weather, 'cross-site')).status).toBe(403);
    // no Origin (curl, a script) or a foreign one: no write (Audit02 B-04)
    expect((await post(weather, undefined, null)).status).toBe(403);
    expect((await post(weather, 'same-origin', 'http://evil.example')).status).toBe(403);
    expect((await post({ ...weather, writable: false }, 'same-origin')).status).toBe(403);
    expect(saved).toBe(0);
    expect((await post(weather, 'same-origin')).status).toBe(200);
    expect(saved).toBe(1);
  });
});

describe('mapping notes', () => {
  it('accepts known events with zone and serves them', async () => {
    const raw = JSON.parse(JSON.stringify(example));
    raw.notes = [
      { from: '2026-10-13T15:42:00+02:00', to: '2026-10-13T16:15:00+02:00', text: 'Umzug' },
    ];
    const r = validateMapping(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = await handleApi('GET', new URL('http://x/api/notes'), deps({ mapping: r.mapping }));
    expect(res.body).toEqual({
      notes: [
        {
          from: Date.parse('2026-10-13T13:42:00Z'),
          to: Date.parse('2026-10-13T14:15:00Z'),
          text: 'Umzug',
        },
      ],
    });
    raw.notes = [{ from: 'gestern', to: 'heute', text: '' }];
    expect(validateMapping(raw).ok).toBe(false);
  });
});

describe('answer cache and packed files (Audit02 B-08, DE2-05)', () => {
  it('asks the backend once per series and range within the TTL', async () => {
    let calls = 0;
    let now = 1_000_000_000;
    const d = deps({
      cache: new Map(),
      now: () => now,
      series: async (m, from, to) => {
        calls++;
        return {
          entityId: m.entity.id,
          source: 'test',
          stepMs: m.stepMs,
          samples: [{ t: from, v: to }],
        };
      },
    });
    await Promise.all([
      get('/api/series/pv_power?range=24h', d),
      get('/api/series/pv_power?range=24h', d),
    ]);
    expect(calls).toBe(1);
    await get('/api/series/pv_power?range=7d', d);
    expect(calls).toBe(2);
    now += 25_000;
    await get('/api/series/pv_power?range=24h', d);
    expect(calls).toBe(3);
  });

  it('gzips built text files once, leaves images as they are', async () => {
    const js = Buffer.from('console.log(1);'.repeat(200));
    const a = await gzipStatic('/x/a.js', 'text/javascript', js, 'gzip, br', 1);
    expect(a.headers['Content-Encoding']).toBe('gzip');
    expect(a.body.length).toBeLessThan(js.length / 5);
    const b = await gzipStatic('/x/a.js', 'text/javascript', js, 'gzip', 1);
    expect(b.body).toBe(a.body);
    const png = await gzipStatic('/x/a.png', 'image/png', js, 'gzip', 1);
    expect(png.headers['Content-Encoding']).toBeUndefined();
  });
});

describe('boards (extra pages from house services)', () => {
  it('lists the boards in health and serves only mapped ones, checked', async () => {
    const r = validateMapping({
      ...example,
      boards: [{ id: 'garden', title: 'Garten', icon: 'leaf', url: 'http://127.0.0.1:9/garden' }],
    });
    if (!r.ok) throw new Error(r.errors.join());
    let asked = 0;
    const d = deps({
      mapping: r.mapping,
      board: async () => {
        asked++;
        return { updated: null, sections: [{ type: 'text', title: 'T', text: 'hallo' }] };
      },
    });
    const h = await get('/api/health', d);
    expect((h.body as { boards: unknown[] }).boards).toEqual([
      { id: 'garden', title: 'Garten', icon: 'leaf' },
    ]);
    expect((await get('/api/board/garden', d)).status).toBe(200);
    expect((await get('/api/board/other', d)).status).toBe(404);
    expect(asked).toBe(1);
    expect(
      validateMapping({ ...example, boards: [{ id: 'Bad Id', title: 'x', url: 'file:///etc' }] })
        .ok,
    ).toBe(false);
  });
});

describe('clicks on board items and the feedback backlog', () => {
  const write = (
    path: string,
    d: ApiDeps,
    body: unknown,
    origin = 'http://x',
    fetchSite = 'same-origin',
  ) =>
    handleApi('POST', new URL(path, 'http://x'), d, {
      body: JSON.stringify(body),
      contentType: 'application/json',
      host: 'x',
      origin,
      fetchSite,
    });
  const withBoards = (actionUrl?: string) => {
    const r = validateMapping({
      ...example,
      boards: [
        {
          id: 'care',
          title: 'Wartung',
          url: 'http://127.0.0.1:9/care',
          ...(actionUrl ? { actionUrl } : {}),
        },
      ],
    });
    if (!r.ok) throw new Error(r.errors.join());
    return r.mapping;
  };

  it('passes a valid click on to the house service and forgets the cached board', async () => {
    const sent: unknown[] = [];
    const cache = new Map();
    const d = deps({
      mapping: withBoards('http://127.0.0.1:9/action'),
      cache,
      board: async () => ({ updated: null, sections: [] }),
      boardAction: async (_b, a) => {
        sent.push(a);
        return { status: 200, body: { ok: true, text: 'erledigt' } };
      },
    });
    await get('/api/board/care', d);
    expect(cache.has('board|care')).toBe(true);
    const r = await write('/api/board/care/action', d, {
      item: 'plan:doors',
      action: 'done',
      date: '2026-10-16',
    });
    expect(r.status).toBe(200);
    expect(sent).toEqual([
      { board: 'care', item: 'plan:doors', action: 'done', date: '2026-10-16' },
    ]);
    expect(cache.has('board|care')).toBe(false);
    const h = (await get('/api/health', d)).body as { boards: { actions?: boolean }[] };
    expect(h.boards[0]!.actions).toBe(true);
  });

  it('refuses foreign pages, bad items, empty notes and boards without actions', async () => {
    let calls = 0;
    const d = deps({
      mapping: withBoards('http://127.0.0.1:9/action'),
      boardAction: async () => {
        calls++;
        return { status: 200, body: {} };
      },
    });
    const ok = { item: 'plan:doors', action: 'ack' };
    expect((await write('/api/board/care/action', d, ok, 'http://evil.example')).status).toBe(403);
    expect((await write('/api/board/care/action', d, ok, 'http://x', 'cross-site')).status).toBe(
      403,
    );
    expect(
      (await write('/api/board/care/action', d, { item: '../../x', action: 'ack' })).status,
    ).toBe(400);
    expect(
      (await write('/api/board/care/action', d, { item: 'plan:doors', action: 'switch' })).status,
    ).toBe(400);
    expect(
      (await write('/api/board/care/action', d, { item: 'plan:doors', action: 'comment' })).status,
    ).toBe(400);
    expect(calls).toBe(0);
    const ro = deps({ mapping: withBoards(), boardAction: d.boardAction! });
    expect((await write('/api/board/care/action', ro, ok)).status).toBe(404);
    expect(
      validateMapping({
        ...example,
        boards: [{ id: 'a', title: 'A', url: 'http://h/a', actionUrl: 'file:///x' }],
      }).ok,
    ).toBe(false);
  });

  it('keeps feedback in a local file: add, list, mark done', async () => {
    const { fileStore } = await import('../../server/feedback');
    const dir = mkdtempSync(join(tmpdir(), 'vd-fb-'));
    const store = fileStore(join(dir, 'local', 'feedback.json'), () => 1_000);
    const d = deps({ feedback: store });
    const added = await write('/api/feedback', d, {
      page: 'b/care',
      kind: 'bug',
      text: '  zu\nklein  ',
    });
    expect(added.status).toBe(200);
    const id = (added.body as { entry: { id: string; text: string } }).entry.id;
    expect((added.body as { entry: { text: string } }).entry.text).toBe('zu klein');
    expect(
      (await write('/api/feedback', d, { page: 'x', text: 'hi' }, 'http://evil.example')).status,
    ).toBe(403);
    expect((await write('/api/feedback', d, { id, status: 'done' })).status).toBe(200);
    const list = (await get('/api/feedback', d)).body as {
      entries: { status: string; kind: string }[];
    };
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ status: 'done', kind: 'bug' });
    expect((await write('/api/feedback', d, { id, status: 'gone' })).status).toBe(400);
  });
});
