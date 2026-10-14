import type { Estimate, Gap, Sample, Series } from './types';

/** Gaps are stretches where the sensor stayed silent for more than `factor` nominal steps. */
export function findGaps(series: Series, factor = 2.5): Gap[] {
  const gaps: Gap[] = [];
  const s = series.samples;
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]!;
    const cur = s[i]!;
    if (cur.t - prev.t > series.stepMs * factor) gaps.push({ from: prev.t, to: cur.t });
  }
  return gaps;
}

/**
 * Resample onto a fixed grid. Grid slots without a sample stay `null` so that
 * gaps remain visible instead of being drawn as zero or as "unchanged".
 */
export function toGrid(
  samples: readonly Sample[],
  from: number,
  to: number,
  stepMs: number,
): (number | null)[] {
  const n = Math.floor((to - from) / stepMs);
  const sums = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  for (const { t, v } of samples) {
    if (t < from || t >= to) continue;
    const i = Math.floor((t - from) / stepMs);
    sums[i]! += v;
    counts[i]! += 1;
  }
  return sums.map((sum, i) => (counts[i]! > 0 ? sum / counts[i]! : null));
}

/** Last sample at or before `t`. */
export function valueAt(samples: readonly Sample[], t: number): Sample | undefined {
  let found: Sample | undefined;
  for (const s of samples) {
    if (s.t > t) break;
    found = s;
  }
  return found;
}

/** Linear-interpolated quantile of a non-empty list (q in 0..1). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('quantile of empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Median with the 10–90 % range and n. */
export function estimate(values: readonly number[]): Estimate {
  return {
    value: quantile(values, 0.5),
    low: quantile(values, 0.1),
    high: quantile(values, 0.9),
    n: values.length,
  };
}

/** Mean absolute error in percent; signs must not cancel out (+40 % and −40 % ≠ 0). */
export function meanAbsPctError(pairs: readonly { actual: number; predicted: number }[]): number {
  const usable = pairs.filter((p) => p.actual !== 0);
  if (usable.length === 0) return NaN;
  const sum = usable.reduce((acc, p) => acc + Math.abs((p.predicted - p.actual) / p.actual), 0);
  return (sum / usable.length) * 100;
}

/**
 * The value of something that should stay constant (a nominal capacity),
 * robust against read errors: values below `min` are dropped, and a jump of
 * more than `maxJump` (share) from the last valid value is dropped unless the
 * new value holds for `confirm` samples in a row (a real change). Returns the
 * last valid value, or null if there is none.
 */
export function steadyValue(
  samples: readonly Sample[],
  { min, maxJump, confirm = 3 }: { min: number; maxJump: number; confirm?: number },
): number | null {
  let valid: number | null = null;
  let candidate: number | null = null;
  let seen = 0;
  for (const { v } of samples) {
    if (!Number.isFinite(v) || v < min) continue;
    if (valid === null || Math.abs(v - valid) <= maxJump * valid) {
      valid = v;
      candidate = null;
      continue;
    }
    if (candidate !== null && Math.abs(v - candidate) <= maxJump * candidate) seen++;
    else {
      candidate = v;
      seen = 1;
    }
    if (seen >= confirm) {
      valid = v;
      candidate = null;
    }
  }
  return valid;
}

/** How long a meter reading may stay off before it counts as a real reset. */
export const COUNTER_GLITCH_MS = 10 * 60_000;

/**
 * Drops read errors from a cumulative meter reading: a reading that goes
 * down (often to 0) or jumps up and comes back to the previous level within
 * `windowMs` is an outlier, not a reset. A lower reading that stays (more
 * than `windowMs`) is kept: that is a real reset or meter swap.
 */
export function dropCounterGlitches(
  samples: readonly Sample[],
  windowMs = COUNTER_GLITCH_MS,
): Sample[] {
  const out: Sample[] = [];
  let i = 0;
  while (i < samples.length) {
    const cur = samples[i]!;
    const level = out.at(-1)?.v;
    if (level !== undefined && cur.v !== level) {
      // down: back to at least the level; up: back below the jump, not below the level
      const back = (v: number) => (cur.v < level ? v >= level : v >= level && v < cur.v);
      let j = i + 1;
      while (j < samples.length && samples[j]!.t - cur.t <= windowMs && !back(samples[j]!.v)) j++;
      if (j < samples.length && samples[j]!.t - cur.t <= windowMs) {
        i = j; // samples i..j-1 were the outlier
        continue;
      }
    }
    out.push(cur);
    i++;
  }
  return out;
}

/**
 * Daily energy from a cumulative meter reading (the source of truth, not an
 * integral of power). Days are cut in local time. Read errors are dropped
 * first (`dropCounterGlitches`). Each step between two readings counts for the
 * day of the later reading; a step down (meter reset or swap) counts as 0 and
 * shows up in `counterResets` as a question. The first day in the data has no
 * previous reading and is left out. Days above `maxPerDay` are implausible and
 * left out as well (shown as missing, never as a number).
 */
export function dailyFromCounter(
  samples: readonly Sample[],
  dayKey: (t: number) => string,
  maxPerDay = Infinity,
): { day: string; value: number }[] {
  const clean = dropCounterGlitches(samples);
  const perDay = new Map<string, number>();
  let first: string | undefined;
  for (let i = 0; i < clean.length; i++) {
    const cur = clean[i]!;
    const day = dayKey(cur.t);
    if (i === 0) {
      first = day;
      continue;
    }
    const step = cur.v - clean[i - 1]!.v;
    perDay.set(day, (perDay.get(day) ?? 0) + Math.max(step, 0));
  }
  return [...perDay.entries()]
    .filter(([day, value]) => day !== first && value <= maxPerDay)
    .map(([day, value]) => ({ day, value }));
}

/**
 * Places where a cumulative meter reading goes down and stays down (meter
 * swap, reset, overflow; read errors are dropped first). These must not
 * become negative daily energy; they are questions for the person.
 */
export function counterResets(
  samples: readonly Sample[],
): { t: number; from: number; to: number }[] {
  const clean = dropCounterGlitches(samples);
  const out: { t: number; from: number; to: number }[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!;
    const cur = clean[i]!;
    if (cur.v < prev.v) out.push({ t: cur.t, from: prev.v, to: cur.v });
  }
  return out;
}
