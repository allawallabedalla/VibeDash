import { describe, expect, it } from 'vitest';
import { addDays, dayStart, localDateKey, localMidnight } from '../../src/model/time';

const tz = 'Europe/Berlin';

describe('local day boundaries', () => {
  it('finds local midnight in summer and winter time', () => {
    expect(localMidnight(Date.UTC(2026, 5, 21, 12), tz)).toBe(Date.UTC(2026, 5, 20, 22));
    expect(localMidnight(Date.UTC(2026, 0, 10, 12), tz)).toBe(Date.UTC(2026, 0, 9, 23));
  });

  it('handles the spring switch (23 h day) and autumn switch (25 h day)', () => {
    const spring = dayStart('2026-03-29', tz);
    expect(spring).toBe(Date.UTC(2026, 2, 28, 23));
    expect(addDays(spring, 1, tz) - spring).toBe(23 * 3_600_000);

    const autumn = dayStart('2026-10-25', tz);
    expect(autumn).toBe(Date.UTC(2026, 9, 24, 22));
    expect(addDays(autumn, 1, tz) - autumn).toBe(25 * 3_600_000);
  });

  it('a timestamp just after the switch still belongs to the same local day', () => {
    const t = Date.UTC(2026, 2, 29, 1, 30); // 03:30 local summer time
    expect(localDateKey(t, tz)).toBe('2026-03-29');
    expect(localMidnight(t, tz)).toBe(Date.UTC(2026, 2, 28, 23));
  });
});
