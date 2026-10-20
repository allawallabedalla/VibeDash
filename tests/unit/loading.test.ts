import { describe, expect, it } from 'vitest';
import { thin } from '../../src/app/loading';

describe('snapshot thinning', () => {
  it('keeps short series, thins long ones evenly and always keeps the last value', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const xs = Array.from({ length: 8640 }, (_, i) => i);
    const t = thin(xs, 300);
    expect(t.length).toBe(300);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(8639);
    expect(t.every((v, i) => i === 0 || v > t[i - 1]!)).toBe(true);
  });
});
