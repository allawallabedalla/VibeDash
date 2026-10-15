import { describe, expect, it } from 'vitest';
import { chargeSessions, parsePlan } from '../../server/charging';

const m = {
  sessions: {
    measurement: 'ladung',
    energy: 'kwh',
    running: 'laeuft',
    duration: 'dauer_min',
    source: 'quelle',
    id: 'tid',
  },
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
      { start: 1000, end: 1000 + 30 * 60_000, kwh: 2.5, source: 'pi', gridKwh: null },
      { start: 5000, end: null, kwh: null, source: 'app', gridKwh: null },
    ]);
  });

  it('reads an external plan and drops broken blocks', () => {
    const p = parsePlan(
      [{ kurz: 'heute 11–17 Uhr', stand: 7, heute_kwh: 20, heute_p10: 18, heute_p90: 40, soc: 50 }],
      [
        { start: 100, ende: 200, a: 6, kwh: 8.5, grund: 'Sonne' },
        { start: 300, ende: 250 },
        'Unsinn',
      ],
    )!;
    expect(p.text).toBe('heute 11–17 Uhr');
    expect(p.days[0]).toEqual({ kwh: 20, low: 18, high: 40 });
    expect(p.days[1]).toEqual({ kwh: null, low: null, high: null });
    expect(p.blocks).toEqual([{ start: 100, end: 200, amps: 6, kwh: 8.5, reason: 'Sonne' }]);
    expect(parsePlan('kaputt', [])).toBeNull();
  });
});
