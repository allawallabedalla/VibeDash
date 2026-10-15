import { describe, expect, it } from 'vitest';
import {
  counterResets,
  dailyFromCounter,
  dropCounterGlitches,
  estimate,
  findGaps,
  meanAbsPctError,
  quantile,
  thinBefore,
  toGrid,
} from '../../src/model/series';

describe('findGaps', () => {
  it('reports silent stretches longer than 2.5 steps', () => {
    const samples = [0, 1, 2, 6, 7].map((i) => ({ t: i * 1000, v: 1 }));
    expect(findGaps({ entityId: 'x', source: 't', stepMs: 1000, samples })).toEqual([
      { from: 2000, to: 6000 },
    ]);
  });
});

describe('toGrid', () => {
  it('keeps empty slots as null instead of zero', () => {
    const grid = toGrid(
      [
        { t: 0, v: 2 },
        { t: 500, v: 4 },
        { t: 2000, v: 6 },
      ],
      0,
      3000,
      1000,
    );
    expect(grid).toEqual([3, null, 6]);
  });
});

describe('quantile / estimate', () => {
  it('interpolates and reports n', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(estimate([10, 20, 30, 40, 50])).toEqual({ value: 30, low: 14, high: 46, n: 5 });
  });
});

describe('meanAbsPctError', () => {
  it('does not let +40 % and −40 % cancel out', () => {
    const err = meanAbsPctError([
      { actual: 10, predicted: 14 },
      { actual: 10, predicted: 6 },
    ]);
    expect(err).toBeCloseTo(40);
  });
});

describe('dailyFromCounter', () => {
  it('uses meter differences between days and drops the first incomplete day', () => {
    const key = (t: number) => (t < 10 ? 'd1' : t < 20 ? 'd2' : 'd3');
    const samples = [
      { t: 1, v: 100 },
      { t: 9, v: 105 },
      { t: 12, v: 106 },
      { t: 19, v: 112 },
      { t: 25, v: 120 },
    ];
    expect(dailyFromCounter(samples, key)).toEqual([
      { day: 'd2', value: 7 },
      { day: 'd3', value: 8 },
    ]);
  });
});

describe('dailyFromCounter with a meter reset', () => {
  it('never produces negative days', () => {
    const key = (t: number) => (t < 10 ? 'd1' : 'd2');
    const samples = [
      { t: 1, v: 100 },
      { t: 9, v: 105 },
      { t: 11, v: 107 },
      { t: 12, v: 1 },
      { t: 15, v: 4 },
    ];
    expect(dailyFromCounter(samples, key)).toEqual([{ day: 'd2', value: 5 }]);
  });
});

describe('dropCounterGlitches', () => {
  const M = 60_000;
  it('drops a single read error to 0 that comes straight back', () => {
    const samples = [
      { t: 0, v: 12345.2 },
      { t: 2 * M, v: 0 },
      { t: 3 * M, v: 12345.3 },
    ];
    expect(dropCounterGlitches(samples)).toEqual([samples[0], samples[2]]);
    expect(counterResets(samples)).toEqual([]);
  });

  it('drops a short jump up that comes back', () => {
    const samples = [
      { t: 0, v: 100 },
      { t: M, v: 6653.5 },
      { t: 2 * M, v: 100.1 },
    ];
    expect(dropCounterGlitches(samples).map((s) => s.v)).toEqual([100, 100.1]);
  });

  it('keeps a reset whose low value stays longer than 10 minutes', () => {
    const samples = [
      { t: 0, v: 3000 },
      { t: M, v: 0.1 },
      { t: 6 * M, v: 0.2 },
      { t: 12 * M, v: 0.4 },
    ];
    expect(dropCounterGlitches(samples)).toEqual(samples);
    expect(counterResets(samples)).toEqual([{ t: M, from: 3000, to: 0.1 }]);
  });

  it('drops a long run of zeros that ends back at the level (logger outage, DA-05)', () => {
    const H = 60 * M;
    const samples = [
      { t: 0, v: 1000 },
      { t: M, v: 0 },
      { t: 30 * M, v: 0 },
      { t: 5 * H, v: 1003 },
    ];
    expect(dropCounterGlitches(samples).map((s) => s.v)).toEqual([1000, 1003]);
    expect(counterResets(samples)).toEqual([]);
    const day = (t: number) => (t < 24 * H ? 'd1' : 'd2');
    expect(dailyFromCounter([{ t: -M, v: 999 }, ...samples], day)).toEqual([]);
  });

  it('keeps a real reset to 0 that grows from there', () => {
    const samples = [
      { t: 0, v: 1000 },
      { t: M, v: 0 },
      { t: 30 * M, v: 0.5 },
      { t: 60 * M, v: 1.2 },
    ];
    expect(counterResets(samples)).toEqual([{ t: M, from: 1000, to: 0 }]);
  });

  it('drops a glitch of several samples within the window', () => {
    const samples = [
      { t: 0, v: 50 },
      { t: M, v: 0 },
      { t: 2 * M, v: 0 },
      { t: 3 * M, v: 50.2 },
    ];
    expect(dropCounterGlitches(samples).map((s) => s.v)).toEqual([50, 50.2]);
  });
});

describe('dailyFromCounter with read errors and limits', () => {
  const M = 60_000;
  it('does not count a read error to 0 as a day of yield', () => {
    const key = (t: number) => (t < 10 * M ? 'd1' : 'd2');
    const samples = [
      { t: 0, v: 12000 },
      { t: 9 * M, v: 12001 },
      { t: 11 * M, v: 0 },
      { t: 12 * M, v: 12003 },
    ];
    expect(dailyFromCounter(samples, key)).toEqual([{ day: 'd2', value: 2 }]);
  });

  it('leaves out days above maxPerDay', () => {
    const key = (t: number) => (t < 10 ? 'd1' : t < 20 ? 'd2' : 'd3');
    const samples = [
      { t: 1, v: 0 },
      { t: 12, v: 300 },
      { t: 25, v: 310 },
    ];
    expect(dailyFromCounter(samples, key, 200)).toEqual([{ day: 'd3', value: 10 }]);
  });
});

describe('thinBefore', () => {
  const at = (sec: number[], v: (i: number) => number) =>
    sec.map((t, i) => ({ t: t * 1000, v: v(i) }));

  it('averages power-like readings per slot before the cut, keeps the rest', () => {
    const s = at([0, 10, 20, 60, 70, 120, 130], (i) => i * 10);
    expect(thinBefore(s, 120_000, 60_000, 'mean')).toEqual([
      { t: 0, v: 10 },
      { t: 60_000, v: 35 },
      { t: 120_000, v: 50 },
      { t: 130_000, v: 60 },
    ]);
  });

  it('keeps the last meter reading per slot, so resets and daily sums stay', () => {
    const s = at([0, 10, 60, 70, 80], (i) => [5, 6, 7, 1, 2][i]!);
    const out = thinBefore(s, 1_000_000, 60_000, 'last');
    expect(out).toEqual([
      { t: 0, v: 6 },
      { t: 60_000, v: 2 },
    ]);
    expect(counterResets(out)).toHaveLength(1);
  });

  it('leaves empty slots empty, so gaps stay visible', () => {
    const s = at([0, 600], () => 1);
    expect(thinBefore(s, 1_000_000, 60_000, 'mean').map((x) => x.t)).toEqual([0, 600_000]);
  });

  it('changes nothing when every sample is after the cut', () => {
    const s = at([100, 110], () => 3);
    expect(thinBefore(s, 50_000, 60_000, 'mean')).toEqual(s);
  });
});
