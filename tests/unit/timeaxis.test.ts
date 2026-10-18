import { describe, expect, it } from 'vitest';
import { timeTicks } from '../../src/components/timeaxis';

const TZ = 'Europe/Berlin';
const H = 3_600_000;

describe('timeTicks', () => {
  it('marks a day every 6 h, midnight as weekday', () => {
    // Sat 17.10.2026 14:30 local → Sun 18.10.2026 14:30 local (CEST, UTC+2)
    const from = Date.UTC(2026, 9, 17, 12, 30);
    const ticks = timeTicks(from, from + 24 * H, TZ);
    expect(ticks.map((k) => k.label)).toEqual(['18 Uhr', 'So', '6 Uhr', '12 Uhr']);
  });

  it('labels each point of a week of daily values with its weekday', () => {
    const from = Date.UTC(2026, 9, 12, 10); // Mo noon local
    const ticks = timeTicks(from, from + 6 * 24 * H, TZ, { points: 7 });
    expect(ticks.map((k) => k.label)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
  });

  it('marks a month every 7 days, counted back from the newest midnight', () => {
    const to = Date.UTC(2026, 9, 18, 12);
    const ticks = timeTicks(to - 30 * 24 * H, to, TZ);
    expect(ticks.at(-1)!.label).toBe('18.10.');
    expect(ticks.length).toBe(5);
  });

  it('keeps local hours across the clock change', () => {
    // 25.10.2026: CEST → CET
    const from = Date.UTC(2026, 9, 24, 22); // 0:00 local
    const labels = timeTicks(from, from + 25 * H, TZ).map((k) => k.label);
    expect(labels).toEqual(['So', '6 Uhr', '12 Uhr', '18 Uhr', 'Mo']);
  });
});
