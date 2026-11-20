/**
 * Shared scale of a table's graphic column (Audit05 I-8): every row on the same
 * scale, zero always inside, ends rounded to 1-2-5 steps so the marks read well.
 */
import type { TableChartCell } from './board';

export function chartScale(
  cells: (TableChartCell | undefined)[],
  fixed?: { min?: number; max?: number },
): { lo: number; hi: number } {
  if (fixed?.min !== undefined && fixed.max !== undefined && fixed.max > fixed.min)
    return { lo: Math.min(0, fixed.min), hi: Math.max(0, fixed.max) };
  let lo = 0;
  let hi = 0;
  for (const c of cells) {
    if (!c || c.value === null) continue;
    const e = c.err ?? 0;
    lo = Math.min(lo, c.value - e);
    hi = Math.max(hi, c.value + e);
  }
  if (lo === hi) return { lo: 0, hi: 1 };
  const step = niceStep((hi - lo) / 4);
  return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step };
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw - 1e-12)!;
}

/** Position of a value on the scale, in percent (clamped). */
export function chartPos(v: number, s: { lo: number; hi: number }): number {
  return Math.max(0, Math.min(100, ((v - s.lo) / (s.hi - s.lo)) * 100));
}
