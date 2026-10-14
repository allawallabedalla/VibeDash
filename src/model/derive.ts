/**
 * Derived energy counters, for houses without a meter for something (e.g. the
 * house load). A meter reading is always better; a derived counter must be
 * named as such in the explanation (ⓘ).
 *
 * - `integrate`: power over time. Only between two samples at most 2.5 steps
 *   apart; a longer silence is a gap and adds nothing (never interpolated).
 * - `counter`: the increase of another meter (read errors dropped, a reset
 *   counts 0).
 *
 * The result is a cumulative reading in kWh on a fixed grid, starting at 0 at
 * `from`. Only differences carry meaning (daily values), not the level.
 */
import { dropCounterGlitches } from './series';
import type { Sample, Series } from './types';

export interface DeriveTerm {
  how: 'integrate' | 'counter';
  series: Series;
  /** +1 adds, −1 subtracts. */
  sign: 1 | -1;
  /** Factor from the series unit to kW (integrate) or kWh (counter). */
  factor: number;
}

const MS_PER_HOUR = 3_600_000;

export function deriveCounter(
  terms: readonly DeriveTerm[],
  from: number,
  to: number,
  stepMs: number,
): Sample[] {
  const n = Math.ceil((to - from) / stepMs);
  if (n <= 0) return [];
  const inc = new Float64Array(n);
  // slot k ends at from + (k + 1) · step; a sample exactly at the end belongs to it
  const slot = (t: number) => Math.min(n - 1, Math.max(0, Math.ceil((t - from) / stepMs) - 1));
  const integrated = terms.some((x) => x.how === 'integrate');
  // With a power term, a slot counts only if every power term covers it.
  const covered = new Uint8Array(n).fill(integrated ? 1 : 0);

  for (const term of terms) {
    const s =
      term.how === 'counter' ? dropCounterGlitches(term.series.samples) : term.series.samples;
    if (term.how === 'integrate') {
      const maxGap = term.series.stepMs * 2.5;
      const seen = new Uint8Array(n);
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]!;
        const b = s[i]!;
        if (b.t <= from || b.t > to || b.t - a.t > maxGap || b.t <= a.t) continue;
        const start = Math.max(a.t, from);
        const k = slot(b.t);
        inc[k]! += (term.sign * a.v * term.factor * (b.t - start)) / MS_PER_HOUR;
        seen[k] = 1;
      }
      for (let k = 0; k < n; k++) if (!seen[k]) covered[k] = 0;
    } else {
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]!;
        const b = s[i]!;
        if (b.t <= from || b.t > to) continue;
        const k = slot(b.t);
        inc[k]! += term.sign * Math.max(b.v - a.v, 0) * term.factor;
        if (!integrated) covered[k] = 1;
      }
    }
  }

  const out: Sample[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    sum += inc[k]!;
    if (covered[k]) out.push({ t: Math.min(from + (k + 1) * stepMs, to), v: sum });
  }
  return out;
}
