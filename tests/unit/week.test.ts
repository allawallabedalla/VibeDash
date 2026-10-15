import { describe, expect, it } from 'vitest';
import {
  integrateSplit,
  nightMean,
  rangePerDay,
  sumComplete,
  weekDays,
  weekNumbers,
} from '../../src/app/week';
import { generateDemo, type DemoData } from '../../src/demo';

const H = 3_600_000;

describe('week numbers', () => {
  it('splits energy into charge and discharge and does not bridge gaps', () => {
    const s = [
      { t: 0, v: 1000 },
      { t: H, v: 1000 },
      { t: 2 * H, v: -500 },
      { t: 3 * H, v: -500 },
      { t: 10 * H, v: -500 },
    ];
    const e = integrateSplit(s, 0, 10 * H, 2 * H);
    expect(e.pos).toBeCloseTo(1.25);
    expect(e.neg).toBeCloseTo(0.5);
  });

  it('gives lowest–highest and the night mean per day', () => {
    const days = [
      { start: 0, end: 24 * H },
      { start: 24 * H, end: 48 * H },
    ];
    const s = [
      { t: H, v: 40 },
      { t: 2 * H, v: 80 },
      { t: 10 * H, v: 60 },
    ];
    expect(rangePerDay(s, days)).toEqual([{ low: 40, high: 80 }, null]);
    expect(nightMean(s, days)).toEqual([60, null]);
  });

  it('sums only days on which every meter has a value, and counts them (DA-04)', () => {
    // load missing on day 2: neither load nor import of that day may count
    const s = sumComplete([10, null, 10], [5, 5, 0])!;
    expect(s).toEqual({ sums: [20, 5], n: 2 });
    expect(1 - s.sums[1]! / s.sums[0]!).toBeCloseTo(0.75);
    expect(sumComplete([null, null])).toBeNull();
  });

  it('covers seven completed local days and keeps today apart, on the demo household', () => {
    const demo = generateDemo();
    const d = weekDays(demo, 7, -1);
    expect(new Set(d.map((x) => x.day)).size).toBe(7);
    const w = weekNumbers(demo);
    expect(w.total.pv!.value).toBeGreaterThan(0);
    expect(w.autarky!.share).toBeGreaterThanOrEqual(0);
    expect(w.autarky!.share).toBeLessThanOrEqual(1);
    expect(w.days.map((x) => x.day)).not.toContain(w.today.day);
    // the demo has no battery meters: battery comes from power and says so
    expect(w.flows!.source).toBe('power');
    expect(w.flows!.charged).toBeGreaterThan(0);
  });

  it('prefers battery and direct meters over power (DA-02)', () => {
    const demo = generateDemo();
    const days = weekDays(demo, 9, 0);
    // a meter that rises 3 kWh per day
    const meter = (perDay: number) => ({
      entityId: 'm',
      source: 'test',
      stepMs: H,
      samples: days.flatMap((d, i) => [
        { t: d.start + H, v: i * perDay },
        { t: d.start + 23 * H, v: (i + 1) * perDay - 0.001 },
      ]),
    });
    const data: DemoData = {
      ...demo,
      series: {
        ...demo.series,
        battery_charge_energy: meter(3),
        battery_discharge_energy: meter(2),
        direct_energy: meter(4),
      },
    };
    const f = weekNumbers(data).flows!;
    expect(f.source).toBe('meter');
    expect(f.charged / f.n).toBeCloseTo(3, 1);
    expect(f.direct / f.n).toBeCloseTo(4, 1);
  });
});

describe('clock changes (DA-08, C-08)', () => {
  const tz = 'Europe/Berlin';
  const base = generateDemo();
  const at = (iso: string): DemoData => ({ ...base, now: Date.parse(iso), timeZone: tz });

  it('the 25-hour day keeps its last hour', () => {
    // 25.10.2026: clocks go back; 23:30 local is 22:30 UTC
    const day = weekDays(at('2026-10-26T10:00:00Z'), 1, -1)[0]!;
    expect(day.day).toBe('2026-10-25');
    expect(day.end - day.start).toBe(25 * H);
    const s = [
      { t: Date.parse('2026-10-25T10:00:00Z'), v: 50 },
      { t: Date.parse('2026-10-25T22:30:00Z'), v: 10 },
    ];
    expect(rangePerDay(s, [day])).toEqual([{ low: 10, high: 50 }]);
  });

  it('just after midnight following the 23-hour day, yesterday is still that day', () => {
    // 29.03.2027 00:30 local (22:30 UTC on the 28th); 28.03. had 23 hours
    const days = weekDays(at('2027-03-28T22:30:00Z'), 7, -1);
    expect(days.at(-1)!.day).toBe('2027-03-28');
    expect(days.at(-1)!.end - days.at(-1)!.start).toBe(23 * H);
    expect(new Set(days.map((d) => d.day)).size).toBe(7);
  });
});
