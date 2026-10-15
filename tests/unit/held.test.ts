import { describe, expect, it } from 'vitest';
import { findGaps, holdForward, lastReport, reportedSamples } from '../../src/model/series';
import type { Series } from '../../src/model/types';

const MIN = 60_000;
// synthetic: a sensor reporting at 0, 10 and 200 min, held for 60 min, step 5 min
const reports = [0, 10, 200].map((m) => ({ t: m * MIN, v: m }));
const held: Series = {
  entityId: 'demo_temp',
  source: 'test',
  stepMs: 5 * MIN,
  samples: holdForward(reports, 5 * MIN, 60 * MIN, 0, 240 * MIN),
  held: { reports: reports.map((x) => x.t), holdMs: 60 * MIN },
};

describe('held values (N-02/N-03)', () => {
  it('starts a gap at the last real report, not where the held value ran out', () => {
    expect(findGaps(held)).toEqual([{ from: 10 * MIN, to: 200 * MIN }]);
  });

  it('knows the last real report', () => {
    expect(lastReport(held, 150 * MIN)).toBe(10 * MIN);
    expect(lastReport(held)).toBe(200 * MIN);
    expect(held.samples.at(-1)!.t).toBeGreaterThan(200 * MIN);
  });

  it('counts only real reports', () => {
    expect(reportedSamples(held).map((x) => x.v)).toEqual([0, 10, 200]);
    expect(held.samples.length).toBeGreaterThan(3);
  });
});
