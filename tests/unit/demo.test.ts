import { describe, expect, it } from 'vitest';
import { completeDays, DEMO_STEP_MS, generateDemo, last24h, typicalDay } from '../../src/demo';
import { findGaps } from '../../src/model/series';
import { localDateKey } from '../../src/model/time';

const demo = generateDemo();

describe('demo data', () => {
  it('is reproducible for the same seed', () => {
    const again = generateDemo();
    expect(again.series.pv_power!.samples).toEqual(demo.series.pv_power!.samples);
  });

  it('covers 30 days at a 5 minute step', () => {
    const load = demo.series.load_power!.samples;
    expect(load.length).toBe((30 * 86_400_000) / DEMO_STEP_MS);
    expect(load.at(-1)!.t).toBeLessThan(demo.now);
  });

  it('contains the announced gaps, and they are detectable', () => {
    const pvGaps = findGaps(demo.series.pv_power!);
    const tempGaps = findGaps(demo.series.living_temp!);
    expect(pvGaps).toHaveLength(1);
    expect(tempGaps).toHaveLength(1);
    expect(localDateKey(tempGaps[0]!.from, demo.timeZone)).toBe('2026-06-21');
  });

  it('shows the sensor gap as null in the 24 h view', () => {
    expect(last24h(demo, 'living_temp').filter((v) => v === null).length).toBeGreaterThan(5);
  });

  it('contains exactly one humidity artifact', () => {
    const zeros = demo.series.living_humidity!.samples.filter((s) => s.v === 0);
    expect(zeros).toHaveLength(1);
  });

  it('keeps two same-second grid messages in arrival order', () => {
    const issue = demo.issues.find((i) => i.kind === 'same_second')!;
    const same = demo.series.grid_power!.samples.filter((s) => s.t === issue.from);
    expect(same).toHaveLength(2);
    expect(same[1]!.v).toBe(same[0]!.v - 140);
  });

  it('keeps the PV meter counting through the logger gap', () => {
    const days = completeDays(demo, 'pv_energy');
    expect(days).toHaveLength(29);
    for (const d of days) expect(d.value).toBeGreaterThan(0);
  });

  it('grid sign convention: feed-in positive, import negative', () => {
    const grid = demo.series.grid_power!.samples;
    expect(grid.some((s) => s.v > 0)).toBe(true);
    expect(grid.some((s) => s.v < 0)).toBe(true);
  });

  it('battery state of charge stays within 0–100 %', () => {
    for (const s of demo.series.battery_soc!.samples) {
      expect(s.v).toBeGreaterThanOrEqual(0);
      expect(s.v).toBeLessThanOrEqual(100);
    }
  });

  it('typical PV day has a range and n', () => {
    const est = typicalDay(demo, 'pv_energy');
    expect(est.n).toBe(29);
    expect(est.low).toBeLessThan(est.value);
    expect(est.high).toBeGreaterThan(est.value);
  });
});
