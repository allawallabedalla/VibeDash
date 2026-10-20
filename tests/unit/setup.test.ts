import { mkdtempSync, readFileSync } from 'node:fs';
import { validateMapping } from '../../server/mapping';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApi, type ApiDeps, type SetupDeps } from '../../server/api';
import {
  cidrHosts,
  claimChecker,
  codeChecker,
  deviceBody,
  privateHost,
  scan,
  stateFile,
  templatesFor,
} from '../../server/setup';

/** Two templates shaped like evcc's /api/config/templates/meter answer (synthetic). */
const RAW = [
  {
    Template: 'acme-hybrid',
    Products: [{ Brand: 'Acme', Description: 'Hybrid', Capabilities: ['battery-control'] }],
    Requirements: { Description: 'Lokale Schnittstelle einschalten.' },
    Params: [
      { Name: 'modbus', Choice: ['rs485', 'tcpip'], Port: 502, ID: 1, Required: true },
      { Name: 'usage', Choice: ['grid', 'pv', 'battery'] },
      {
        Name: 'capacity',
        Description: 'Akkukapazität',
        Type: 'Float',
        Unit: 'kWh',
        Usages: ['battery'],
      },
      {
        Name: 'maxacpower',
        Description: 'Max AC',
        Type: 'Float',
        Advanced: true,
        Default: '0',
        Usages: ['pv'],
      },
    ],
  },
  {
    Template: 'serial-only',
    Products: [{ Brand: 'Old' }],
    Params: [{ Name: 'modbus', Choice: ['rs485'] }],
  },
  {
    Template: 'demo-meter',
    Products: [{ Brand: 'Demo' }],
    Params: [
      { Name: 'usage', Choice: ['grid', 'pv', 'battery'] },
      { Name: 'power', Type: 'Int' },
    ],
  },
];

describe('setup assistant: building blocks', () => {
  it('offers only network templates for the usage, no demo unless allowed', () => {
    const pv = templatesFor(RAW, 'pv');
    expect(pv.map((t) => t.template)).toEqual(['acme-hybrid']);
    expect(pv[0]!.params.map((p) => p.name)).toEqual(['host', 'port', 'id', 'maxacpower']);
    expect(templatesFor(RAW, 'battery')[0]!.params.map((p) => p.name)).toContain('capacity');
    expect(templatesFor(RAW, 'pv', true).map((t) => t.template)).toContain('demo-meter');
  });

  it('builds the evcc body only from known fields, home network only', () => {
    const t = templatesFor(RAW, 'pv')[0]!;
    expect(deviceBody(t, 'pv', { host: '192.168.1.20', extra: 'x' })).toEqual({
      body: {
        type: 'template',
        template: 'acme-hybrid',
        usage: 'pv',
        host: '192.168.1.20',
        port: '502',
        id: '1',
        maxacpower: '0',
        modbus: 'tcpip',
      },
    });
    expect(deviceBody(t, 'pv', {})).toEqual({ error: 'missing:host' });
    expect(deviceBody(t, 'pv', { host: '8.8.8.8' })).toEqual({ error: 'host_not_private' });
    expect(deviceBody(t, 'pv', { host: '10.0.0.2', port: 'abc' })).toEqual({
      error: 'number:port',
    });
  });

  it('knows the home network', () => {
    expect(
      ['10.1.2.3', '192.168.178.20', '172.16.0.1', 'wechselrichter', 'inverter.fritz.box'].every(
        privateHost,
      ),
    ).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '300.1.1.1', 'example.com'].some(privateHost)).toBe(false);
    expect(cidrHosts('192.168.178.0/24')).toHaveLength(254);
    expect(cidrHosts('192.168.178.0/16')).toEqual([]);
    expect(cidrHosts('8.8.8.0/24')).toEqual([]);
  });

  it('scan lists Modbus devices first, then devices with only a web page', async () => {
    const found = await scan(
      '192.168.5.0/29',
      async (h, p) => (h === '192.168.5.3' && p === 502) || (h === '192.168.5.2' && p === 80),
    );
    expect(found).toEqual([
      { host: '192.168.5.3', ports: [502] },
      { host: '192.168.5.2', ports: [80] },
    ]);
  });

  it('setup code: right code passes, 5 wrong tries lock for 10 minutes', () => {
    let t = 0;
    const check = codeChecker('482913', () => t);
    expect(check('482913')).toBe('ok');
    for (let i = 0; i < 5; i++) expect(check('000000')).toBe('wrong');
    expect(check('482913')).toBe('locked');
    t = 600_001;
    expect(check('482913')).toBe('ok');
  });
});

