import { describe, expect, it } from 'vitest';
import { originShares, originStack } from '../../src/model/charge-origin';
import { demoChargeDays } from '../../src/demo/charging';
import { generateDemo } from '../../src/demo';

const D = 86_400_000;

describe('car energy by origin (Audit05 I-2)', () => {
  it('stacks known days, keeps today open and gaps as gaps', () => {
    const days = [0, D, 2 * D, 3 * D];
    const bars = originStack(
      days,
      [
        { day: 0, sun: 4, battery: 2, grid: 6 },
        { day: D, sun: 0, battery: 0, grid: 0 },
        // one origin missing: not stacked
        { day: 2 * D, sun: 3, battery: null, grid: 1 },
      ],
      [12, null, null, 7.5],
    );
    expect(bars).toEqual([
      { sun: 4, battery: 2, grid: 6, open: 0 },
      // charged nothing: a real 0, not a gap
      { sun: 0, battery: 0, grid: 0, open: 0 },
      // no full origin and no charge: a gap
      null,
      // charged today, split not there yet
      { sun: 0, battery: 0, grid: 0, open: 7.5 },
    ]);
  });

  it('shares in whole percent add up to 100 and count only days with known origin', () => {
    const s = originShares([
      { sun: 1, battery: 1, grid: 1, open: 0 },
      { sun: 0, battery: 0, grid: 0, open: 0 },
      { sun: 0, battery: 0, grid: 0, open: 20 },
      null,
    ])!;
    expect(s.sun + s.battery + s.grid).toBe(100);
    expect([s.sun, s.battery, s.grid].sort()).toEqual([33, 33, 34]);
    expect(s.n).toBe(1);
    expect(s.kwh).toBe(3);
    // 27/32/41 stays as it is
    expect(originShares([{ sun: 27, battery: 32, grid: 41, open: 0 }])).toMatchObject({
      sun: 27,
      battery: 32,
      grid: 41,
    });
    expect(originShares([null, { sun: 0, battery: 0, grid: 0, open: 5 }])).toBeNull();
  });

  it('the demo charges add up per day and leave today without a split', () => {
    const days = demoChargeDays(generateDemo());
    expect(days).toHaveLength(30);
    expect(days.at(-1)!.sun).toBeNull();
    for (const d of days.slice(0, -1)) {
      const sum = (d.sun ?? 0) + (d.battery ?? 0) + (d.grid ?? 0);
      expect(Math.abs(sum - (d.kwh ?? 0))).toBeLessThan(0.05);
    }
    expect(days.filter((d) => d.kwh).length).toBeGreaterThan(5);
  });
});
