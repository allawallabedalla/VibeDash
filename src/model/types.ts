/**
 * Unified data model. All timestamps are UTC milliseconds; local time is a
 * display concern only (see ANLEITUNG.md section 6).
 */

/**
 * `capacity`: a nominal size (e.g. battery kWh) that should not change.
 * `energy`: an amount per period that is not a meter (e.g. a daily forecast).
 * `precipitation` (mm) and `sunshine` (h): daily weather values.
 */
export type EntityKind =
  | 'power'
  | 'energy_counter'
  | 'energy'
  | 'state_of_charge'
  | 'capacity'
  | 'temperature'
  | 'humidity'
  | 'precipitation'
  | 'sunshine'
  /** someone at home: 2 = active, 1 = quiet (e.g. asleep), 0 = nobody (estimate) */
  | 'occupancy';

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  room?: string;
  /** Device it belongs to (inverter, wallbox …); questions are grouped by it. */
  device?: string;
  unit: string;
  /**
   * false until the person has checked the value against something they know
   * (vendor app, meter). Shown as "being checked" (see RISIKEN.md).
   */
  confirmed?: boolean;
  /** Energy counters: a day above this (in `unit`) is implausible and left out. */
  maxPerDay?: number;
  /**
   * Summed up from power (a derived series with an `integrate` term): no meter
   * reading, misses what happens in a gap; named as such in ⓘ. A balance of
   * meters only is not flagged – it is still from meter readings.
   */
  derived?: boolean;
}

/** One measurement. Order within a series is arrival order, never re-sorted by value. */
export interface Sample {
  t: number;
  v: number;
}

export interface Gap {
  from: number;
  to: number;
}

export interface Series {
  entityId: string;
  source: string;
  /** Nominal sampling step; used to detect gaps. */
  stepMs: number;
  samples: Sample[];
  /**
   * Sensors that report only on change: their last value is written forward
   * (see holdForward). `reports` are the times of the real reports (oldest
   * first, including the last one before the window) and `holdMs` how long a
   * value is held. Gaps, "missing since" and coverage use the reports only.
   */
  held?: { reports: number[]; holdMs: number };
}

export interface Forecast {
  /** Target time. */
  at: number;
  createdAt: number;
  /** Lead time = at - createdAt; fair comparisons need equal lead time. */
  leadMs: number;
  value: number;
  low: number;
  high: number;
}

export interface Rating {
  model: string;
  n: number;
  /** null = not yet assessable ("open"), never a fake 100 %. */
  correctPct: number | null;
  history: number[];
}

/** An approximation always carries its range and sample size. */
export interface Estimate {
  value: number;
  low: number;
  high: number;
  n: number;
}
