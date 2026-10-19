import { describe, expect, it } from 'vitest';
import { sanitizeBoard, sanitizeCalcResult } from '../../src/model/board';

describe('board from a house service: checked and trimmed', () => {
  it('rejects what is not a board', () => {
    expect(sanitizeBoard(null)).toBeNull();
    expect(sanitizeBoard({ sections: 'x' })).toBeNull();
  });

  it('keeps known blocks, drops unknown ones, trims text and numbers', () => {
    const b = sanitizeBoard({
      updated: 5,
      sections: [
        { type: 'script', title: 'x' },
        {
          type: 'tiles',
          title: 'A'.repeat(500),
          tiles: [
            {
              label: 'Akku\u0007',
              value: 92,
              unit: '%',
              state: 'weird',
              color: 'red',
              spark: [1, 'x', Infinity, 2],
              info: { what: '<b>w</b>', source: 's' },
            },
          ],
        },
        { type: 'series', title: 'S', unit: 'kW', x: [1, 'bad'], lines: [] },
        {
          type: 'table',
          title: 'T',
          columns: [{ key: 'a', label: 'A' }, { label: 'no key' }],
          rows: [{ cells: { a: 1, b: 'hidden' }, state: 'act' }],
        },
        { type: 'accuracy', title: 'M', models: [{ label: 'm', pct: 140, n: -3, history: [1] }] },
      ],
    })!;
    expect(b.updated).toBe(5);
    expect(b.sections.map((s) => s.type)).toEqual(['tiles', 'table', 'accuracy']);
    const tiles = b.sections[0]!;
    if (tiles.type !== 'tiles') throw new Error();
    expect(tiles.title).toHaveLength(80);
    expect(tiles.tiles[0]).toMatchObject({ label: 'Akku ', value: '92', unit: '%' });
    expect(tiles.tiles[0]!.state).toBeUndefined();
    expect(tiles.tiles[0]!.color).toBe('muted');
    expect(tiles.tiles[0]!.spark).toEqual([1, null, null, 2]);
    // markup stays text: the page never renders it as HTML
    expect(tiles.tiles[0]!.info!.what).toBe('<b>w</b>');
    const table = b.sections[1]!;
    if (table.type !== 'table') throw new Error();
    expect(table.columns).toEqual([{ key: 'a', label: 'A' }]);
    expect(table.rows[0]).toEqual({ cells: { a: '1' }, state: 'act' });
    const acc = b.sections[2]!;
    if (acc.type !== 'accuracy') throw new Error();
    expect(acc.models[0]).toMatchObject({ pct: 100, n: 0 });
  });
});

describe('board floor plan', () => {
  it('keeps floors, rooms and views, drops broken geometry and unknown rooms', () => {
    const b = sanitizeBoard({
      sections: [
        {
          type: 'plan',
          title: 'Plan',
          floors: [
            {
              id: 'f1',
              name: 'Ground',
              box: [0, 0, 10, 8],
              walls: [
                [
                  [0, 0],
                  [10, 0],
                ],
                [[1, 'x']],
              ],
              rooms: [
                {
                  id: 'a',
                  name: 'A',
                  kind: 'room',
                  polygon: [
                    [0, 0],
                    [5, 0],
                    [5, 4],
                    [0, 4],
                  ],
                  label: [2, 2],
                },
                {
                  id: 'bad',
                  name: 'two points',
                  polygon: [
                    [0, 0],
                    [1, 1],
                  ],
                },
                {
                  id: 'c',
                  name: 'C',
                  kind: 'weird',
                  polygon: [
                    [5, 0],
                    [9, 0],
                    [9, 4],
                  ],
                  label: [7, 1],
                },
              ],
            },
          ],
          views: [
            { id: 't', label: 'Temp', kind: 'temp', unit: '°', values: { a: 21.5, ghost: 3 } },
            { id: 'x', label: 'X', kind: 'nope', values: {} },
          ],
          details: { a: [{ label: 'Soll', value: '21 °C' }], ghost: [] },
          timeline: { start: 0, stepMs: 900000, steps: 3, light: { a: [1, 0, 'x', 1] } },
          link: { label: '3D', url: 'javascript:alert(1)' },
        },
      ],
    })!;
    const p = b.sections[0]!;
    if (p.type !== 'plan') throw new Error();
    expect(p.floors[0]!.rooms.map((r) => [r.id, r.kind])).toEqual([
      ['a', 'room'],
      ['c', 'room'],
    ]);
    expect(p.floors[0]!.walls).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    expect(p.views.map((v) => v.id)).toEqual(['t']);
    expect(p.views[0]!.values).toEqual({ a: 21.5 });
    expect(Object.keys(p.details)).toEqual(['a']);
    expect(p.timeline!.light.a).toEqual([1, 0, 0]);
    expect(p.link).toBeUndefined();
  });
});

