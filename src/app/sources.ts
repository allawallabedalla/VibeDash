/**
 * Where the consumption comes from at one moment (sun, battery, grid) – only the
 * "now" page and the gallery need it, so it is not part of the first page.
 */
import type { DemoData } from '../demo/generate';
import { balanceW } from '../model/balance';
import { freshFor, valueAt } from '../model/series';

/**
 * Where the house's power comes from at time t: sun, battery, grid (W).
 * Returns null if a sensor was silent at t: a gap is not "unchanged".
 */
export function sourcesAt(
  data: DemoData,
  t: number,
): { sun: number; battery: number; grid: number; total: number } | null {
  const at = (id: string): number | null => {
    const series = data.series[id]!;
    const s = valueAt(series.samples, t);
    return s && t - s.t <= freshFor(series.stepMs) ? s.v : null;
  };
  const pv = at('pv_power');
  const bat = at('battery_power');
  // consumption incl. conversion losses (balance), else the house load (Audit04 EN-02)
  const load = balanceW(pv, bat, data.series.grid_power && at('grid_power')) ?? at('load_power');
  if (load === null || pv === null || bat === null) return null;
  const sun = Math.min(pv, load);
  const battery = Math.min(Math.max(-bat, 0), load - sun);
  const grid = Math.max(load - sun - battery, 0);
  return { sun, battery, grid, total: load };
}
