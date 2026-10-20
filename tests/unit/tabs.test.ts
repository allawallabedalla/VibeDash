import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrange, move, MODULES, ordered } from '../../src/app/tabs';
import { cleanPrefs, readTabs, writeTabs } from '../../server/tabs';
import { handleApi } from '../../server/api';

const T = ['overview', 'week', 'now', 'charging', 'b/wartung', 'b/garten'].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('tab choice', () => {
  it('hides, orders, keeps the overview first and new tabs in their usual place', () => {
    const p = { hidden: ['week', 'overview'], order: ['b/garten', 'now', 'charging'] };
    expect(ids(arrange(T, p))).toEqual(['overview', 'b/garten', 'now', 'charging', 'b/wartung']);
    expect(ids(ordered(T, p))).toContain('week');
    expect(ids(arrange(T, { hidden: [], order: [] }))).toEqual(ids(T));
  });

  it('moves one step, never past the overview', () => {
    const all = ids(T);
    expect(move(all, 'now', -1)).toEqual([
      'overview',
      'now',
      'week',
      'charging',
      'b/wartung',
      'b/garten',
    ]);
    expect(move(all, 'week', -1)).toEqual(all);
    expect(move(all, 'b/garten', 1)).toEqual(all);
  });

  it('accepts only clean lists and never hides the overview', () => {
    expect(cleanPrefs({ hidden: ['overview', 'b/knx', 'b/knx'], order: [] })).toEqual({
      hidden: ['b/knx'],
      order: [],
    });
    expect(cleanPrefs({ hidden: ['../x'] })).toBeNull();
    expect(cleanPrefs({ hidden: 'week' })).toBeNull();
    expect(cleanPrefs(null)).toBeNull();
  });

  it('writes next to the location without touching it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tabs-')), 'settings.json');
    writeFileSync(path, JSON.stringify({ location: { lat: 50, lon: 9 } }));
    writeTabs(path, { hidden: ['week'], order: ['now'] });
    expect(JSON.parse(readFileSync(path, 'utf8')).location).toEqual({ lat: 50, lon: 9 });
    expect(readTabs(path)).toEqual({ hidden: ['week'], order: ['now'] });
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600');
  });

  it('knows every module that ships with VibeDash', () => {
    const dir = 'modules/vibedash_modules';
    const mods = readdirSync(dir).filter(
      (d) => statSync(join(dir, d)).isDirectory() && !d.startsWith('_'),
    );
    expect(Object.keys(MODULES).sort()).toEqual(mods.sort());
  });
});

describe('/api/tabs', () => {
  const store = () => {
    let saved = { hidden: [] as string[], order: [] as string[] };
    return {
      writable: true,
      read: () => saved,
      write: (t: typeof saved) => (saved = t),
    };
  };
  const same = {
    origin: 'http://h:1',
    host: 'h:1',
    fetchSite: 'same-origin',
    contentType: 'application/json',
  };

  it('saves from the page itself only', async () => {
    const tabs = store();
    const deps = { mode: 'demo' as const, now: Date.now, log: () => {}, tabs };
    const url = new URL('http://h:1/api/tabs');
    const body = JSON.stringify({ hidden: ['week'], order: [] });
    expect((await handleApi('POST', url, deps, { ...same, body })).status).toBe(200);
    expect(tabs.read().hidden).toEqual(['week']);
    expect(
      (await handleApi('POST', url, deps, { ...same, origin: 'http://evil', body })).status,
    ).toBe(403);
    expect((await handleApi('POST', url, deps, { ...same, body: '{"hidden":"x"}' })).status).toBe(
      400,
    );
    const health = await handleApi('GET', new URL('http://h:1/api/health'), deps);
    expect((health.body as { tabs: unknown }).tabs).toEqual({ hidden: ['week'], order: [] });
  });

  it('refuses writes when switched off', async () => {
    const deps = {
      mode: 'demo' as const,
      now: Date.now,
      log: () => {},
      tabs: { ...store(), writable: false },
    };
    const r = await handleApi('POST', new URL('http://h:1/api/tabs'), deps, {
      ...same,
      body: '{}',
    });
    expect(r.status).toBe(403);
  });
});