describe('setup assistant: whole flow with a fake evcc', () => {
  function setup() {
    const calls: { what: string; body?: unknown }[] = [];
    const site: Record<string, unknown> = { grid: '', pv: null, battery: null };
    let n = 0;
    const made: unknown[] = [];
    const evcc = {
      templates: async () => ({ status: 200, data: RAW }),
      test: async (b: unknown) => (
        calls.push({ what: 'test', body: b }),
        { status: 200, data: { power: { value: 3200, error: '' } } }
      ),
      create: async (b: unknown) => (
        calls.push({ what: 'create', body: b }),
        made.push({ id: n + 1, name: `db:${n + 1}`, config: b }),
        { status: 200, data: { id: ++n, name: `db:${n}` } }
      ),
      devices: async () => ({ status: 200, data: made }),
      site: async () => ({ status: 200, data: { ...site } }),
      updateSite: async (b: Record<string, unknown>) => (
        Object.assign(site, b),
        calls.push({ what: 'site', body: b }),
        { status: 202, data: null }
      ),
      restart: async () => (calls.push({ what: 'restart' }), { status: 200, data: null }),
    };
    const st: SetupDeps = {
      checkCode: codeChecker('482913'),
      state: stateFile(join(mkdtempSync(join(tmpdir(), 'vd-setup-')), 'setup.json')),
      evcc: evcc as unknown as SetupDeps['evcc'],
      scanCidr: null,
      scan: async () => [],
      allowDemo: false,
    };
    const deps: ApiDeps = { mode: 'live', now: Date.now, log: () => {}, setup: st };
    const post = (path: string, body: object, origin = 'http://x') =>
      handleApi('POST', new URL(path, 'http://x'), deps, {
        body: JSON.stringify(body),
        contentType: 'application/json',
        host: 'x',
        origin,
        fetchSite: 'same-origin',
      });
    return { post, deps, calls, site };
  }
  const yes = { own_home: true, read_only: true, no_opening: true, ask_if_unsure: true };

  it('needs the page itself, the code and the yes answers before anything reaches evcc', async () => {
    const { post, calls } = setup();
    expect(
      (await post('/api/setup/templates', { code: '482913', usage: 'pv' }, 'http://evil')).status,
    ).toBe(403);
    expect((await post('/api/setup/templates', { code: '1', usage: 'pv' })).status).toBe(403);
    expect((await post('/api/setup/templates', { code: '482913', usage: 'pv' })).status).toBe(409);
    expect(
      (await post('/api/setup/answers', { code: '482913', answers: { ...yes, read_only: false } }))
        .body,
    ).toMatchObject({ all: false });
    expect((await post('/api/setup/templates', { code: '482913', usage: 'pv' })).status).toBe(409);
    expect(calls).toEqual([]);
  });

  it('test, save (meter + site), finish – then the assistant is closed', async () => {
    const { post, deps, calls, site } = setup();
    await post('/api/setup/answers', { code: '482913', answers: yes });
    const list = (await post('/api/setup/templates', { code: '482913', usage: 'pv' })).body as {
      templates: { template: string }[];
    };
    expect(list.templates.map((t) => t.template)).toEqual(['acme-hybrid']);
    const v = {
      code: '482913',
      usage: 'pv',
      template: 'acme-hybrid',
      values: { host: '192.168.1.20' },
    };
    expect((await post('/api/setup/test', v)).body).toEqual({
      result: { power: { value: 3200, error: '' } },
    });
    expect((await post('/api/setup/save', v)).body).toEqual({ ok: true, name: 'db:1' });
    expect(site.pv).toEqual(['db:1']);
    // "back" and save the same again: no second device (Fremdtest 7)
    expect((await post('/api/setup/save', v)).body).toEqual({ ok: true, name: 'db:1' });
    expect(site.pv).toEqual(['db:1']);
    await post('/api/setup/save', { ...v, usage: 'grid' });
    expect(site.grid).toBe('db:2');
    expect(calls.filter((c) => c.what === 'create').length).toBe(2);
    expect((await post('/api/setup/finish', { code: '482913' })).status).toBe(200);
    expect(calls.at(-1)).toEqual({ what: 'restart' });
    const g = await handleApi('GET', new URL('/api/setup', 'http://x'), deps);
    expect(g.body).toMatchObject({ open: false });
    expect((await post('/api/setup/test', v)).status).toBe(409);
  });
});

