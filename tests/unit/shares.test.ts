import { describe, expect, it } from 'vitest';
import { axisMarks, bandLayout, wholePercents } from '../../src/model/shares';

describe('100 % bands on one scale (Audit05 I-7, G5-06)', () => {
  it('the same kWh is equally long in both bands', () => {
    // sun: 50 house, 61 battery, 100 grid · house: 50 sun, 61 battery, 2 grid
    const l = bandLayout([
      [{ value: 50 }, { value: 61 }, { value: 100 }],
      [{ value: 50 }, { value: 61 }, { value: 2 }],
    ]);
    expect(l.max).toBe(211);
    expect(l.rows[0]!.parts[1]!.width).toBeCloseTo(l.rows[1]!.parts[1]!.width);
    expect(l.rows[1]!.length).toBeCloseTo(113 / 211);
    // but the shares are of each band
    expect(l.rows[0]!.parts[1]!.share).toBeCloseTo(61 / 211);
    expect(l.rows[1]!.parts[1]!.share).toBeCloseTo(61 / 113);
    // parts follow each other
    expect(l.rows[0]!.parts[2]!.start).toBeCloseTo(111 / 211);
  });

  it('an unknown part: no share, total is a lower bound', () => {
    const l = bandLayout([[{ value: 10 }, { value: null }]]);
    expect(l.rows[0]!.incomplete).toBe(true);
    expect(l.rows[0]!.total).toBe(10);
    expect(l.rows[0]!.parts[1]!.share).toBeNull();
  });

  it('whole percent add up to 100', () => {
    expect(wholePercents([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
    expect(wholePercents([0.306, 0.154, 0.54])).toEqual([31, 15, 54]);
    expect(wholePercents([1, null])).toEqual([100, null]);
  });

  it('axis marks are round', () => {
    expect(axisMarks(218)).toEqual([0, 100, 200]);
    expect(axisMarks(0)).toEqual([0]);
  });
});
