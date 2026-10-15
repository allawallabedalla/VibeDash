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
