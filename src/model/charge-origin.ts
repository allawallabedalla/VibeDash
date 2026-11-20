/**
 * Where the car's energy came from, day by day (Audit05 I-2): sun, house battery, grid –
 * stacked per day, plus the shares over the whole window. Pure functions, no UI.
 */

/** One local day from the house's records (kWh, null = not known). */
export interface OriginDay {
  day: number;
  sun: number | null;
  battery: number | null;
  grid: number | null;
}

/** One bar: the three parts, or only `open` kWh (charged, origin not known yet). null = no record at all. */
export type StackDay = { sun: number; battery: number; grid: number; open: number } | null;

/**
 * Bars for the given local day starts. A day with all three origins is stacked; a day
 * without origin but with charged kWh (e.g. today, before the house has split it up) is
 * one "open" part; a day without either stays a gap (null), never 0.
 */
export function originStack(
  days: readonly number[],
  origin: readonly OriginDay[],
  charged: readonly (number | null)[],
): StackDay[] {
  const byDay = new Map(origin.map((o) => [o.day, o]));
  return days.map((d, i) => {
    const o = byDay.get(d);
    if (o && o.sun !== null && o.battery !== null && o.grid !== null) {
      return { sun: o.sun, battery: o.battery, grid: o.grid, open: 0 };
    }
    const c = charged[i];
    return c !== null && c !== undefined && c > 0 ? { sun: 0, battery: 0, grid: 0, open: c } : null;
  });
}

export interface OriginShares {
  /** whole percent, adding up to 100 (largest remainder) */
  sun: number;
  battery: number;
  grid: number;
  /** kWh with a known origin */
  kwh: number;
  /** days with a known origin and energy > 0 */
  n: number;
}

/** Shares of sun / battery / grid over the bars with a known origin; null when nothing was charged. */
export function originShares(bars: readonly StackDay[]): OriginShares | null {
  let sun = 0;
  let battery = 0;
  let grid = 0;
  let n = 0;
  for (const b of bars) {
    if (!b) continue;
    const s = b.sun + b.battery + b.grid;
    if (s <= 0) continue;
    sun += b.sun;
    battery += b.battery;
    grid += b.grid;
    n++;
  }
  const kwh = sun + battery + grid;
  if (kwh <= 0) return null;
  const raw = [sun, battery, grid].map((v) => (100 * v) / kwh);
  const pct = raw.map(Math.floor);
  // hand the missing points to the largest remainders, so the three add up to 100
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - pct.reduce((a, v) => a + v, 0);
  for (let k = 0; k < missing; k++) pct[order[k]![1]]!++;
  return { sun: pct[0]!, battery: pct[1]!, grid: pct[2]!, kwh, n };
}
