import { describe, expect, it } from 'vitest';
import { chargeSessions, originDays, parsePlan } from '../../server/charging';
import { validateMapping } from '../../server/mapping';

const m = {
  sessions: {
    measurement: 'ladung',
    energy: 'kwh',
    running: 'laeuft',
    duration: 'dauer_min',
    source: 'quelle',
    id: 'tid',
  },
  sources: { pi: 'auto', app: 'app' } as const,
};

describe('car charging from house records (read-only)', () => {
  it('pairs start and end rows by id; a running charge has no end', async () => {
    const values = [
      [1000, null, true, null, 'pi', 1],
      [1000, 2.5, false, 30, 'pi', 1],
      [5000, null, true, null, 'app', 2],
    ];
    const q = async (sql: string) => {
      expect(sql).toContain('FROM "ladung"');
      return {
        results: [
          {
            series: [{ columns: ['time', 'kwh', 'laeuft', 'dauer_min', 'quelle', 'tid'], values }],
          },
        ],
      };
    };
    const s = await chargeSessions(q, m, 0, 10_000);
    expect(s).toEqual([
      { start: 1000, end: 1000 + 30 * 60_000, kwh: 2.5, source: 'auto', gridKwh: null },
      { start: 5000, end: null, kwh: null, source: 'app', gridKwh: null },
    ]);
  });

  it('a repeated end row without energy keeps the first end (N-06)', async () => {
    const values = [
      [1000, 0.5, false, 8, 'pi', 7],
      [460_000, null, false, 0, '?', 7],
    ];
    const q = async () => ({
      results: [
        { series: [{ columns: ['time', 'kwh', 'laeuft', 'dauer_min', 'quelle', 'tid'], values }] },
      ],
    });
    expect(await chargeSessions(q, m, 0, 1e6)).toEqual([
      { start: 1000, end: 1000 + 8 * 60_000, kwh: 0.5, source: 'auto', gridKwh: null },
    ]);
  });

  it('a charge the house marks as forced shows as "charge now" (EM-02)', async () => {
    const values = [
      [1000, 4, false, 60, 'pi', 3, true],
      [9000, 1, false, 10, 'pi', 4, null],
    ];
    const q = async (sql: string) => {
      expect(sql).toContain('"erzwungen"');
      return {
        results: [
          {
            series: [
              {
                columns: ['time', 'kwh', 'laeuft', 'dauer_min', 'quelle', 'tid', 'erzwungen'],
                values,
              },
            ],
          },
        ],
      };
    };
    const mf = { ...m, sessions: { ...m.sessions, forced: 'erzwungen' } };
    expect((await chargeSessions(q, mf, 0, 1e6)).map((x) => x.source)).toEqual(['force', 'auto']);
  });

  it('reads an external plan by the field names of the mapping, drops broken blocks', () => {
    const fields = {
      text: 'kurz',
      madeAt: 'stand',
      soc: 'soc',
      socMin: 'soc_min',
      days: [
        { kwh: 'heute_kwh', low: 'heute_lo', high: 'heute_hi' },
        { kwh: 'morgen_kwh', low: 'morgen_lo', high: 'morgen_hi' },
      ],
      blocks: { start: 'start', end: 'ende', amps: 'a', kwh: 'kwh', reason: 'grund' },
    };
    const p = parsePlan(
      [{ kurz: 'heute 11–17 Uhr', stand: 7, heute_kwh: 20, heute_lo: 18, heute_hi: 40, soc: 50 }],
      [
        { start: 100, ende: 200, a: 6, kwh: 8.5, grund: 'Sonne' },
        { start: 300, ende: 250 },
        'Unsinn',
      ],
      fields,
    )!;
    expect(p.text).toBe('heute 11–17 Uhr');
    expect(p.days[0]).toEqual({ kwh: 20, low: 18, high: 40 });
    expect(p.days[1]).toEqual({ kwh: null, low: null, high: null });
    expect(p.blocks).toEqual([{ start: 100, end: 200, amps: 6, kwh: 8.5, reason: 'Sonne' }]);
    expect(parsePlan('kaputt', [])).toBeNull();
    // without fields: the generic names
    expect(parsePlan({ text: 'x', todayKwh: 3 }, [])!.days[0]!.kwh).toBe(3);
  });

  it('puts the car energy by origin side by side per day; a missing day stays null (I-2)', () => {
    const D = 86_400_000;
    const rows = originDays(
      [
        { t: 0, v: 10 },
        { t: D, v: 0 },
      ],
      [
        { t: 0, v: 2.004 },
        { t: D, v: -1 },
      ],
      [{ t: 0, v: 5 }],
    );
    expect(rows).toEqual([
      { day: 0, sun: 10, battery: 2, grid: 5 },
      // 0 is a value; a read error (−1) and a missing grid day are gaps
      { day: D, sun: 0, battery: null, grid: null },
    ]);
  });

  it('accepts the origin series only when all three are mapped (I-2)', () => {
    const day = (field: string) => ({
      name: field,
      kind: 'energy',
      unit: 'kWh',
      measurement: 'tag',
      field,
      stepMs: 86_400_000,
      helper: true,
    });
    const base = {
      timeZone: 'UTC',
      series: { car_sun: day('pv'), car_battery: day('akku'), car_grid: day('netz') },
      charging: { sessions: { measurement: 'ladung', energy: 'kwh', running: 'laeuft' } },
    };
    const ok = validateMapping({
      ...base,
      charging: {
        ...base.charging,
        origin: { sun: 'car_sun', battery: 'car_battery', grid: 'car_grid' },
      },
    });
    expect(ok.ok && ok.mapping.charging?.origin).toEqual({
      sun: 'car_sun',
      battery: 'car_battery',
      grid: 'car_grid',
    });
    const bad = validateMapping({
      ...base,
      charging: { ...base.charging, origin: { sun: 'car_sun', battery: 'nope', grid: 'car_grid' } },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join()).toContain('mapping.charging.origin');
    const none = validateMapping(base);
    expect(none.ok && none.mapping.charging?.origin).toBeUndefined();
  });
});
