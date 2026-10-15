/**
 * The sky of a past day read from the PV curve: an ideal (clear-day) curve
 * laid over the actual one.
 *
 * Ideal curve: the three best whole days of the 14 days before (by energy) –
 * they carry the plant's own orientation and shading – each slot carried to
 * the target day by the ratio of clear-sky sunlight (sun position at the
 * location), the highest of the three per slot, lightly smoothed.
 *
 * Reading: clarity = actual energy / ideal energy over daylight;
 * sunshine ≈ slots at ≥ 70 % of ideal; a dip = a slot at ≥ 70 % followed by
 * one below 45 %. clear: clarity ≥ 0.85 with at most one dip · clouds: two or
 * more dips (single thick clouds) · hazy: too low without dips · overcast:
 * clarity below 0.35. Checked on 14 real days against the weather model.
 */
import { toGrid } from './series';
import type { Sample } from './types';

export type Sky = 'clear' | 'clouds' | 'hazy' | 'overcast';

export interface SkyReading {
  sky: Sky;
  /** actual / ideal energy over daylight, 0–~1 */
  clarity: number;
  sunHours: number;
  dips: number;
}

const SLOT = 10 * 60_000;
const RAD = Math.PI / 180;

/** Solar elevation in degrees (simple formula, ±1°). */
export function solarElevation(t: number, lat: number, lon: number): number {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const n = Math.floor((t - start) / 86_400_000);
  const decl = 23.44 * Math.sin((360 / 365) * (n - 81) * RAD);
  const b = (360 / 365) * (n - 81) * RAD;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  const ha = 15 * (hours + lon / 15 + eot / 60 - 12) * RAD;
  const la = lat * RAD;
  const de = decl * RAD;
  return Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(ha)) / RAD;
}

/** Relative clear-sky sunlight on a horizontal surface (Haurwitz-like shape). */
export function clearSky(t: number, lat: number, lon: number): number {
  const z = Math.sin(solarElevation(t, lat, lon) * RAD);
  return z > 0.02 ? z * Math.exp(-0.059 / z) : 0;
}

/**
 * `days`: the target day and the 14 days before, as local day starts
 * (target last). `where`: the location for the sun position; without it
 * the template is taken as it is.
 */
export function readSky(
  pv: readonly Sample[],
  days: number[],
  where: { lat: number; lon: number } | null,
): SkyReading | null {
  const target = days.at(-1)!;
  const n = 144;
  const grid = (start: number) => toGrid(pv, start, start + n * SLOT, SLOT);
  const prev = days.slice(0, -1).map((start) => ({ start, g: grid(start) }));
  const energy = (g: (number | null)[]) => g.reduce<number>((s, v) => s + (v ?? 0), 0);
  const top = prev
    .filter((p) => p.g.filter((v) => v !== null).length > n / 3)
    .sort((a, b) => energy(b.g) - energy(a.g))
    .slice(0, 3);
  if (!top.length) return null;
  const raw = Array.from({ length: n }, (_, i) => {
    const at = target + i * SLOT + SLOT / 2;
    const c = where ? clearSky(at, where.lat, where.lon) : 1;
    let best = 0;
    for (const p of top) {
      const v = p.g[i];
      if (v === null || v === undefined) continue;
      const cp = where ? clearSky(p.start + i * SLOT + SLOT / 2, where.lat, where.lon) : 1;
      if (cp > 0.01) best = Math.max(best, (v * c) / cp);
    }
    return best;
  });
  const ideal = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 1), i + 2).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)]!;
  });
  const peak = Math.max(...ideal);
  if (peak <= 0) return null;
  const day = grid(target);
  const slots = ideal.map((v, i) => i).filter((i) => ideal[i]! >= 0.08 * peak);
  const known = slots.filter((i) => day[i] !== null && day[i] !== undefined);
  if (known.length < 0.8 * slots.length) return null;
  const r = known.map((i) => Math.min(1.3, day[i]! / ideal[i]!));
  const clarity = known.reduce((s, i) => s + day[i]!, 0) / known.reduce((s, i) => s + ideal[i]!, 0);
  const sunHours = (r.filter((x) => x >= 0.7).length * SLOT) / 3_600_000;
  let dips = 0;
  for (let k = 1; k < r.length; k++) if (r[k - 1]! >= 0.7 && r[k]! < 0.45) dips++;
  const sky: Sky =
    clarity < 0.35
      ? 'overcast'
      : clarity >= 0.85 && dips <= 1
        ? 'clear'
        : dips >= 2
          ? 'clouds'
          : 'hazy';
  return { sky, clarity, sunHours, dips };
}
