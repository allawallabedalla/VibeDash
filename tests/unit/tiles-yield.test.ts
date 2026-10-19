import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string, vars: Record<string, string> = {}) =>
    vars.value !== undefined ? `${key}:${vars.value}` : key,
  num: (v: number) => String(Math.round(v)),
  time: () => '12:00',
  i18n: { locale: 'de' },
}));

const { yieldTodayTile } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');
const { daily } = await import('../../src/demo/views');
const { localMidnight } = await import('../../src/model/time');

describe('yield today: the meter first, the forecast below', () => {
  it("shows today's metered yield as the value and the expectation as the sub line", () => {
    const data = generateDemo();
    const tile = yieldTodayTile(data);
    expect(tile.approx).toBe(false);
    expect(tile.value).toBe(String(Math.round(daily(data, 'pv_energy').at(-1)!.value)));
    expect(tile.sub).toMatch(/^sub\.yieldExpected:\d+$/);
  });

  it('falls back to the forecast while the meter has nothing for today', () => {
    const data = generateDemo();
    const start = localMidnight(data.now, data.timeZone);
    data.series.pv_energy!.samples = data.series.pv_energy!.samples.filter((p) => p.t < start);
    const tile = yieldTodayTile(data);
    expect(tile.approx).toBe(true);
    expect(tile.sub).not.toMatch(/yieldExpected/);
  });
});