describe('general stick: the first visitor becomes the owner', () => {
  function claimSetup() {
    const state = stateFile(join(mkdtempSync(join(tmpdir(), 'vd-claim-')), 'setup.json'));
    const c = claimChecker(state.read);
    const st: SetupDeps = {
      checkCode: (x) => c.check(x),
      claim: () => c.claim(state.write),
      state,
      evcc: {} as SetupDeps['evcc'],
      scanCidr: null,
      scan: async () => [],
      allowDemo: false,
    };
    const deps: ApiDeps = { mode: 'live', now: Date.now, log: () => {}, setup: st };
    const req = (body: object) => ({
      body: JSON.stringify(body),
      contentType: 'application/json',
      host: 'x',
      origin: 'http://x',
      fetchSite: 'same-origin',
    });
    const post = (path: string, body: object) =>
      handleApi('POST', new URL(path, 'http://x'), deps, req(body));
    const get = () => handleApi('GET', new URL('/api/setup', 'http://x'), deps);
    return { post, get, state };
  }

  it('hands out one code, once, and only that code opens the assistant', async () => {
    const { post, get, state } = claimSetup();
    expect((await get()).body).toMatchObject({ claimable: true });
    expect((await post('/api/setup/unlock', { code: '123456' })).status).toBe(403);
    const first = await post('/api/setup/claim', {});
    const code = (first.body as { code: string }).code;
    expect(code).toMatch(/^\d{6}$/);
    expect(state.read().owner).not.toContain(code); // only the hash is stored
    expect((await post('/api/setup/claim', {})).status).toBe(409);
    expect((await get()).body).toMatchObject({ claimable: false });
    expect((await post('/api/setup/unlock', { code })).status).toBe(200);
    expect((await post('/api/setup/unlock', { code: '000000' })).status).toBe(403);
  });
});

describe('confirmed in the assistant', () => {
  it('a device saved after the yes is no longer "being checked"', async () => {
    const raw = JSON.parse(readFileSync('starter/mapping.evcc.json', 'utf8'));
    const v = validateMapping(raw);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const state = stateFile(join(mkdtempSync(join(tmpdir(), 'vd-conf-')), 'setup.json'));
    state.write({ confirmed: { pv: true } });
    const deps = {
      mode: 'live',
      now: Date.now,
      log: () => {},
      mapping: v.mapping,
      series: {},
      setup: { state } as unknown as SetupDeps,
    } as unknown as ApiDeps;
    const r = await handleApi('GET', new URL('http://x/api/entities'), deps);
    const conf = Object.fromEntries(
      (r.body as { entities: { id: string; confirmed: boolean }[] }).entities.map((e) => [
        e.id,
        e.confirmed,
      ]),
    );
    expect(conf.pv_power).toBe(true);
    expect(conf.grid_power).toBe(false);
    expect(conf.load_power).toBe(false); // needs grid and pv
  });
});
