/**
 * Judging a model needs enough days: below MIN_JUDGED_DAYS a verdict is
 * shown as "open · n" with the 95 % range instead of good / poor (Audit02 P-06).
 */
/** Fewest judged days for a verdict. */
export const MIN_JUDGED_DAYS = 14;

/** 95 % Wilson interval for a share k of n, in percent. */
export function wilson(k: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 100 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, (c - h) * 100), high: Math.min(100, (c + h) * 100) };
}
