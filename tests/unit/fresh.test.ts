import { describe, expect, it } from 'vitest';
import { freshFor } from '../../src/model/series';

describe('a value counts as now (cache-safe)', () => {
  it('a 10 s sensor: 30 s old is still now (server cache up to 20 s), 2 min is not', () => {
    expect(30_000 <= freshFor(10_000)).toBe(true);
    expect(120_000 <= freshFor(10_000)).toBe(false);
  });
  it('slow sensors keep 2.5 steps', () => {
    expect(freshFor(180_000)).toBe(450_000);
  });
});
