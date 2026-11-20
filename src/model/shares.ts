/**
 * Several 100 % bands on ONE kWh scale (Audit05 I-7, finding G5-06): each band
 * is as long as its total, its parts are shares of that total. So the same
 * amount (e.g. 61 kWh battery) is equally long in every band.
 */
import { niceScale } from './origin';

export interface BandPart {
  value: number | null;
}

export interface BandLayout {
  /** sum of the known parts */
  total: number;
  /** band length, 0–1 of the longest band */
  length: number;
  /** per part: share of its band (0–1, null if unknown) and start/width on the common scale (0–1) */
  parts: { share: number | null; start: number; width: number }[];
  /** a part is unknown: the total is a lower bound */
  incomplete: boolean;
}

export function bandLayout(rows: readonly (readonly BandPart[])[]): {
  rows: BandLayout[];
  max: number;
} {
  const totals = rows.map((parts) => parts.reduce((s, p) => s + Math.max(p.value ?? 0, 0), 0));
  const max = Math.max(0, ...totals);
  return {
    max,
    rows: rows.map((parts, k) => {
      const total = totals[k]!;
      let at = 0;
      return {
        total,
        length: max > 0 ? total / max : 0,
        incomplete: parts.some((p) => p.value === null),
        parts: parts.map((p) => {
          const v = p.value === null ? 0 : Math.max(p.value, 0);
          const width = max > 0 ? v / max : 0;
          const out = {
            share: p.value === null ? null : total > 0 ? v / total : 0,
            start: at,
            width,
          };
          at += width;
          return out;
        }),
      };
    }),
  };
}

/** Round shares to whole percent that add up to 100 (largest remainder). */
export function wholePercents(shares: readonly (number | null)[]): (number | null)[] {
  const known = shares
    .map((s, i) => ({ i, v: (s ?? 0) * 100 }))
    .filter((x) => shares[x.i] !== null);
  const sum = known.reduce((s, x) => s + x.v, 0);
  if (!known.length || sum <= 0) return shares.map((s) => (s === null ? null : 0));
  const floors = known.map((x) => ({ ...x, f: Math.floor(x.v), r: x.v - Math.floor(x.v) }));
  let rest = Math.round(sum) - floors.reduce((s, x) => s + x.f, 0);
  for (const x of [...floors].sort((a, b) => b.r - a.r)) {
    if (rest <= 0) break;
    x.f++;
    rest--;
  }
  const out: (number | null)[] = shares.map(() => null);
  for (const x of floors) out[x.i] = x.f;
  return out;
}

/** Marks for the common kWh axis: 0 and 2–4 round steps up to the longest band. */
export function axisMarks(max: number): number[] {
  if (!(max > 0)) return [0];
  const { step } = niceScale(max);
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
