/**
 * "Does the battery last until sunrise?" (Audit05 I-4) – a plain estimate from the
 * house's own past nights, no model:
 *
 * - Sun: per past day the first quarter hour in the morning in which the sun carried
 *   the house (sun ≥ house load), and the last one in the evening with sun; median over
 *   up to 14 days. Abends/nachts = from 1 h before that evening time to the morning.
 * - Need: for each past night the energy the house drew beyond the sun over the same
 *   stretch of clock time (now → morning), without the car where its power is known.
 *   Mean ± standard deviation over the nights (n); a night with a gap is left out, and so
 *   is one with more than twice the median need (e.g. the car charged from the battery).
 * - Battery: (charge now − discharge limit) × capacity. The discharge limit is the most
 *   common daily low of the last 30 days (≤ 25 %), else assumed 5 %.
 * - Empty: the mean course of the nights, scaled to mean, mean + sd (early) and mean − sd
 *   (late); after that the grid: need − battery.
 * Losses and power limits of the battery are left out (≈).
 */
import type { Sample } from './types';
import { addDays, localMidnight } from './time';

const Q = 15 * 60_000;
const DAY = 86_400_000;

/** Mean per quarter hour on [from, from + n·Q); null where nothing was measured. */
function quarters(s: readonly Sample[], from: number, n: number): (number | null)[] {
  const sum = new Float64Array(n);
  const cnt = new Uint16Array(n);
  for (const p of s) {
    const i = Math.floor((p.t - from) / Q);
    if (i >= 0 && i < n && Number.isFinite(p.v)) {
      sum[i]! += p.v;
      cnt[i]!++;
    }
  }
  return Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i]! : null));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Discharge limit (%): the most common rounded daily low of the last 30 days, if seen on ≥ 3 days. */
