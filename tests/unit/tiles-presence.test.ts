import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string, vars: Record<string, string> = {}) =>
    vars.since ? `${key}:${vars.since}` : key,
  num: (v: number) => String(v),
  time: () => '12:00',
  i18n: { locale: 'de' },
}));

const { presenceTile } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');

function withPresence(values: number[]) {
  const demo = generateDemo();
  const step = 60_000;
  const samples = values.map((v, i) => ({ t: demo.now - (values.length - 1 - i) * step, v }));
  return {
    ...demo,
    series: {
      ...demo.series,
      home_presence: { entityId: 'home_presence', source: 'test', stepMs: step, samples },
    },
  };
}

describe('presence tile (someone at home?)', () => {
  it('is not shown when the house has no presence estimate', () => {
    expect(presenceTile(generateDemo())).toBeNull();
  });
  it('active: someone, no ≈, since the last change', () => {
    const tile = presenceTile(withPresence([0, 0, 2, 2, 2]))!;
    expect(tile.value).toBe('presence.someone');
    expect(tile.approx).toBe(false);
    expect(tile.sub).toBe('presence.active:12:00');
  });
  it('quiet and nobody are estimates (≈)', () => {
    expect(presenceTile(withPresence([2, 1, 1]))!).toMatchObject({
      value: 'presence.someone',
      approx: true,
    });
    expect(presenceTile(withPresence([1, 0]))!).toMatchObject({
      value: 'presence.nobody',
      approx: true,
    });
  });
});
