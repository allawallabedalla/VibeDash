import { describe, expect, it } from 'vitest';
import { batteryNext, carNext, duration } from '../../src/model/outlook';

const H = 3_600_000;
const T = 100 * H;

describe('what happens next', () => {
  it('car charging inside a block: until its end, kWh left pro rata, touching blocks joined', () => {
    const r = carNext(T, true, [
      { start: T - H, end: T + H, kwh: 8 },
      { start: T + H, end: T + 2 * H, kwh: 3 },
      { start: T + 5 * H, end: T + 6 * H, kwh: 4 },
    ]);
    expect(r).toEqual({ kind: 'until', at: T + 2 * H, kwhLeft: 7 });
  });
  it('car charging without a block: outside the plan', () => {
    expect(carNext(T, true, [{ start: T + H, end: T + 2 * H, kwh: 3 }])).toEqual({
      kind: 'outside',
    });
  });
  it('car waiting: the next block', () => {
    expect(carNext(T, false, [{ start: T + 3 * H, end: T + 4 * H, kwh: 3 }])).toEqual({
      kind: 'next',
      at: T + 3 * H,
    });
    expect(carNext(T, false, [])).toBeNull();
  });
  it('battery: hours to full or to the discharge limit at this power', () => {
    expect(batteryNext(2_000, 90, 20)).toEqual({ kind: 'full', hours: 1 });
    expect(batteryNext(-3_000, 90, 20, 5)!.hours).toBeCloseTo(17 / 3);
    expect(batteryNext(50, 90, 20)).toBeNull();
    expect(batteryNext(2_000, 100, 20)).toBeNull();
  });
  it('durations read like people talk', () => {
    expect(duration(0.4, { over: 'über' })).toBe('≈ 25 min');
    expect(duration(1.33, { over: 'über' })).toBe('≈ 1 h 20 min');
    expect(duration(2, { over: 'über' })).toBe('≈ 2 h');
    expect(duration(20, { over: 'über' })).toBe('über 12 h');
  });
});
