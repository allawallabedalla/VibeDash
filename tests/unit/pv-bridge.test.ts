import { describe, expect, it } from 'vitest';
import { gtiUrl, parseGti, parseHourly } from '../../src/adapters/openmeteo';
import { hourlyFromCounter } from '../../server/pv-bridge';
import { validateMapping } from '../../server/mapping';

const H = 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 0);

describe('hourly PV from a meter', () => {
  it('reading at hour end minus start; resets and gaps give no value', () => {
    const samples = [];
    for (let t = T0; t <= T0 + 4 * H; t += 15 * 60_000) samples.push({ t, v: 100 + (t - T0) / H });
    // a meter reset in hour 3
    for (const s of samples) if (s.t >= T0 + 3 * H) s.v -= 100;
    const rows = hourlyFromCounter(
      { entityId: 'pv_energy', source: 't', stepMs: 15 * 60_000, samples },
      T0 + 10 * H,
    );
    expect(rows.map((r) => [r.zeit.slice(11, 13), r.wert])).toEqual([
      ['00', 1],
      ['01', 1],
      // hour 02 → 03 crosses the reset: dropped
      ['03', 1],
    ]);
  });
});

describe('Open-Meteo GTI', () => {
  it('asks per plane, rounded, UTC; archive = previous_day1', () => {
    const plane = { name: 'sued', tilt: 30, azimuth: 0, kwp: 6 };
    const live = gtiUrl({ lat: 50.123, lon: 8.456 }, plane, false);
    expect(live).toContain('api.open-meteo.com');
    expect(live).toContain('hourly=global_tilted_irradiance&');
    expect(live).toContain('latitude=50.12');
    expect(live).toContain('timezone=GMT');
    const arch = gtiUrl({ lat: 50.123, lon: 8.456 }, plane, true);
    expect(arch).toContain('previous-runs-api.open-meteo.com');
    expect(arch).toContain('global_tilted_irradiance_previous_day1');
  });

  it('parses GMT times as UTC', () => {
    const rows = parseHourly(
      {
        hourly: {
          time: ['2026-06-01T10:00', '2026-06-01T11:00'],
          global_tilted_irradiance: [600, null],
        },
      },
      'global_tilted_irradiance',
    );
    expect(rows).toEqual([{ t: Date.UTC(2026, 5, 1, 10), v: 600 }]);
  });

  it('puts irradiance on the hour it averages (Open-Meteo: preceding hour)', () => {
    // A real-shaped answer around sunrise: at 06:00 the mean of 05–06 is still tiny.
    const rows = parseGti(
      {
        hourly: {
          time: ['2026-10-10T05:00', '2026-10-10T06:00', '2026-10-10T07:00'],
          global_tilted_irradiance: [0, 5.6, 92],
        },
      },
      'global_tilted_irradiance',
    );
    expect(rows.map((r) => [new Date(r.t).toISOString().slice(11, 16), r.v])).toEqual([
      ['04:00', 0],
      ['05:00', 5.6],
      ['06:00', 92],
    ]);
  });
});

describe('mapping: pv plant', () => {
  const base = {
    timeZone: 'Europe/Berlin',
    series: {
      pv_energy: {
        name: 'PV',
        kind: 'energy_counter',
        unit: 'kWh',
        measurement: 'm',
        field: 'f',
        stepMs: 300000,
      },
    },
  };
  it('accepts roof planes and refuses nonsense', () => {
    const ok = validateMapping({
      ...base,
      pv: { from: 'pv_energy', planes: [{ name: 'sued', tilt: 30, azimuth: 0, kwp: 6 }], maxKw: 8 },
    });
    expect(ok.ok && ok.mapping.pv?.planes[0]?.kwp).toBe(6);
    const bad = validateMapping({
      ...base,
      pv: { from: 'pv_energy', planes: [{ name: 'Süd', tilt: 120, azimuth: 0, kwp: 0 }] },
    });
    expect(bad.ok).toBe(false);
  });
});
