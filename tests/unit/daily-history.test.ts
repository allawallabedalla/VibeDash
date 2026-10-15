import { describe, expect, it } from 'vitest';
import { createBackends } from '../../server/backends';
import { readConfig } from '../../server/config';
import { validateMapping } from '../../server/mapping';

// Synthetic meter: new measurement from day 6, older one before (16-bit counter).
const D = 86_400_000;
const mapping = validateMapping({
  timeZone: 'UTC',
  series: {
    meter: {
      name: 'Meter',
      kind: 'energy_counter',
      unit: 'kWh',
      measurement: 'new_m',
      field: 'total',
      stepMs: 60_000,
      maxPerDay: 200,
      history: { measurement: 'old_m', field: 'total_old', validBelow: 6553.5 },
    },
  },
});

describe('daily values from an older series (N-01)', () => {
  it('filters stuck readings in the query, drops dips, drops and giant days', async () => {
    if (!mapping.ok) throw new Error(mapping.errors.join());
    const queries: string[] = [];
    const answer = (rows: [number, number][]) => ({
      results: [
        { statement_id: 0, series: [{ name: 'x', columns: ['time', 'last'], values: rows }] },
      ],
    });
    const fetchFn = async (url: string) => {
      const q = new URL(url).searchParams.get('q')!;
      queries.push(q);
      const body = q.includes('old_m')
        ? // +40, a dip, a wrap (drop), +30
          answer([
            [0, 6500],
            [D, 6540],
            [2 * D, 6520], // dip, dropped
            [3 * D, 6550],
            [4 * D, 20], // wrap: a drop, a gap
            [5 * D, 50],
          ])
        : answer([
            [6 * D, 60],
            [7 * D, 400],
          ]);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const { config } = readConfig({ INFLUX_URL: 'http://influx.example', INFLUX_DB: 'x' });
    const b = createBackends(mapping.mapping, config, fetchFn as never);
    if (!b.ok) throw new Error(b.errors.join());
    const days = await b.daily(mapping.mapping.series.meter!, D, 8 * D);
    expect(queries.find((q) => q.includes('old_m'))).toContain(
      '"total_old" > 0 AND "total_old" < 6553.5',
    );
    expect(days).toEqual([
      [D, 40],
      [3 * D, null], // two days in one step: not split up
      [4 * D, null], // the wrap is a drop, never a negative day
      [5 * D, 30],
      [6 * D, 10],
      [7 * D, null], // above maxPerDay
    ]);
  });
});
