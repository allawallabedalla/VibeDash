import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMapping, type Mapping } from '../../server/mapping';
import {
  actionTarget,
  boardUrl,
  moduleBase,
  moduleFeed,
  MODULES_DEFAULT_URL,
} from '../../server/modules';

const example = JSON.parse(readFileSync('local/mapping.example.json', 'utf8'));

const withModule = (): Mapping => {
  const r = validateMapping({
    ...example,
    boards: [
      { id: 'wartung', title: 'Wartung', icon: 'wrench', module: 'wartung' },
      { id: 'garden', title: 'Garten', url: 'http://127.0.0.1:9/garden' },
    ],
  });
  if (!r.ok) throw new Error(r.errors.join());
  return r.mapping;
};

describe('module boards (modules/ service)', () => {
  it('accepts a board made by a module and keeps house-service boards', () => {
    const m = withModule();
    expect(m.boards![0]).toEqual({
      id: 'wartung',
      title: 'Wartung',
      icon: 'wrench',
      module: 'wartung',
    });
    expect(m.boards![1]!.url).toBe('http://127.0.0.1:9/garden');
  });

  it('rejects a module board with an address or a bad module name', () => {
    const bad = (b: Record<string, unknown>) =>
      validateMapping({ ...example, boards: [{ id: 'a', title: 'A', ...b }] }).ok;
    expect(bad({ module: 'wartung', url: 'http://h/a' })).toBe(false);
    expect(bad({ module: 'wartung', actionUrl: 'http://h/a' })).toBe(false);
    expect(bad({ module: '../etc' })).toBe(false);
    expect(bad({ module: 'Wartung' })).toBe(false);
    expect(bad({})).toBe(false);
  });

  it('finds the module service and the addresses for board and clicks', () => {
    expect(moduleBase({})).toBe(MODULES_DEFAULT_URL);
    expect(moduleBase({ MODULES_URL: 'http://modules:8091/' })).toBe('http://modules:8091');
    const [w, g] = withModule().boards!;
    expect(boardUrl(w!, 'http://m')).toBe('http://m/board/wartung');
    expect(boardUrl(g!, 'http://m')).toBe('http://127.0.0.1:9/garden');
    expect(actionTarget(w!, 'http://m')).toEqual({
      url: 'http://m/board/wartung/action',
      headers: { 'X-VibeDash-Action': '1' },
    });
    expect(actionTarget(g!, 'http://m')).toBeNull();
  });

  it('passes a module feed on only for mapped modules and known types', async () => {
    const asked: string[] = [];
    const fetchFn = (async (u: string) => {
      asked.push(u);
      return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { status: 200 });
    }) as unknown as typeof fetch;
    const m = withModule();
    const ok = await moduleFeed('/feed/wartung/kalender.ics', m, 'http://m', fetchFn, 1000);
    expect(ok).toEqual({
      status: 200,
      type: 'text/calendar; charset=utf-8',
      body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    });
    expect(asked).toEqual(['http://m/feed/wartung/kalender.ics']);
    expect(
      (await moduleFeed('/feed/other/kalender.ics', m, 'http://m', fetchFn, 1000))!.status,
    ).toBe(404);
    expect((await moduleFeed('/feed/wartung/x.html', m, 'http://m', fetchFn, 1000))!.status).toBe(
      404,
    );
    expect(await moduleFeed('/feed/wartung/../../etc', m, 'http://m', fetchFn, 1000)).toBeNull();
    expect(await moduleFeed('/index.html', m, 'http://m', fetchFn, 1000)).toBeNull();
    expect(asked.length).toBe(1);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(
      (await moduleFeed('/feed/wartung/kalender.ics', m, 'http://m', down, 1000))!.status,
    ).toBe(502);
  });
});
