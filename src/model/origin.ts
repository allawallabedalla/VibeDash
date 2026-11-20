/**
 * Where the house's power came from, slot by slot (Audit05 I-1): the sun first
 * covers the consumption, then the battery, the rest is grid import. Feed-in is
 * kept apart (it is not part of the consumption). Pure functions, no UI state.
 *
 * A slot where one of the meters is unknown stays a gap (null) – never 0 and
 * never "like before" (ANLEITUNG section 6).
 */
import { balanceW } from './balance';

export interface OriginSlots {
  /** kW per slot, null = gap */
  sun: (number | null)[];
  battery: (number | null)[];
  grid: (number | null)[];
  /** consumption incl. conversion losses = sun + battery + grid */
  load: (number | null)[];
  /** feed-in (kW, ≥ 0), shown apart */
  feed: (number | null)[];
}

/**
 * One slot from mean powers (W): pv ≥ 0, battery + charging / − discharging,
 * grid + feed-in / − import. Consumption is the balance of the meters (incl.
 * losses), the house load only if one of them is missing (like sourcesAt).
 */
export function originOf(
  pv: number | null,
  battery: number | null,
  grid: number | null,
  houseLoad: number | null = null,
): { sun: number; battery: number; grid: number; load: number; feed: number } | null {
  const load = balanceW(pv, battery, grid) ?? houseLoad;
  if (load === null || pv === null || battery === null) return null;
  const sun = Math.min(Math.max(pv, 0), load);
  const bat = Math.min(Math.max(-battery, 0), load - sun);
  const imp = Math.max(load - sun - bat, 0);
  const feed = grid === null ? null : Math.max(grid, 0);
  return { sun, battery: bat, grid: imp, load: sun + bat + imp, feed: feed ?? 0 };
}

/** Whole slot rows (W in, kW out). The arrays must have the same length. */
export function originSlots(
  pv: (number | null)[],
  battery: (number | null)[],
  grid: (number | null)[],
  houseLoad: (number | null)[] = [],
): OriginSlots {
  const out: OriginSlots = { sun: [], battery: [], grid: [], load: [], feed: [] };
  pv.forEach((p, i) => {
    const o = originOf(p, battery[i] ?? null, grid[i] ?? null, houseLoad[i] ?? null);
    out.sun.push(o ? o.sun / 1000 : null);
    out.battery.push(o ? o.battery / 1000 : null);
    out.grid.push(o ? o.grid / 1000 : null);
    out.load.push(o ? o.load / 1000 : null);
    out.feed.push(o && grid[i] !== null && grid[i] !== undefined ? o.feed / 1000 : null);
  });
  return out;
}

/** Upper edges of the stacked layers: sun, sun + battery, sun + battery + grid. */
export function stackTops(
  o: OriginSlots,
): [(number | null)[], (number | null)[], (number | null)[]] {
  const s1 = o.sun;
  const s2 = o.sun.map((s, i) => (s === null ? null : s + o.battery[i]!));
  const s3 = s2.map((s, i) => (s === null ? null : s + o.grid[i]!));
  return [s1, s2, s3];
}

/**
 * Energy per source over the known slots (kWh, summed up from power, hence an
 * approximation) and their shares of the consumption; n = slots with values.
 */
export function originTotals(
  o: OriginSlots,
  stepMs: number,
): {
  sun: number;
  battery: number;
  grid: number;
  load: number;
  feed: number;
  share: { sun: number; battery: number; grid: number } | null;
  n: number;
} {
  const h = stepMs / 3_600_000;
  const sum = (v: (number | null)[]) => v.reduce<number>((s, x) => s + (x ?? 0) * h, 0);
  const sun = sum(o.sun);
  const battery = sum(o.battery);
  const grid = sum(o.grid);
  const load = sun + battery + grid;
  return {
    sun,
    battery,
    grid,
    load,
    feed: sum(o.feed),
    share: load > 0 ? { sun: sun / load, battery: battery / load, grid: grid / load } : null,
    n: o.load.filter((v) => v !== null).length,
  };
}

/**
 * The faint part from "now" on: the usual consumption, of it what the sun
 * forecast can cover (never more than the consumption); the rest is battery or
 * grid – which of the two is not forecast here.
 */
export function forecastStack(
  load: (number | null)[],
  sun: (number | null)[] | null,
): { sun: (number | null)[]; load: (number | null)[] } {
  return {
    load,
    sun: load.map((l, i) => {
      const s = sun?.[i] ?? null;
      return l === null || s === null ? null : Math.min(Math.max(s, 0), l);
    }),
  };
}

/** A "nice" upper end and step for a kW axis (1-2-5 steps, 2–4 marks). */
export function niceScale(max: number): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.5 };
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}
