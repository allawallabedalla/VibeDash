import { describe, expect, it } from 'vitest';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';
import { formatNum } from '../../src/i18n/format';

describe('i18n', () => {
  it('has the same keys and placeholders in both languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(en[key], key).toBeTruthy();
      expect(ph(en[key]), key).toBe(ph(de[key]));
    }
  });

  it('contains no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const s of [...Object.values(de), ...Object.values(en)]) expect(s).not.toMatch(emoji);
  });
});

describe('num', () => {
  it('writes what rounds to zero without a sign, and a real minus otherwise (Audit05)', () => {
    expect(formatNum(-0.04, 1, 'de-DE')).toBe('0,0');
    expect(formatNum(-0.4, 0, 'de-DE')).toBe('0');
    expect(formatNum(-0.06, 1, 'de-DE')).toBe('−0,1');
    expect(formatNum(-1234.5, 1, 'de-DE')).toBe('−1.234,5');
    expect(formatNum(-0.004, 2, 'en-GB')).toBe('0.00');
  });
});
