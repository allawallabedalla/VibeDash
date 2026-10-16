import { describe, expect, it } from 'vitest';
import { buckets, coveredFrom, windowStats } from '../../src/model/zoom';

const S = (pairs: [number, number][]) => pairs.map(([t, v]) => ({ t, v }));

describe('enlarged tile: window, buckets, statistics', () => {
  it('means per bucket, gaps stay null, outside the window is ignored', () => {
    const b = buckets(
      S([
        [-5, 100],
        [0, 1],
        [1, 3],
        [5, 10],
        [9, 20],
        [10, 999],
      ]),
      0,
      10,
      5,
    );
    expect(b.x).toEqual([1, 3, 5, 7, 9]);
    expect(b.values).toEqual([2, null, 10, null, 20]);
  });

  it('min, max, mean, last and n only from the window', () => {
    const s = windowStats(
      S([
        [-1, -50],
        [0, 4],
        [2, 1],
        [3, 7],
        [4, NaN],
        [9, 3],
      ]),
      0,
      10,
    )!;
    expect(s).toMatchObject({ n: 4, min: 1, max: 7, mean: 3.75, minAt: 2, maxAt: 3 });
    expect(s.last).toEqual({ t: 9, v: 3 });
    expect(windowStats(S([[20, 1]]), 0, 10)).toBeNull();
  });

  it('says from when a younger series covers the window', () => {
    expect(
      coveredFrom(
        S([
          [3, 1],
          [8, 2],
        ]),
        0,
      ),
    ).toBe(3);
    expect(coveredFrom([], 0)).toBeNull();
  });
});
