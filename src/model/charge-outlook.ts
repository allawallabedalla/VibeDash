/**
 * "When does the car charge, and will there be enough sun?" (Audit05 I-5): the next
 * 48 hours on one time line – the sun forecast with its 10–90 % fan, the usual house
 * load, the planned charge windows as blocks and the house battery as its own strip.
 * Pure functions; the drawing is ChargeOutlook.svelte.
 */
import type { Sample } from './types';

const HOUR = 3_600_000;

/** Hourly slot starts from the hour of `now` on. */
export function outlookHours(now: number, n = 48): number[] {
  const h0 = Math.floor(now / HOUR) * HOUR;
  return Array.from({ length: n }, (_, i) => h0 + i * HOUR);
}

export interface TimeBlock {
  start: number;
  end: number;
  /** charging power (kW); null = not known */
  kw: number | null;
}

/** A plan's charging power per hour (kW) → touching hours as one block each. */
export function blocksFromHourly(hours: readonly number[], kw: readonly number[]): TimeBlock[] {
  const out: TimeBlock[] = [];
  kw.forEach((v, i) => {
    if (!(v > 0)) return;
    const start = hours[i]!;
    const last = out.at(-1);
    if (last && last.end === start) {
      last.kw = Math.max(last.kw ?? 0, v);
      last.end = start + HOUR;
    } else out.push({ start, end: start + HOUR, kw: v });
  });
  return out;
}

/** Mean charging power of each hour from blocks (kW, time-weighted; unknown power counts as `fallbackKw`). */
export function hourlyFromBlocks(
  hours: readonly number[],
  blocks: readonly TimeBlock[],
  fallbackKw: number,
): number[] {
  return hours.map((h) =>
    blocks.reduce((sum, b) => {
      const overlap = Math.min(b.end, h + HOUR) - Math.max(b.start, h);
      return overlap > 0 ? sum + ((b.kw ?? fallbackKw) * overlap) / HOUR : sum;
    }, 0),
  );
}

/**
 * The usual house load per local hour of the day (kW): the median of that hour over the
 * last `days` days before `now` – the median, so a few hours with the car charging or
 * guests do not lift it. Without the car where its power is known. An hour needs half an
 * hour of readings; an hour of the day without any day is null.
 */
export function usualLoad(
  load: readonly Sample[],
  car: readonly Sample[] | null,
  now: number,
  hourOf: (t: number) => number,
  days = 14,
): { kw: (number | null)[]; n: number } {
  const from = now - days * 24 * HOUR;
  const slots = new Map<
    number,
    { l: number; ln: number; c: number; cn: number; t0: number; t1: number }
  >();
  const add = (list: readonly Sample[], k: 'l' | 'c') => {
    for (const p of list) {
      if (p.t < from || p.t >= now || !Number.isFinite(p.v)) continue;
      const key = Math.floor(p.t / HOUR);
      const s = slots.get(key) ?? { l: 0, ln: 0, c: 0, cn: 0, t0: p.t, t1: p.t };
      s[k] += p.v;
      if (k === 'l') {
        s.ln++;
        s.t0 = Math.min(s.t0, p.t);
        s.t1 = Math.max(s.t1, p.t);
      } else s.cn++;
      slots.set(key, s);
    }
  };
  add(load, 'l');
  if (car) add(car, 'c');
  // half an hour covered counts; a series with one value per hour (or rarer) counts as it is
  const coarse = load.length > 1 && load[1]!.t - load[0]!.t >= HOUR / 2;
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  const dayKeys = new Set<number>();
  for (const [key, s] of slots) {
    if (s.ln === 0 || (!coarse && s.t1 - s.t0 < HOUR / 2)) continue;
    const t = key * HOUR;
    byHour[hourOf(t)]!.push(Math.max(0, (s.l / s.ln - (s.cn ? s.c / s.cn : 0)) / 1000));
    dayKeys.add(Math.floor(t / (24 * HOUR)));
  }
  const median = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
  };
  return { kw: byHour.map((xs) => (xs.length ? median(xs) : null)), n: dayKeys.size };
}

/**
 * The house battery hour by hour (%, n + 1 points: now and the end of each hour) from
 * sun, house load and car: what is left over charges it, what is missing comes out of
 * it, between the discharge limit and full. Power limits and losses are left out (≈).
 * An hour without sun or load forecast ends the path (null from there on).
 */
export function batteryPath(
  socPct: number,
  capKwh: number,
  floorPct: number,
  pv: readonly (number | null)[],
  load: readonly (number | null)[],
  car: readonly number[],
): (number | null)[] {
  const floor = (capKwh * floorPct) / 100;
  let kwh = (capKwh * socPct) / 100;
  const out: (number | null)[] = [socPct];
  let broken = false;
  for (let i = 0; i < pv.length; i++) {
    const p = pv[i];
    const l = load[i];
    if (broken || p === null || p === undefined || l === null || l === undefined) {
      broken = true;
      out.push(null);
      continue;
    }
    const net = p - l - (car[i] ?? 0);
    kwh = net >= 0 ? Math.min(capKwh, kwh + net) : Math.max(Math.min(kwh, floor), kwh + net);
    out.push((100 * kwh) / capKwh);
  }
  return out;
}

export interface DaySum {
  /** local day start */
  day: number;
  /** first hour index of the day inside the window, and the count */
  from: number;
  hours: number;
  sun: { p10: number | null; p50: number | null; p90: number | null };
  car: number;
}

/** Sun (kWh, p10/p50/p90) and planned car energy per local day of the window. */
export function daySums(
  hours: readonly number[],
  pv: {
    p10: readonly (number | null)[];
    p50: readonly (number | null)[];
    p90: readonly (number | null)[];
  },
  car: readonly number[],
  dayOf: (t: number) => number,
): DaySum[] {
  const out: DaySum[] = [];
  const sum = (vals: readonly (number | null)[], a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) {
      const v = vals[i];
      if (v === null || v === undefined) return null;
      s += v;
    }
    return s;
  };
  hours.forEach((h, i) => {
    const d = dayOf(h);
    const last = out.at(-1);
    if (last && last.day === d) last.hours++;
    else out.push({ day: d, from: i, hours: 1, sun: { p10: 0, p50: 0, p90: 0 }, car: 0 });
  });
  for (const d of out) {
    const b = d.from + d.hours;
    d.sun = {
      p10: sum(pv.p10, d.from, b),
      p50: sum(pv.p50, d.from, b),
      p90: sum(pv.p90, d.from, b),
    };
    d.car = car.slice(d.from, b).reduce((a, v) => a + v, 0);
  }
  return out;
}
