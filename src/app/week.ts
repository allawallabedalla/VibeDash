/**
 * The last seven days in numbers: daily meter values, battery charge range,
 * night base load and where the energy went. Sums and comparisons use the
 * seven *completed* days (yesterday and the six before), so they do not move
 * during the day; the running day is kept apart.
 *
 * Meters first (Audit01 DA-02): battery charge/discharge and "sun directly"
 * come from their meters when the house has them; only without meters is the
 * battery summed up from power, and then marked as such. A sum only covers
 * days on which every meter it needs has a value, and says how many (DA-04).
 * Days are local calendar days of 23, 24 or 25 hours (DA-08).
 */
import { daily, type DemoData } from '../demo';
import { addDays, localDateKey, localMidnight } from '../model/time';
import { toGrid } from '../model/series';
import type { Sample } from '../model/types';

export interface Day {
  day: string;
  start: number;
  /** Next local midnight (23–25 h later around a clock change). */
  end: number;
}

/** `n` local days ending with the day `offset` days from today (0 = today). */
export function weekDays(data: DemoData, n = 7, offset = 0): Day[] {
  const today = localMidnight(data.now, data.timeZone);
  const out: Day[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(today, offset - i, data.timeZone);
    out.push({
      day: localDateKey(start, data.timeZone),
      start,
      end: addDays(start, 1, data.timeZone),
    });
  }
  return out;
}

/** Daily meter values on the given days; null where the meter has nothing. */
export function perDay(data: DemoData, id: string, days: { day: string }[]): (number | null)[] {
  if (!data.series[id]?.samples.length) return days.map(() => null);
  const m = new Map(daily(data, id).map((d) => [d.day, d.value]));
  return days.map((d) => m.get(d.day) ?? null);
}

/**
 * Sums over the days on which *all* given rows have a value: a missing day
 * is left out, never counted as 0. `n` says how many days that were.
 */
export function sumComplete(...rows: (number | null)[][]): { sums: number[]; n: number } | null {
  const len = rows[0]?.length ?? 0;
  const sums = rows.map(() => 0);
  let n = 0;
  for (let i = 0; i < len; i++) {
    if (rows.some((r) => r[i] === null || r[i] === undefined)) continue;
    rows.forEach((r, k) => (sums[k]! += r[i]!));
    n++;
  }
  return n ? { sums, n } : null;
}

