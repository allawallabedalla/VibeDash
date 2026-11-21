import { describe, expect, it } from 'vitest';
import {
  barBox,
  barDigits,
  barIndex,
  barLabel,
  barSpan,
  barText,
  type BarData,
} from '../../src/components/bar-lens';
import { formatNum } from '../../src/i18n/format';

const num = (v: number, d: number) => formatNum(v, d, 'de-DE');
const tx = {
  noData: 'keine Daten',
  notYet: 'noch nicht',
  soFar: 'bis jetzt',
  mean: 'Mittel',
  total: 'zusammen',
};

describe('barIndex', () => {
  // 4 bars of 40 px with 6 px gaps: 0–40, 46–86, 92–132, 138–178
  const w = 4 * 40 + 3 * 6;
  it('finds the bar under x, a gap half to each side', () => {
    expect(barIndex(0, w, 4, 6)).toBe(0);
    expect(barIndex(39, w, 4, 6)).toBe(0);
    expect(barIndex(42, w, 4, 6)).toBe(0);
    expect(barIndex(44, w, 4, 6)).toBe(1);
    expect(barIndex(100, w, 4, 6)).toBe(2);
    expect(barIndex(177, w, 4, 6)).toBe(3);
  });
  it('outside the ends: the first and last bar', () => {
    expect(barIndex(-10, w, 4, 6)).toBe(0);
    expect(barIndex(500, w, 4, 6)).toBe(3);
  });
  it('96 quarter hours with 1 px gaps, no bars', () => {
    const W = 96 * 3 + 95;
    for (const i of [0, 13, 52, 95]) {
      const s = barSpan(i, W, 96, 1);
      expect(barIndex(s.left + s.width / 2, W, 96, 1)).toBe(i);
    }
    expect(barIndex(10, 100, 0)).toBe(-1);
  });
  it('the span of a bar is where barIndex finds it', () => {
    expect(barSpan(2, w, 4, 6)).toEqual({ left: 92, width: 40 });
  });
});

describe('barLabel', () => {
  const q = Array.from(
    { length: 96 },
    (_, i) =>
      `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
  );
  it('quarter hours: from–to', () => {
    expect(barLabel(q, 52)).toBe('13:00–13:15');
    expect(barLabel(q, 95)).toBe('23:45–24:00');
    expect(barLabel(q, 0)).toBe('00:00–00:15');
  });
  it('whole hours of a day ("13"): from–to as times, over midnight too', () => {
    const h = ['22', '23', '00', '01'];
    expect(barLabel(h, 0)).toBe('22:00–23:00');
    expect(barLabel(h, 1)).toBe('23:00–24:00');
    expect(barLabel(h, 2)).toBe('00:00–01:00');
  });
  it('days, weekdays and single times stay as they are', () => {
    expect(barLabel(['9.2.', '10.2.'], 1)).toBe('10.2.');
    expect(barLabel(['Mo.', 'Di.'], 0)).toBe('Mo.');
    expect(barLabel(['13:00'], 0)).toBe('13:00');
    // day numbers of a month are not hours
    expect(barLabel(['28', '29', '30', '31'], 0)).toBe('28');
  });
});

describe('barBox', () => {
  const d: BarData = {
    labels: ['Mo.', 'Di.', 'Mi.', 'Do.'],
    values: [12.34, null, -0.5, 3],
    unit: 'kWh',
    partial: 2,
    mean: 7.25,
  };
  it('label, value with unit (≤ 2 decimals, real minus), mean', () => {
    const b = barBox(0, d, num, tx);
    expect(b.when).toBe('Mo.');
    expect(b.rows).toEqual([
      { value: '12,3 kWh', color: undefined },
      { label: 'Mittel', value: '7,3 kWh', mean: true },
    ]);
    expect(barBox(2, d, num, tx).rows[0]!.value).toBe('−0,5 kWh');
    expect(barText(b)).toBe('Mo. · 12,3 kWh · Mittel 7,3 kWh');
  });
  it('the running day "bis jetzt", a gap "keine Daten", after today "noch nicht"', () => {
    expect(barBox(2, d, num, tx).when).toBe('Mi. · bis jetzt');
    expect(barBox(1, d, num, tx).rows[0]).toEqual({ value: 'keine Daten', gap: true });
    expect(barBox(3, { ...d, values: [1, 2, 3, null] }, num, tx).rows[0]!.value).toBe('noch nicht');
  });
  it('whole litres stay whole; never more than 2 decimals', () => {
    expect(barDigits({ labels: [], unit: 'l', values: [0, 3, 48] })).toBe(0);
    expect(barDigits({ labels: [], unit: 'kWh', values: [0.011, 0.123] })).toBe(2);
    const q = barBox(1, { labels: ['13:00', '13:15'], unit: 'l', values: [0, 48] }, num, tx);
    expect(barText(q)).toBe('13:15–13:30 · 48 l');
  });
  it('stacked parts: total first, then each part above 0', () => {
    const s: BarData = {
      labels: ['1.3.', '2.3.'],
      unit: 'kWh',
      parts: [[4, 0, 1.5], null],
      names: ['Sonne', 'Akku', 'Netz'],
      colors: ['y', 'g', 'r'],
    };
    const b = barBox(0, s, num, tx);
    expect(b.rows.map((r) => `${r.label} ${r.value}`)).toEqual([
      'zusammen 5,5 kWh',
      'Sonne 4,0 kWh',
      'Netz 1,5 kWh',
    ]);
    expect(barBox(1, s, num, tx).rows[0]!.gap).toBe(true);
  });
  it('a range: from–to with unit', () => {
    const r: BarData = { labels: ['Mo.'], unit: '%', ranges: [{ low: 21, high: 88 }] };
    expect(barBox(0, r, num, tx).rows[0]!.value).toBe('21–88 %');
  });
});
