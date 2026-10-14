/**
 * The last seven days in numbers: daily meter values, battery charge range,
 * night base load and where the energy went. Meters first; battery energy has
 * no meter and is summed up from power (marked as an approximation).
 */
import { daily, type DemoData } from '../demo';
import { localDateKey, localMidnight } from '../model/time';
import type { Sample } from '../model/types';

const DAY = 86_400_000;

/** Local day keys from six days ago up to today, with their midnights. */
export function weekDays(data: DemoData, n = 7): { day: string; start: number }[] {
  const today = localMidnight(data.now, data.timeZone);
  const out: { day: string; start: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // noon of each day survives DST shifts; its midnight is the day start
    const start = localMidnight(today - i * DAY + 12 * 3_600_000, data.timeZone);
    out.push({ day: localDateKey(start, data.timeZone), start });
  }
  return out;
}

/** Daily meter values on the given days; null where the meter has nothing. */
export function perDay(data: DemoData, id: string, days: { day: string }[]): (number | null)[] {
  if (!data.series[id]?.samples.length) return days.map(() => null);
  const m = new Map(daily(data, id).map((d) => [d.day, d.value]));
  return days.map((d) => m.get(d.day) ?? null);
}

const sum = (v: (number | null)[]) =>
  v.some((x) => x !== null) ? v.reduce<number>((s, x) => s + (x ?? 0), 0) : null;

/** Lowest and highest value per day (e.g. battery charge from–to). */
export function rangePerDay(
  samples: readonly Sample[],
  days: { start: number }[],
): ({ low: number; high: number } | null)[] {
  return days.map(({ start }) => {
    let low = Infinity;
    let high = -Infinity;
    for (const s of samples) {
      if (s.t < start || s.t >= start + DAY) continue;
      low = Math.min(low, s.v);
      high = Math.max(high, s.v);
    }
    return low <= high ? { low, high } : null;
  });
}

/** Mean between local midnight and `hours` later: the base load at night. */
export function nightMean(
  samples: readonly Sample[],
  days: { start: number }[],
  hours = 5,
): (number | null)[] {
  return days.map(({ start }) => {
    let s = 0;
    let n = 0;
    for (const x of samples) {
      if (x.t < start || x.t >= start + hours * 3_600_000) continue;
      s += x.v;
      n++;
    }
    return n ? s / n : null;
  });
}

/**
 * Energy in kWh from power in W between `from` and `to`, split into the
 * positive and the negative part. Stretches longer than `maxGapMs` are not
 * bridged (a gap stays a gap, it is not filled with a guess).
 */
export function integrateSplit(
  samples: readonly Sample[],
  from: number,
  to: number,
  maxGapMs: number,
): { pos: number; neg: number } {
  let pos = 0;
  let neg = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.t <= from || a.t >= to || b.t - a.t > maxGapMs) continue;
    const wh = (((a.v + b.v) / 2) * (Math.min(b.t, to) - Math.max(a.t, from))) / 3_600_000;
    if (wh >= 0) pos += wh;
    else neg -= wh;
  }
  return { pos: pos / 1000, neg: neg / 1000 };
}

export interface WeekNumbers {
  days: { day: string; start: number }[];
  pv: (number | null)[];
  load: (number | null)[];
  imp: (number | null)[];
  feed: (number | null)[];
  soc: ({ low: number; high: number } | null)[];
  night: (number | null)[];
  total: { pv: number | null; load: number | null; imp: number | null; feed: number | null };
  /** Same sums for the seven days before. */
  before: { pv: number | null; imp: number | null };
  /** Share of consumption not from the grid, 0–1. */
  autarky: number | null;
  /** Battery energy summed up from power (no meter): charged / discharged kWh. */
  battery: { charged: number; discharged: number } | null;
}

export function weekNumbers(data: DemoData): WeekNumbers {
  const days = weekDays(data);
  const earlier = weekDays({ ...data, now: data.now - 7 * DAY });
  const pv = perDay(data, 'pv_energy', days);
  const load = perDay(data, 'load_energy', days);
  const imp = perDay(data, 'import_energy', days);
  const feed = perDay(data, 'feed_in_energy', days);
  const total = { pv: sum(pv), load: sum(load), imp: sum(imp), feed: sum(feed) };
  const bat = data.series.battery_power;
  const battery = bat?.samples.length
    ? (() => {
        const e = integrateSplit(
          bat.samples,
          days[0]!.start,
          data.now,
          // long ranges arrive thinned to 5-min values; bridge those, not real gaps
          Math.max(bat.stepMs * 2.5, 15 * 60_000),
        );
        return { charged: e.pos, discharged: e.neg };
      })()
    : null;
  return {
    days,
    pv,
    load,
    imp,
    feed,
    soc: rangePerDay(data.series.battery_soc?.samples ?? [], days),
    night: nightMean(data.series.load_power?.samples ?? [], days),
    total,
    before: {
      pv: sum(perDay(data, 'pv_energy', earlier)),
      imp: sum(perDay(data, 'import_energy', earlier)),
    },
    autarky:
      total.load !== null && total.imp !== null && total.load > 0
        ? Math.max(0, 1 - total.imp / total.load)
        : null,
    battery,
  };
}