/** Lowest and highest value per day (e.g. battery charge from–to). */
export function rangePerDay(
  samples: readonly Sample[],
  days: { start: number; end: number }[],
): ({ low: number; high: number } | null)[] {
  return days.map(({ start, end }) => {
    let low = Infinity;
    let high = -Infinity;
    for (const s of samples) {
      if (s.t < start || s.t >= end) continue;
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

export interface Today {
  day: string;
  start: number;
  pv: number | null;
  load: number | null;
  imp: number | null;
  feed: number | null;
  soc: { low: number; high: number } | null;
  night: number | null;
}

/** A week sum and over how many of the seven days it runs. */
export interface Total {
  value: number;
  n: number;
}

export interface Flows {
  /** Days covered (all meters needed had a value). */
  n: number;
  /** "meter": battery and direct use from meters; "power": battery summed up from power. */
  source: 'meter' | 'power';
  pv: number;
  feed: number;
  imp: number;
  charged: number;
  discharged: number;
  direct: number;
}

export interface WeekNumbers {
  /** The seven completed days, oldest first. */
  days: Day[];
  pv: (number | null)[];
  load: (number | null)[];
  imp: (number | null)[];
  feed: (number | null)[];
  soc: ({ low: number; high: number } | null)[];
  night: (number | null)[];
  total: { pv: Total | null; imp: Total | null };
  /** Same sums for the seven days before. */
  before: { pv: Total | null; imp: Total | null };
  /** Share of consumption not from the grid, 0–1, over days with both meters. */
  autarky: { share: number; load: number; imp: number; n: number } | null;
  flows: Flows | null;
  /** The running day, apart from the sums. */
  today: Today;
}

const total = (row: (number | null)[]): Total | null => {
  const s = sumComplete(row);
  return s ? { value: s.sums[0]!, n: s.n } : null;
};

function flowsOf(
  data: DemoData,
  days: Day[],
  pv: (number | null)[],
  feed: (number | null)[],
  imp: (number | null)[],
): Flows | null {
  // battery and direct use: meters if the house has them, else battery from power
  const charge = perDay(data, 'battery_charge_energy', days);
  const discharge = perDay(data, 'battery_discharge_energy', days);
  const direct = perDay(data, 'direct_energy', days);
  if (charge.some((x) => x !== null) && discharge.some((x) => x !== null)) {
    const withDirect = direct.some((x) => x !== null);
    const s = withDirect
      ? sumComplete(pv, feed, imp, charge, discharge, direct)
      : sumComplete(pv, feed, imp, charge, discharge);
    if (!s) return null;
    const [p, f, i, c, d] = s.sums as [number, number, number, number, number];
    return {
      n: s.n,
      source: 'meter',
      pv: p,
      feed: f,
      imp: i,
      charged: c,
      discharged: d,
      direct: withDirect ? s.sums[5]! : Math.max(0, p - f - c),
    };
  }
  const bat = data.series.battery_power;
  if (!bat?.samples.length) return null;
  const s = sumComplete(pv, feed, imp);
  if (!s) return null;
  let charged = 0;
  let discharged = 0;
  days.forEach((d, k) => {
    if (pv[k] === null || feed[k] === null || imp[k] === null) return;
    // long ranges arrive thinned to 5-min values; bridge those, not real gaps
    const e = integrateSplit(bat.samples, d.start, d.end, Math.max(bat.stepMs * 2.5, 15 * 60_000));
    charged += e.pos;
    discharged += e.neg;
  });
  const [p, f, i] = s.sums as [number, number, number];
  return {
    n: s.n,
    source: 'power',
    pv: p,
    feed: f,
    imp: i,
    charged,
    discharged,
    direct: Math.max(0, p - f - charged),
  };
}

export function weekNumbers(data: DemoData): WeekNumbers {
  const days = weekDays(data, 7, -1);
  const earlier = weekDays(data, 7, -8);
  const todayDay = weekDays(data, 1)[0]!;
  const pv = perDay(data, 'pv_energy', days);
  const load = perDay(data, 'load_energy', days);
  const imp = perDay(data, 'import_energy', days);
  const feed = perDay(data, 'feed_in_energy', days);

  const both = sumComplete(load, imp);
  const autarky =
    both && both.sums[0]! > 0
      ? {
          share: Math.max(0, 1 - both.sums[1]! / both.sums[0]!),
          load: both.sums[0]!,
          imp: both.sums[1]!,
          n: both.n,
        }
      : null;

  const socSamples = data.series.battery_soc?.samples ?? [];
  const loadSamples = data.series.load_power?.samples ?? [];
  const one = [todayDay];
  return {
    days,
    pv,
    load,
    imp,
    feed,
    soc: rangePerDay(socSamples, days),
    night: nightMean(loadSamples, days),
    total: { pv: total(pv), imp: total(imp) },
    before: {
      pv: total(perDay(data, 'pv_energy', earlier)),
      imp: total(perDay(data, 'import_energy', earlier)),
    },
    autarky,
    flows: flowsOf(data, days, pv, feed, imp),
    today: {
      day: todayDay.day,
      start: todayDay.start,
      pv: perDay(data, 'pv_energy', one)[0]!,
      load: perDay(data, 'load_energy', one)[0]!,
      imp: perDay(data, 'import_energy', one)[0]!,
      feed: perDay(data, 'feed_in_energy', one)[0]!,
      soc: rangePerDay(socSamples, one)[0]!,
      // the night is only complete after 5 o'clock
      night: data.now - todayDay.start >= 5 * 3_600_000 ? nightMean(loadSamples, one)[0]! : null,
    },
  };
}

/**
 * Rooms over the completed days: coolest and warmest value and the time
 * mean (hourly means first, so a sensor that reports often does not weigh
 * more). Every temperature series with a room counts.
 */
export function roomRanges(
  data: DemoData,
  days: Day[],
): { name: string; low: number; high: number; mean: number }[] {
  const from = days[0]?.start ?? data.now;
  const to = days.at(-1)?.end ?? data.now;
  return data.entities
    .filter((e) => e.kind === 'temperature' && e.room && data.series[e.id]?.samples.length)
    .flatMap((e) => {
      const s = data.series[e.id]!.samples.filter((x) => x.t >= from && x.t < to);
      if (!s.length) return [];
      const hours = toGrid(s, from, to, 3_600_000).filter((v): v is number => v !== null);
      if (!hours.length) return [];
      return [
        {
          name: e.name,
          low: Math.min(...s.map((x) => x.v)),
          high: Math.max(...s.map((x) => x.v)),
          mean: hours.reduce((a, b) => a + b, 0) / hours.length,
        },
      ];
    });
}
