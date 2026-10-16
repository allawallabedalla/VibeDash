import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string) => key,
  num: (v: number) => String(v),
  time: () => '00:00',
  i18n: { locale: 'de' },
}));

const { gridTile } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');

/** demo house with the latest grid reading set to `w` watts */
function withGrid(w: number) {
  const demo = generateDemo();
  const s = demo.series['grid_power']!;
  const last = s.samples.at(-1)!;
  return {
    ...demo,
    series: {
      ...demo.series,
      grid_power: { ...s, samples: [...s.samples.slice(0, -1), { ...last, v: w }] },
    },
  };
}

describe('grid tile: one label, sign and word agree (Audit03 U-02)', () => {
  it('import: label "grid", minus sign, word "import" – never "import −0.1"', () => {
    const tile = gridTile(withGrid(-1200));
    expect(tile.label).toBe('tile.grid');
    expect(tile.value.startsWith('−')).toBe(true);
    expect(tile.sub).toBe('word.import');
  });
  it('feed-in: plus sign and word "feed"', () => {
    const tile = gridTile(withGrid(2500));
    expect(tile.value.startsWith('+')).toBe(true);
    expect(tile.sub).toBe('word.feed');
  });
  it('a few watts either way count as balanced', () => {
    const tile = gridTile(withGrid(-40));
    expect(tile.value).toBe('0');
    expect(tile.sub).toBe('word.balanced');
  });
});
