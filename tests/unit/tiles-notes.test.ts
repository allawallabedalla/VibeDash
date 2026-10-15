import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string) => key,
  num: (v: number) => String(v),
  time: () => '00:00',
  i18n: { locale: 'de' },
}));

const { humidityTile, tempTile } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');

describe('sensor notes come from the data, never from fixed text', () => {
  it('names the gap and the odd value the demo really has', () => {
    const demo = generateDemo();
    expect(tempTile(demo).info!.source).toContain('info.gapNote');
    expect(humidityTile(demo).info!.what).toBe('info.outlier');
  });

  it('adds nothing for a house without gaps or odd values', () => {
    const clean = { ...generateDemo(), issues: [] };
    expect(tempTile(clean).info!.source).toBe('info.temp.source');
    expect(humidityTile(clean).info!.what).toBe('info.humidity.what');
    expect(humidityTile(clean).status).toBeUndefined();
  });
});
