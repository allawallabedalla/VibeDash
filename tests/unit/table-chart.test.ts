import { describe, expect, it } from 'vitest';
import { sanitizeBoard, type BoardSection } from '../../src/model/board';
import { chartPos, chartScale } from '../../src/model/tableChart';

type Table = Extract<BoardSection, { type: 'table' }>;
const table = (chart: unknown, rows: unknown[]): Table => {
  const s = sanitizeBoard({
    sections: [{ type: 'table', title: 'T', columns: [{ key: 'a', label: 'A' }], rows, chart }],
  })!.sections[0]!;
  if (s.type !== 'table') throw new Error();
  return s;
};

describe('graphic column of a board table (Audit05 I-8)', () => {
  it('keeps a valid chart with its row values', () => {
    const t = table({ kind: 'dot', label: 'K', unit: 'K', color: 'climate', min: -1, max: 2 }, [
      { cells: { a: 'x' }, chart: { value: 0.7, err: 0.4 } },
      { cells: { a: 'y' }, chart: { value: -0.1, err: 0.2, faint: true } },
    ]);
    expect(t.chart).toEqual({
      kind: 'dot',
      label: 'K',
      unit: 'K',
      color: 'climate',
      min: -1,
      max: 2,
    });
    expect(t.rows[0]!.chart).toEqual({ value: 0.7, err: 0.4 });
    expect(t.rows[1]!.chart).toEqual({ value: -0.1, err: 0.2, faint: true });
  });

  it('drops an unknown kind and a chart without any value', () => {
    expect(table({ kind: 'pie', label: 'x' }, [{ cells: {}, chart: { value: 1 } }]).chart).toBe(
      undefined,
    );
    const t = table({ kind: 'bar', label: 'x' }, [{ cells: {}, chart: { value: null } }]);
    expect(t.chart).toBeUndefined();
    expect(t.rows[0]!.chart).toBeUndefined();
  });

  it('checks numbers: no strings, NaN, huge values, negative errors, wrong min/max', () => {
    const t = table({ kind: 'bar', label: 'x', min: 5, max: 1, unit: 'a'.repeat(40) }, [
      { cells: {}, chart: { value: '3' } },
      { cells: {}, chart: { value: 1e12 } },
      { cells: {}, chart: { value: 2, err: -1, part: 5 } },
      { cells: {}, chart: { value: 2, part: -1 } },
      { cells: {}, chart: { value: 4, part: 1, faint: 'yes' } },
      { cells: {} },
    ]);
    expect(t.chart).toEqual({ kind: 'bar', label: 'x', unit: 'a'.repeat(12) });
    expect(t.rows.map((r) => r.chart)).toEqual([
      { value: null },
      { value: null },
      { value: 2, part: 2 }, // part never longer than the bar, negative error dropped
      { value: 2 }, // part with the other sign dropped
      { value: 4, part: 1 },
      undefined,
    ]);
  });

  it('keeps col only when it names one of the columns', () => {
    const rows = [{ cells: {}, chart: { value: 1 } }];
    expect(table({ kind: 'bar', label: 'x', col: 'a' }, rows).chart!.col).toBe('a');
    expect(table({ kind: 'bar', label: 'x', col: 'zz' }, rows).chart!.col).toBeUndefined();
  });

  it('ignores row values when the table has no chart', () => {
    expect(table(undefined, [{ cells: {}, chart: { value: 1 } }]).rows[0]).toEqual({
      cells: { a: '' },
    });
  });
});

describe('shared scale', () => {
  it('always holds zero and every value with its error, on round ends', () => {
    expect(
      chartScale([
        { value: 0.7, err: 0.4 },
        { value: -0.1, err: 0.2 },
      ]),
    ).toEqual({
      lo: -0.5,
      hi: 1.5,
    });
    expect(chartScale([{ value: 66 }, { value: 8 }, undefined, { value: null }])).toEqual({
      lo: 0,
      hi: 80,
    });
    expect(
      chartScale([
        { value: -21.5, err: 2.2 },
        { value: 2.3, err: 1.9 },
      ]).lo,
    ).toBeLessThan(-23.6);
  });

  it('uses fixed ends and survives no values', () => {
    expect(chartScale([{ value: 40 }], { min: 0, max: 100 })).toEqual({ lo: 0, hi: 100 });
    expect(chartScale([])).toEqual({ lo: 0, hi: 1 });
    expect(chartPos(150, { lo: 0, hi: 100 })).toBe(100);
    expect(chartPos(-0.25, { lo: -0.5, hi: 1.5 })).toBeCloseTo(12.5);
  });
});
