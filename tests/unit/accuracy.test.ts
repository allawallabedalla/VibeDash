import { describe, expect, it } from 'vitest';
import { MIN_JUDGED_DAYS, wilson } from '../../src/model/accuracy';
import { accuracy } from '../../src/demo/forecast';

describe('accuracy at small n (P-06)', () => {
  it('gives the 95 % Wilson range in percent', () => {
    const r = wilson(3, 8);
    expect(r.low).toBeCloseTo(13.7, 0);
    expect(r.high).toBeCloseTo(69.4, 0);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 100 });
  });

  it('gives no verdict below the minimum days, but a range', () => {
    const day = (ok: boolean) => ({ day: 'x', forecast: 10, actual: ok ? 10 : 20, correct: ok });
    const few = accuracy(Array.from({ length: 8 }, (_, i) => day(i < 3)));
    expect(few.pct).toBeNull();
    expect(few.n).toBe(8);
    expect(few.interval).not.toBeNull();
    const many = accuracy(Array.from({ length: MIN_JUDGED_DAYS }, () => day(true)));
    expect(many.pct).toBe(100);
  });
});
