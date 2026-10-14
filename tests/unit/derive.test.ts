import { describe, expect, it } from 'vitest';
import { deriveCounter } from '../../src/model/derive';
import type { Sample, Series } from '../../src/model/types';

const S = 10_000;
const series = (samples: Sample[], stepMs = S): Series => ({
  entityId: 'x',
  source: 't',
  stepMs,
  samples,
});
const flat = (w: number, fromT: number, toT: number) => {
  const out: Sample[] = [];
  for (let t = fromT; t <= toT; t += S) out.push({ t, v: w });
  return out;
};

describe('deriveCounter', () => {
  it('integrates power into kWh', () => {
    // 1000 W for one hour = 1 kWh
    const p = series(flat(1000, 0, 3_600_000));
    const out = deriveCounter(
      [{ how: 'integrate', series: p, sign: 1, factor: 0.001 }],
      0,
      3_600_000,
      60_000,
    );
    expect(out).toHaveLength(60);
    expect(out.at(-1)!.v).toBeCloseTo(1, 6);
  });

  it('adds nothing across a gap and leaves the gap without readings', () => {
    const p = series([...flat(1000, 0, 600_000), ...flat(1000, 1_800_000, 3_600_000)]);
    const out = deriveCounter(
      [{ how: 'integrate', series: p, sign: 1, factor: 0.001 }],
      0,
      3_600_000,
      60_000,
    );
    // 10 min + 30 min of 1 kW, the 20 min silence is not filled
    expect(out.at(-1)!.v).toBeCloseTo(40 / 60, 6);
    expect(out.some((x) => x.t > 660_000 && x.t <= 1_800_000)).toBe(false);
  });

  it('subtracts a meter with read errors dropped', () => {
    const p = series(flat(2000, 0, 3_600_000));
    const car = series(
      [
        { t: 0, v: 5000 },
        { t: 1_200_000, v: 5000.5 },
        { t: 1_260_000, v: 0 },
        { t: 1_320_000, v: 5000.6 },
        { t: 3_600_000, v: 5001 },
      ],
      60_000,
    );
    const out = deriveCounter(
      [
        { how: 'integrate', series: p, sign: 1, factor: 0.001 },
        { how: 'counter', series: car, sign: -1, factor: 1 },
      ],
      0,
      3_600_000,
      60_000,
    );
    expect(out.at(-1)!.v).toBeCloseTo(2 - 1, 6);
  });

  it('sums meters (signs) when there is no power term', () => {
    const a = series(
      [
        { t: 0, v: 10 },
        { t: 60_000, v: 11 },
        { t: 120_000, v: 13 },
      ],
      60_000,
    );
    const b = series(
      [
        { t: 0, v: 100 },
        { t: 60_000, v: 100.5 },
        { t: 120_000, v: 100.5 },
      ],
      60_000,
    );
    const out = deriveCounter(
      [
        { how: 'counter', series: a, sign: 1, factor: 1 },
        { how: 'counter', series: b, sign: -1, factor: 1 },
      ],
      0,
      120_000,
      60_000,
    );
    expect(out.map((x) => x.v)).toEqual([0.5, 2.5]);
  });
});
