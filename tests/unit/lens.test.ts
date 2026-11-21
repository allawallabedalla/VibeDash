import { describe, expect, it } from 'vitest';
import {
  lensDigits,
  lensRows,
  lensText,
  lensTime,
  medianStep,
  nearestIndex,
  signed,
  type LensFormat,
  type LensSeries,
} from '../../src/components/lens';
import { formatNum } from '../../src/i18n/format';

const n = (v: number, d = 1) => formatNum(v, d, 'de-DE');
const f: LensFormat = {
  value: (v) => `${n(v)} kW`,
  range: (lo, hi) => `${n(lo)}–${n(hi)}`,
  diff: (v) => `${n(v)} kW`,
  unit: ' kW',
};
const tx = { noData: 'keine Daten', diff: 'Ist − Prognose' };

describe('nearestIndex', () => {
  const xs = [10, 20, 30, 40];
  it('finds the nearest point, also outside the ends', () => {
    expect(nearestIndex(xs, 24)).toBe(1);
    expect(nearestIndex(xs, 26)).toBe(2);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex(xs, 25)).toBe(1);
  });
  it('one point, no points', () => {
    expect(nearestIndex([7], 100)).toBe(0);
    expect(nearestIndex([], 3)).toBe(-1);
  });
  it('many points: binary search agrees with a plain scan', () => {
    const many = Array.from({ length: 721 }, (_, i) => i * 1.37);
    for (const px of [0, 3.3, 500, 987.6, 2000]) {
      const scan = many.reduce(
        (b, x, i) => (Math.abs(x - px) < Math.abs(many[b]! - px) ? i : b),
        0,
      );
      expect(nearestIndex(many, px)).toBe(scan);
    }
  });
});

describe('lensDigits (G-28)', () => {
  it('whole counts stay whole, small spans get decimals, never more than 2', () => {
    expect(lensDigits([1, 4, null, 8])).toBe(0);
    expect(lensDigits([0.4, 3.2, 2.8])).toBe(1);
    expect(lensDigits([20.5, 21.3])).toBe(1);
    expect(lensDigits([12.5, 87.3])).toBe(0);
    expect(lensDigits([0.01, 0.12])).toBe(2);
    expect(lensDigits([12.5, 87.3], 2)).toBe(2);
    expect(lensDigits([0.01, 0.02], 5)).toBe(2);
    expect(lensDigits([null, null])).toBe(0);
  });
});

describe('lensTime (house time zone)', () => {
  const t = Date.UTC(2026, 10, 17, 13, 30); // 14:30 in Berlin
  it('time of day within a day, weekday and date over several days, date for daily values', () => {
    expect(lensTime(t, 'Europe/Berlin', 300_000, 86_400_000)).toBe('14:30');
    expect(lensTime(t, 'Europe/Berlin', 900_000, 7 * 86_400_000)).toMatch(
      /^Di\.?,? 17\.11\.,? 14:30$/,
    );
    expect(lensTime(t, 'Europe/Berlin', 86_400_000, 30 * 86_400_000)).toMatch(/^Di\.?,? 17\.11\.$/);
    expect(lensTime(t, 'America/New_York', 300_000, 86_400_000)).toBe('08:30');
  });
  it('medianStep ignores one long gap', () => {
    expect(medianStep([0, 5, 10, 100, 105])).toBe(5);
    expect(medianStep([3])).toBe(0);
  });
});

describe('lensRows / lensText', () => {
  const sun: LensSeries[] = [
    { label: 'Ist', color: 'y', values: [3.2, 1, null, null], kind: 'actual' },
    {
      label: 'Prognose',
      color: 'y',
      values: [2.8, null, 2.5, null],
      low: [1.9, null, 1.2, null],
      high: [3.6, null, 3.1, null],
      kind: 'forecast',
    },
  ];
  it('actual, forecast with range and the difference', () => {
    const rows = lensRows(0, sun, f, tx);
    expect(lensText('14:30', rows, tx.noData)).toBe(
      '14:30 · Ist 3,2 kW · Prognose 2,8 kW (1,9–3,6) · Ist − Prognose +0,4 kW',
    );
    expect(rows[1]!.dashed).toBe(true);
    expect(rows.at(-1)!.diff).toBe(true);
  });
  it('a negative difference has a real minus, zero no sign', () => {
    const s: LensSeries[] = [
      { label: 'Ist', color: '', values: [2], kind: 'actual' },
      { label: 'Prognose', color: '', values: [2.5], kind: 'forecast' },
    ];
    expect(lensRows(0, s, f, tx).at(-1)!.value).toBe('−0,5 kW');
    s[1]!.values = [2.02];
    expect(lensRows(0, s, f, tx).at(-1)!.value).toBe('0,0 kW');
    expect(signed('0,0')).toBe('0,0');
    expect(signed('−1')).toBe('−1');
    expect(signed('1,5 kW')).toBe('+1,5 kW');
  });
  it('the future: no actual row, only the forecast', () => {
    expect(lensText('18:00', lensRows(2, sun, f, tx, true), tx.noData)).toBe(
      '18:00 · Prognose 2,5 kW (1,2–3,1)',
    );
  });
  it('a gap in the past says "keine Daten"', () => {
    const rows = lensRows(2, sun, f, tx, false);
    expect(rows).toEqual([
      expect.objectContaining({ label: 'Ist', value: 'keine Daten', gap: true }),
      expect.objectContaining({ label: 'Prognose' }),
    ]);
    expect(lensText('18:00', lensRows(3, sun, f, tx), tx.noData)).toBe('18:00 · keine Daten');
  });
  it('plain lines: each with value, a missing one "keine Daten"', () => {
    const s: LensSeries[] = [
      { label: 'CPU', color: 'a', values: [41.25, null] },
      { label: 'SSD', color: 'b', values: [-3, 30] },
    ];
    const g: LensFormat = { ...f, value: (v) => `${n(v)} °C` };
    expect(lensText('09:00', lensRows(0, s, g, tx), tx.noData)).toBe(
      '09:00 · CPU 41,3 °C · SSD −3,0 °C',
    );
    expect(lensText('09:15', lensRows(1, s, g, tx), tx.noData)).toBe(
      '09:15 · CPU keine Daten · SSD 30,0 °C',
    );
  });
  it('a band without forecast: the usual range with unit', () => {
    const s: LensSeries[] = [
      { label: 'Ist', color: '', values: [1.2], kind: 'actual' },
      { label: 'üblich', color: '', values: [], kind: 'band', low: [0.8], high: [1.6] },
    ];
    expect(lensText('03:00', lensRows(0, s, f, tx), tx.noData)).toBe(
      '03:00 · Ist 1,2 kW · üblich 0,8–1,6 kW',
    );
  });
  it('never None/NaN/undefined in the text', () => {
    const s: LensSeries[] = [{ label: 'X', color: '', values: [] }];
    expect(lensText('1', lensRows(5, s, f, tx), tx.noData)).toBe('1 · keine Daten');
  });
});
