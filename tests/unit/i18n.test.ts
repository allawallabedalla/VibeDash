import { describe, expect, it } from 'vitest';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';

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
