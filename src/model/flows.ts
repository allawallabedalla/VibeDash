/**
 * Who feeds whom right now: the house meter's numbers split into flows from
 * the sources (sun, battery discharging, grid import) to the sinks (house,
 * car, battery charging, grid export).
 *
 * Measured are only the totals at each meter; the split between them is
 * derived with the usual order: the sun first covers the house and car, then
 * charges the battery, the rest goes to the grid; battery and grid cover what
 * is left. A meter that lags a little shows up as a small rest, which is
 * dropped rather than invented as a flow.
 */
export type Source = 'sun' | 'battery' | 'grid';
export type Sink = 'house' | 'car' | 'battery' | 'grid';

export interface FlowInput {
  /** W, PV output (≥ 0) */
  pv: number;
  /** W, whole consumption including the car */
  load: number;
  /** W, + charging, − discharging */
  battery: number;
  /** W, + feed-in, − import */
  grid: number;
  /** W, car charging; null when the house has no car data */
  car: number | null;
}

export interface Flow {
  from: Source;
  to: Sink;
  w: number;
}

export interface Flows {
  flows: Flow[];
  /** W per node, for the labels */
  sun: number;
  house: number;
  car: number | null;
  /** + charging, − discharging */
  battery: number;
  /** + feed-in, − import */
  grid: number;
}

/** Below this a flow is noise (meter rounding, standby). */
export const QUIET_W = 50;

export function energyFlows(i: FlowInput): Flows {
  const pos = (v: number) => (Number.isFinite(v) && v > QUIET_W ? v : 0);
  const sun = pos(i.pv);
  const car = i.car === null ? null : Math.min(pos(i.car), pos(i.load));
  const house = Math.max(0, pos(i.load) - (car ?? 0));
  const charge = pos(i.battery);
  const discharge = pos(-i.battery);
  const feed = pos(i.grid);
  const imp = pos(-i.grid);

  // what each source still has, what each sink still needs
  const have: Record<Source, number> = { sun, battery: discharge, grid: imp };
  const need: Record<Sink, number> = { house, car: car ?? 0, battery: charge, grid: feed };
  const flows: Flow[] = [];
  const give = (from: Source, to: Sink) => {
    const w = Math.min(have[from], need[to]);
    if (w <= 0) return;
    have[from] -= w;
    need[to] -= w;
    const f = flows.find((x) => x.from === from && x.to === to);
    if (f) f.w += w;
    else flows.push({ from, to, w });
  };
  // the sun first: house and car (shared by their need), then battery, then grid
  const both = need.house + need.car;
  if (both > 0 && have.sun > 0) {
    const s = Math.min(have.sun, both);
    const toHouse = (s * need.house) / both;
    const toCar = s - toHouse;
    if (toHouse > 0) {
      flows.push({ from: 'sun', to: 'house', w: toHouse });
      need.house -= toHouse;
    }
    if (toCar > 0) {
      flows.push({ from: 'sun', to: 'car', w: toCar });
      need.car -= toCar;
    }
    have.sun -= s;
  }
  give('sun', 'battery');
  give('sun', 'grid');
  // battery, then grid, for what is left of house and car
  for (const from of ['battery', 'grid'] as const) {
    give(from, 'house');
    give(from, 'car');
  }
  // rare: battery charged from the grid, battery fed into the grid
  give('grid', 'battery');
  give('battery', 'grid');

  return {
    flows: flows.filter((f) => f.w >= QUIET_W),
    sun,
    house,
    car,
    battery: charge > 0 ? charge : -discharge,
    grid: feed > 0 ? feed : -imp,
  };
}
