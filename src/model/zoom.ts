/**
 * The enlarged tile (TileZoom): a time window of one or more series, thinned
 * to a drawable number of points, and plain statistics with n – min, max,
 * mean and the last reading in the window. Gaps stay gaps (null).
 */
export interface Sample {
  t: number;
  v: number;
}

export const ZOOM_WINDOWS = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
} as const;
export type ZoomWindow = keyof typeof ZOOM_WINDOWS;

/** Mean per bucket on a fixed grid [from, to); empty buckets are null (a gap, not zero). */
export function buckets(
  samples: readonly Sample[],
  from: number,
  to: number,
  count: number,
): { x: number[]; values: (number | null)[] } {
  const n = Math.max(1, Math.floor(count));
  const step = (to - from) / n;
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  for (const s of samples) {
    if (s.t < from || s.t >= to || !Number.isFinite(s.v)) continue;
    const i = Math.min(n - 1, Math.floor((s.t - from) / step));
    sum[i]! += s.v;
    cnt[i]!++;
  }
  return {
    x: Array.from({ length: n }, (_, i) => Math.round(from + (i + 0.5) * step)),
    values: sum.map((s, i) => (cnt[i] ? s / cnt[i]! : null)),
  };
}

export interface WindowStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  /** time of min / max */
  minAt: number;
  maxAt: number;
  last: Sample;
}

/** Statistics of the readings in [from, to); null without readings. */
export function windowStats(
  samples: readonly Sample[],
  from: number,
  to: number,
): WindowStats | null {
  let n = 0;
  let sum = 0;
  let min: Sample | null = null;
  let max: Sample | null = null;
  let last: Sample | null = null;
  for (const s of samples) {
    if (s.t < from || s.t >= to || !Number.isFinite(s.v)) continue;
    n++;
    sum += s.v;
    if (!min || s.v < min.v) min = s;
    if (!max || s.v > max.v) max = s;
    if (!last || s.t >= last.t) last = s;
  }
  if (!n || !min || !max || !last) return null;
  return { n, min: min.v, max: max.v, mean: sum / n, minAt: min.t, maxAt: max.t, last };
}

/** Readings cover only part of the window (e.g. the series is younger): from when. */
export function coveredFrom(samples: readonly Sample[], from: number): number | null {
  const first = samples.find((s) => s.t >= from && Number.isFinite(s.v));
  return first ? first.t : null;
}
