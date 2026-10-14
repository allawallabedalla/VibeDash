import { describe, expect, it } from 'vitest';
import { validateMapping } from '../../server/mapping';

const base = {
  load_power: {
    name: 'House',
    kind: 'power',
    unit: 'W',
    measurement: 'example_meter',
    field: 'power',
    stepMs: 10000,
  },
  car_energy: {
    name: 'Car',
    kind: 'energy_counter',
    unit: 'Wh',
    measurement: 'example_wallbox',
    field: 'energy_wh',
    stepMs: 5000,
    helper: true,
  },
};

describe('derived series in the mapping', () => {
  it('accepts an integral minus a meter', () => {
    const r = validateMapping({
      timeZone: 'Europe/Berlin',
      series: {
        ...base,
        load_energy: {
          source: 'derived',
          name: 'House',
          kind: 'energy_counter',
          unit: 'kWh',
          stepMs: 60000,
          maxPerDay: 200,
          terms: [{ integrate: 'load_power' }, { counter: 'car_energy', sign: -1 }],
        },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.mapping.series.load_energy!;
    expect(m.source).toBe('derived');
    expect(m.entity.maxPerDay).toBe(200);
    expect(r.mapping.series.car_energy!.helper).toBe(true);
  });

  it('refuses wrong kinds, unknown series and other units', () => {
    const r = validateMapping({
      timeZone: 'Europe/Berlin',
      series: {
        ...base,
        bad: {
          source: 'derived',
          name: 'x',
          kind: 'power',
          unit: 'W',
          stepMs: 60000,
          terms: [
            { integrate: 'car_energy' },
            { counter: 'nope' },
            { integrate: 'a', counter: 'b' },
          ],
        },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/energy_counter in kWh/);
    expect(r.errors.join('\n')).toMatch(/terms\[0\].*power in W or kW/);
    expect(r.errors.join('\n')).toMatch(/terms\[1\].*"nope"/);
    expect(r.errors.join('\n')).toMatch(/terms\[2\]/);
  });
});
