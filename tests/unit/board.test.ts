import { describe, expect, it } from 'vitest';
import { sanitizeBoard } from '../../src/model/board';

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
