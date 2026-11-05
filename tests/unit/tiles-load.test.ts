import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string, vars: Record<string, string> = {}) =>
    Object.keys(vars).length ? `${key}:${Object.values(vars).join('/')}` : key,
  num: (v: number) => String(Math.round(v)),
  time: () => '12:00',
  i18n: { locale: 'de' },
}));

const { loadTile } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');
const { daily } = await import('../../src/demo/views');
const { localMidnight } = await import('../../src/model/time');

describe('consumption: the value now, today and yesterday small below', () => {
  it('names the day so far and yesterday from the meter', () => {
    const data = generateDemo();
    const [yesterday, today] = daily(data, 'load_energy').slice(-2);
    const tile = loadTile(data);
    expect(tile.unit).toBe('kW');
    expect(tile.sub).toBe(
      `sub.loadDays:${Math.round(today!.value)}/${Math.round(yesterday!.value)}`,
    );
  });

  it('says "now" while there is no consumption for today yet', () => {
    const data = generateDemo();
    const start = localMidnight(data.now, data.timeZone);
    data.series.load_energy!.samples = data.series.load_energy!.samples.filter((p) => p.t < start);
    expect(loadTile(data).sub).toBe('sub.now');
  });
});