export function socFloor(soc: readonly Sample[], now: number): { pct: number; seen: boolean } {
  const lows = new Map<number, number>();
  for (const p of soc) {
    if (p.t < now - 30 * DAY || p.t > now) continue;
    const d = Math.floor((p.t - now) / DAY);
    lows.set(d, Math.min(lows.get(d) ?? 101, p.v));
  }
  const count = new Map<number, number>();
  for (const v of lows.values()) {
    const r = Math.round(v);
    // 0 is a read error of many inverters (a jump to 0), never the limit
    if (r > 0 && r <= 25) count.set(r, (count.get(r) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const [v, c] of count) if (c >= 3 && (!best || c > best[1])) best = [v, c];
  return best ? { pct: best[0], seen: true } : { pct: 5, seen: false };
}

export type Reach =
  | { kind: 'day'; eveningAt: number; morningAt: number }
  | {
      kind: 'night';
      /** when the sun carries the house again (≈) */
      sunAt: number;
      /** usable battery energy now (kWh) */
      usable: number;
      need: { mean: number; low: number; high: number };
      n: number;
      /** empty at (mean / mean + sd / mean − sd); null = lasts until sunAt */
      emptyAt: number | null;
      emptyEarly: number | null;
      emptyLate: number | null;
      grid: { mean: number; low: number; high: number };
      floor: { pct: number; seen: boolean };
      /** charge now (%) and capacity (kWh) the estimate started from */
      soc: number;
      cap: number;
      /** quarter hours from now: start time and the mean need summed up so far (kWh) */
      from: number;
      cum: number[];
    };

export interface ReachInput {
  now: number;
  tz: string;
  socPct: number;
  capKwh: number;
  load: readonly Sample[];
  pv: readonly Sample[];
  car?: readonly Sample[];
  soc: readonly Sample[];
}

/** null = not enough past days (fewer than 3 usable nights or mornings). */
export function batteryReach(x: ReachInput): Reach | null {
  const { now, tz } = x;
  const days = 14;
  const today = localMidnight(now, tz);
  const start = addDays(today, -days, tz);
  const n = Math.ceil((now - start) / Q);
  const load = quarters(x.load, start, n);
  const pv = quarters(x.pv, start, n);
  const car = x.car ? quarters(x.car, start, n) : null;
  const net = (i: number) => {
    const l = load[i];
    return l === null || l === undefined ? null : l - (car?.[i] ?? 0) - (pv[i] ?? 0);
  };
  // morning and evening of each past day, as offsets from its local midnight
  const mornings: number[] = [];
  const evenings: number[] = [];
  for (let d = 0; d < days; d++) {
    const m0 = addDays(start, d, tz);
    const i0 = Math.round((m0 - start) / Q);
    let morning: number | null = null;
    let evening: number | null = null;
    for (let k = 12; k < 96; k++) {
      const p = pv[i0 + k];
      if (p === null || p === undefined || p < 50) continue;
      const v = net(i0 + k);
      if (morning === null && k < 60 && v !== null && v <= 0) morning = k * Q;
      evening = (k + 1) * Q;
    }
    if (morning !== null) mornings.push(morning);
    if (evening !== null) evenings.push(evening);
  }
  if (mornings.length < 3 || evenings.length < 3) return null;
  const sunOff = median(mornings);
  const eveningAt = today + median(evenings);
  if (now >= today + sunOff && now < eveningAt - 3_600_000)
    return { kind: 'day', eveningAt, morningAt: today + sunOff };

  const sunAt = now < today + sunOff ? today + sunOff : addDays(today, 1, tz) + sunOff;
  const K = Math.max(1, Math.ceil((sunAt - now) / Q));
  // the same stretch of clock time on the past days
  const nights: { sum: number; drain: Float64Array }[] = [];
  const shape = new Float64Array(K);
  for (let d = 1; d <= days; d++) {
    const end = addDays(localMidnight(sunAt, tz), -d, tz) + sunOff;
    const i1 = Math.round((end - start) / Q);
    if (i1 - K < 0 || i1 > n) continue;
    let sum = 0;
    let gaps = 0;
    const drain = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const v = net(i1 - K + k);
      if (v === null) gaps++;
      else drain[k] = Math.max(0, v) / 4000;
      sum += drain[k]!;
    }
    if (gaps <= K * 0.1) nights.push({ sum, drain });
  }
  // a night far above the usual (car charged, guests …) would blow up the spread
  const typical = nights.length ? median(nights.map((x) => x.sum)) : 0;
  const needs: number[] = [];
  for (const nt of nights) {
    if (nt.sum > 2 * typical + 0.5) continue;
    needs.push(nt.sum);
    for (let k = 0; k < K; k++) shape[k]! += nt.drain[k]!;
  }
  if (needs.length < 3) return null;
  const mean = needs.reduce((a, v) => a + v, 0) / needs.length;
  const sd = Math.sqrt(needs.reduce((a, v) => a + (v - mean) ** 2, 0) / (needs.length - 1));
  const cum: number[] = [];
  let acc = 0;
  for (let k = 0; k < K; k++) cum.push((acc += shape[k]! / needs.length));
  const floor = socFloor(x.soc, now);
  const usable = Math.max(0, ((x.socPct - floor.pct) / 100) * x.capKwh);
  const emptyFor = (need: number): number | null => {
    if (need <= usable || mean <= 0) return null;
    const f = need / mean;
    const k = cum.findIndex((c) => c * f >= usable);
    return k < 0 ? null : now + (k + 1) * Q;
  };
  const low = Math.max(0, mean - sd);
  const high = mean + sd;
  return {
    kind: 'night',
    sunAt,
    usable,
    need: { mean, low, high },
    n: needs.length,
    emptyAt: emptyFor(mean),
    emptyEarly: emptyFor(high),
    emptyLate: emptyFor(low),
    grid: {
      mean: Math.max(0, mean - usable),
      low: Math.max(0, low - usable),
      high: Math.max(0, high - usable),
    },
    floor,
    soc: x.socPct,
    cap: x.capKwh,
    from: now,
    cum,
  };
}