describe('board floor plan in 3D', () => {
  it('keeps walls, roof, stairs and blocks within limits, drops broken parts', () => {
    const square = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const b = sanitizeBoard({
      sections: [
        {
          type: 'plan',
          floors: [
            {
              id: 'g',
              name: 'G',
              box: [0, 0, 4, 4],
              rooms: [{ id: 'a', polygon: square, label: [2, 2] }],
            },
          ],
          model3d: {
            floors: [
              {
                id: 'g',
                base: 0,
                height: 2.75,
                walls: [
                  {
                    outer: square,
                    holes: [
                      [
                        [1, 1],
                        [2, 1],
                        [2, 2],
                      ],
                      [[1, 1]],
                    ],
                  },
                ],
              },
              { id: 'empty', walls: [] },
            ],
            roof: [
              [
                [0, 0, 3],
                [4, 0, 3],
                [2, 2, 5],
              ],
              [[0, 0]],
            ],
            stairs: [
              { x0: 1, x1: 2, y0: 0, y1: 3, steps: 999, height: 3 },
              { x0: 2, x1: 1 },
            ],
            blocks: [{ base: 0, height: 500, walls: [{ outer: square }] }],
          },
        },
      ],
    })!;
    const p = b.sections[0]!;
    if (p.type !== 'plan') throw new Error();
    const m = p.model3d!;
    expect(m.floors.map((f) => f.id)).toEqual(['g']);
    expect(m.floors[0]!.walls[0]!.holes).toHaveLength(1);
    expect(m.roof).toHaveLength(1);
    expect(m.stairs).toEqual([{ x0: 1, x1: 2, y0: 0, y1: 3, base: 0, height: 3, steps: 40 }]);
    expect(m.blocks[0]!.height).toBe(3);
  });
});

describe('board list items that take clicks', () => {
  it('keeps a valid id and known actions, drops the rest', () => {
    const b = sanitizeBoard({
      sections: [
        {
          type: 'list',
          title: 'L',
          items: [
            {
              text: 'Türen ölen',
              id: 'plan:tueren',
              actions: ['done', 'comment', 'explode', 'done'],
              done: '2026-10-16 08:20',
              acked: 'gestern',
              snoozed: '2026-11-01',
              comments: [{ text: 'mit Graphit', at: '2026-10-16 10:00' }, { text: '' }],
            },
            { text: 'kein Knopf', id: '<script>', actions: ['done'] },
            { text: 'ohne Aktionen', id: 'plan:x' },
          ],
        },
      ],
    });
    const items = (b!.sections[0] as unknown as { items: Record<string, unknown>[] }).items;
    expect(items[0]).toEqual({
      text: 'Türen ölen',
      id: 'plan:tueren',
      actions: ['done', 'comment'],
      done: '2026-10-16 08:20',
      snoozed: '2026-11-01',
      comments: [{ text: 'mit Graphit', at: '2026-10-16 10:00' }],
    });
    expect(items[1]).toEqual({ text: 'kein Knopf' });
    expect(items[2]).toEqual({ text: 'ohne Aktionen' });
  });
});

