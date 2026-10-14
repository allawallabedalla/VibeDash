import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/adapters/influx1';
import { completeDailyValues, forecastBridge, weatherFeatures } from '../../server/forecast-bridge';
import { validateMapping } from '../../server/mapping';

const TZ = 'Europe/Berlin';
const NOW = Date.UTC(2026, 5, 21, 12); // 14:00 local

const mappingRaw = {
  timeZone: TZ,
  series: {
    pv_energy: {
      name: 'PV',
      kind: 'energy_counter',
      unit: 'kWh',
      measurement: 'm',
      field: 'f',
      stepMs: 3600000,
    },
    pv_power: { name: 'PV', kind: 'power', unit: 'W', measurement: 'm', field: 'p', stepMs: 60000 },
  },
  forecasts: { pv_tag: { from: 'pv_energy', weather: true } },
};

describe('mapping: forecasts', () => {
  it('accepts a daily forecast from an energy counter', () => {
    const r = validateMapping(mappingRaw);
    expect(r.ok && r.mapping.forecasts.pv_tag).toEqual({ from: 'pv_energy', weather: true });
  });
  it('refuses forecasts from non-counters or unknown series', () => {
    const r = validateMapping({
      ...mappingRaw,
      forecasts: { a: { from: 'pv_power' }, b: { from: 'nope' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/a\.from[\s\S]*b\.from/);
  });
});

describe('what is sent to the service', () => {
  it('only complete local days, from the meter reading', () => {
    const samples = [];
    for (let t = NOW - 3 * 86_400_000; t <= NOW; t += 3_600_000)
      samples.push({ t, v: (t - (NOW - 3 * 86_400_000)) / 3_600_000 });
    const days = completeDailyValues(
      { entityId: 'pv_energy', source: 't', stepMs: 3600000, samples },
      TZ,
      NOW,
    );
    expect(days.map((d) => d.tag)).toEqual(['2026-06-19', '2026-06-20']);
    expect(days.every((d) => d.wert === 24)).toBe(true);
  });

  it('weather only for days that have not started, stamped with "now"', () => {
    const w = [
      { tag: '2026-06-21', sonneH: 9, strahlungMj: 20, tMin: 10, tMax: 25, regenMm: 0 },
      { tag: '2026-06-22', sonneH: 4, strahlungMj: null, tMin: 10, tMax: 20, regenMm: 2 },
    ];
    expect(weatherFeatures(w, TZ, NOW)).toEqual([
      { tag: '2026-06-22', name: 'sonne_h', wert: 4, stand: new Date(NOW).toISOString() },
    ]);
  });
});

describe('read proxy', () => {
  it('only for configured names, with clear timeout errors', async () => {
    const r = validateMapping(mappingRaw);
    if (!r.ok) throw new Error('invalid');
    const hang: FetchLike = (_u, init) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)),
      );
    const b = forecastBridge({
      url: 'http://127.0.0.1:8090',
      mapping: r.mapping,
      fetchFn: hang,
      series: async () => ({ entityId: 'x', source: 't', stepMs: 1, samples: [] }),
      weather: async () => null,
      now: () => NOW,
      log: () => {},
      timeoutMs: 30,
    });
    expect((await b.read('other', 'status')).status).toBe(404);
    expect(await b.read('pv_tag', 'status')).toEqual({ status: 504, body: { error: 'timeout' } });
  });
});

describe('sync', () => {
  it('sends long history first, then only recent days', async () => {
    const r = validateMapping(mappingRaw);
    if (!r.ok) throw new Error('invalid');
    const ranges: number[] = [];
    const ok: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    });
    const b = forecastBridge({
      url: 'http://127.0.0.1:8090',
      mapping: r.mapping,
      fetchFn: ok,
      series: async (_m, from, to) => {
        ranges.push(Math.round((to - from) / 86_400_000));
        return { entityId: 'pv_energy', source: 't', stepMs: 1, samples: [] };
      },
      weather: async () => null,
      now: () => NOW,
      log: () => {},
    });
    await b.syncAll();
    await b.syncAll();
    expect(ranges).toEqual([400, 8]);
  });
});
