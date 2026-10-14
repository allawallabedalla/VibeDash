/**
 * Unified data model. All timestamps are UTC milliseconds; local time is a
 * display concern only (see ANLEITUNG.md section 6).
 */

export type EntityKind =
  'power' | 'energy_counter' | 'state_of_charge' | 'temperature' | 'humidity';

export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  room?: string;
  unit: string;
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
