import { describe, expect, it } from 'vitest';
import { runs, smoothPath } from '../../src/components/path';

describe('runs', () => {
  it('splits at gaps instead of bridging them', () => {
    expect(runs([1, 2, null, null, 3, null, 4, 5])).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 4 },
      { start: 6, end: 7 },
    ]);
  });
});

describe('smoothPath', () => {
  it('starts at the first point and ends at the last', () => {
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(d.startsWith('M0,10')).toBe(true);
    expect(d.endsWith('20,5')).toBe(true);
  });

  it('does not overshoot on a flat stretch', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 30, y: 5 },
    ]);
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(5);
  });
});
