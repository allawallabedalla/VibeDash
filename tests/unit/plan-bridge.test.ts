import { describe, expect, it } from 'vitest';
import { loadWithoutCar, planBridge, socAtHours } from '../../server/plan-bridge';
import { validateMapping } from '../../server/mapping';
import { hourlyFromCounter } from '../../server/pv-bridge';
import type { Series } from '../../src/model/types';

const H = 3_600_000;
const series = (samples: { t: number; v: number }[]): Series => ({
  entityId: 'x',
  source: 'test',
  stepMs: 5 * 60_000,
  samples,
});

const ser = (kind: string, unit: string, field: string) => ({
  name: 'X',
  kind,
  unit,
  measurement: 'm',
  field,
  stepMs: 60_000,
});

const base = {
  timeZone: 'Europe/Berlin',
  series: {
    pv_energy: ser('energy_counter', 'kWh', 'pv'),
    load_energy: ser('energy_counter', 'kWh', 'l'),
    car_energy: ser('energy_counter', 'kWh', 'c'),
    battery_soc: ser('state_of_charge', '%', 's'),
  },
  pv: { from: 'pv_energy', planes: [{ name: 'sued', tilt: 30, azimuth: 0, kwp: 5 }] },
  plan: {
    load: 'load_energy',
    carEnergy: 'car_energy',
    soc: 'battery_soc',
    battery: { capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 },
    vehicle: { capacityKwh: 60 },
  },
};

describe('plan mapping', () => {
  it('accepts a plan with defaults', () => {
    const r = validateMapping(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mapping.plan!.battery.reserveKwh).toBe(2);
      expect(r.mapping.plan!.vehicle).toEqual({ capacityKwh: 60, phases: 3, minA: 6, maxA: 16 });
    }
  });

  it('refuses wrong series kinds, a missing PV plant and unknown keys', () => {
    const r = validateMapping({
      ...base,
      pv: undefined,
      plan: { ...base.plan, soc: 'load_energy', switch: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/plan\.switch: unknown key/);
      expect(r.errors.join('\n')).toMatch(/needs mapping\.pv/);
      expect(r.errors.join('\n')).toMatch(/plan\.soc/);
    }
  });
});

describe('plan bridge', () => {
  it('subtracts the wallbox and drops hours without a wallbox reading', () => {
    const house = [
      { zeit: 'a', wert: 5 },
      { zeit: 'b', wert: 1 },
    ];
    expect(loadWithoutCar(house, [{ zeit: 'a', wert: 4.2 }])).toEqual([{ zeit: 'a', wert: 0.8 }]);
    expect(loadWithoutCar(house, null)).toBe(house);
  });

  it('reads the battery at full hours only from fresh samples', () => {
    const s = series([
      { t: H - 5 * 60_000, v: 40 },
      { t: 2 * H - 40 * 60_000, v: 41 },
    ]);
    expect(socAtHours(s, 0, 2 * H)).toEqual([{ zeit: new Date(H).toISOString(), wert: 40 }]);
  });

  it('asks the service with the battery now and what was charged today; says what is missing', async () => {
    const r = validateMapping(base);
    if (!r.ok) throw new Error('mapping');
    const now = Date.parse('2026-06-21T12:00:00Z');
    const urls: string[] = [];
    let soc: { t: number; v: number }[] = [{ t: now - 60_000, v: 50 }];
    const b = planBridge({
      url: 'http://svc',
      mapping: { ...r.mapping, plan: r.mapping.plan! },
      fetchFn: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ zustand: 'bereit' }), { status: 200 });
      },
      series: async (m) =>
        m.entity.id === 'battery_soc'
          ? series(soc)
          : series([
              { t: Date.parse('2026-06-20T21:55:00Z'), v: 100 },
              { t: now, v: 112.5 },
            ]),
      location: async () => ({ lat: 50, lon: 8 }),
      weatherOn: true,
      now: () => now,
      log: () => {},
    });
    expect((await b.read()).status).toBe(200);
    expect(urls.at(-1)).toBe('http://svc/plan/haus?soc_kwh=5&geladen_kwh=12.5');
    soc = [{ t: now - 3 * H, v: 50 }];
    expect((await b.read()).body).toEqual({ zustand: 'fehlt', was: 'akku_jetzt' });
  });
});

describe('a counter that reports only while it moves (quietWhenIdle)', () => {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 9, 19, 0);
  const s = (pts: [number, number][]): Series =>
    ({ stepMs: 5_000, samples: pts.map(([h, v]) => ({ t: t0 + h * H, v })) }) as unknown as Series;

  it('counts a gap with the same reading as zero and holds the last reading until now', () => {
    // reading 10 at 00:10, a charge 05:00–05:30 (10 -> 12), nothing after
    const series = s([
      [0.17, 10],
      [5, 10],
      [5.5, 12],
    ]);
    const now = t0 + 9 * H;
    const quiet = hourlyFromCounter(series, now, true);
    const get = (h: number) =>
      quiet.find((r) => r.zeit === new Date(t0 + h * H).toISOString())?.wert;
    expect([1, 2, 3, 4].map(get)).toEqual([0, 0, 0, 0]);
    expect(get(5)).toBe(2);
    expect([6, 7, 8].map(get)).toEqual([0, 0, 0]);
    // without the option: only hours with readings at both ends
    expect(hourlyFromCounter(series, now).length).toBeLessThan(quiet.length);
  });

  it('leaves a gap with a changed reading unknown', () => {
    const series = s([
      [0.5, 10],
      [3.5, 14],
    ]);
    const r = hourlyFromCounter(series, t0 + 4 * H, true);
    expect(r.map((x) => x.zeit)).not.toContain(new Date(t0 + 1 * H).toISOString());
  });

  it('is allowed only for energy counters in the mapping', () => {
    const base = {
      timeZone: 'Europe/Berlin',
      series: {
        car: {
          name: 'Wallbox',
          kind: 'power',
          unit: 'W',
          measurement: 'wb',
          field: 'w',
          stepMs: 5000,
          quietWhenIdle: true,
        },
      },
    };
    expect(validateMapping(base).ok).toBe(false);
  });
});
