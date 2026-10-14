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
 * Daily energy from a cumulative meter reading (the source of truth, not an
 * integral of power). Days are cut in local time. The first day in the data
 * has no previous reading and is therefore left out.
 */
export function dailyFromCounter(
  samples: readonly Sample[],
  dayKey: (t: number) => string,
): { day: string; value: number }[] {
  const lastPerDay = new Map<string, number>();
  for (const s of samples) lastPerDay.set(dayKey(s.t), s.v);
  const days = [...lastPerDay.entries()];
  const out: { day: string; value: number }[] = [];
  for (let i = 1; i < days.length; i++) {
    out.push({ day: days[i]![0], value: days[i]![1] - days[i - 1]![1] });
  }
  return out;
}