describe('board time spans per group', () => {
  it('keeps a group name and up to 4 ranges with own data, drops broken ones', () => {
    const b = sanitizeBoard({
      sections: [
        {
          type: 'series',
          title: 'T',
          unit: '°C',
          x: [1, 2],
          lines: [{ label: 'a', values: [1, 2], color: 'sun' }],
          group: 'server',
          ranges: [
            { id: '24h', label: '24 h', x: [1, 2], lines: [{ label: 'a', values: [1, 2] }] },
            { id: '24h', label: 'twice', x: [1], lines: [] },
            { id: '7d', label: '7 Tage', x: ['x'], lines: [] },
            { id: '30d', x: [5, 6, 7], lines: [{ label: 'a', values: [1, null, 3, 4] }] },
          ],
        },
        {
          type: 'bars',
          title: 'B',
          unit: 'mm',
          labels: ['a'],
          values: [1],
          group: 'Bad Group',
          ranges: [{ id: '7d', label: '7 Tage', labels: ['a', 'b'], values: [1, 2, 3] }],
        },
      ],
    })!;
    const s = b.sections[0] as unknown as {
      group: string;
      ranges: { id: string; label: string; x: number[]; lines: { values: unknown[] }[] }[];
    };
    expect(s.group).toBe('server');
    // at most 4 ranges are read; broken and repeated ones are dropped
    expect(s.ranges.map((r) => [r.id, r.label])).toEqual([
      ['24h', '24 h'],
      ['30d', '30d'],
    ]);
    expect(s.ranges[1]!.lines[0]!.values).toEqual([1, null, 3]);
    const bars = b.sections[1] as unknown as { group?: string; ranges: { values: unknown[] }[] };
    expect(bars.group).toBeUndefined();
    expect(bars.ranges[0]!.values).toEqual([1, 2]);
  });
});

describe('board calculator (slider + button)', () => {
  it('keeps a sensible range, clamps the value, drops broken ones', () => {
    const b = sanitizeBoard({
      sections: [
        {
          type: 'calc',
          title: 'Anstecken um',
          label: 'Anstecken um',
          min: 960,
          max: 2040,
          step: 15,
          value: 5000,
          format: 'clock',
          button: 'Rechnen',
        },
        { type: 'calc', title: 'leer', min: 5, max: 5 },
        { type: 'calc', title: 'zu fein', min: 0, max: 100_000, step: 1 },
      ],
    })!;
    expect(b.sections).toHaveLength(1);
    expect(b.sections[0]).toMatchObject({ type: 'calc', value: 2040, format: 'clock', step: 15 });
    expect(sanitizeCalcResult({ sections: [{ type: 'calc', min: 0, max: 1 }] })).toEqual([]);
    const d = sanitizeBoard({
      sections: [
        { type: 'calc', min: 900, max: 1425, step: 15, format: 'clock', days: 9 },
        { type: 'calc', min: 900, max: 2040, step: 15, format: 'clock', days: 7 },
        { type: 'calc', min: 0, max: 10, format: 'number', days: 7 },
      ],
    })!;
    expect(d.sections.map((x) => (x.type === 'calc' ? (x.days ?? null) : 'x'))).toEqual([
      7,
      null,
      null,
    ]);
    expect(sanitizeCalcResult('x')).toBeNull();
  });
});

describe('board section slots (placement on an embedding page)', () => {
  it('keeps top and plan, drops anything else', () => {
    const b = sanitizeBoard({
      sections: [
        { type: 'text', title: 'a', text: 'x', slot: 'top' },
        { type: 'text', title: 'b', text: 'x', slot: 'plan' },
        { type: 'text', title: 'c', text: 'x', slot: 'side' },
      ],
    })!;
    expect(b.sections.map((x) => x.slot ?? null)).toEqual(['top', 'plan', null]);
  });
});
