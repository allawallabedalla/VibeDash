/** Sun tile forecast line (M9): pure functions, no UI state. */
import { dayAheadForecasts, powerCurve, type DemoData } from '../demo';
import { toGrid } from '../model/series';
import { addDays, localMidnight } from '../model/time';

const kw = (w: number | null) => (w === null ? null : w / 1000);

/** PV power forecast in kW at points in time (start of each step), with its band. */
export interface SunForecast {
  at: number[];
  stepMs: number;
  p10: (number | null)[];
  p50: (number | null)[];
  p90: (number | null)[];
}

/** The demo's own day-ahead model for today (made the evening before). */
export function demoSunForecast(data: DemoData): SunForecast | null {
  const today = dayAheadForecasts(data).find((f) => f.day === 'today');
  if (!today) return null;
  const curve = powerCurve(today, data.timeZone);
  return {
    at: curve.map((c) => c.at),
    stepMs: 15 * 60_000,
    p10: curve.map((c) => (c.low ?? c.value) / 1000),
    p50: curve.map((c) => c.value / 1000),
    p90: curve.map((c) => (c.high ?? c.value) / 1000),
  };
}

const SLOT = 15 * 60_000;

/**
 * Today on 15-minute slots: measured until now (solid), the forecast from now on as its
 * own dashed line with band – never glued together.
 */
export function sunToday(data: DemoData, fc: SunForecast) {
  const from = localMidnight(data.now, data.timeZone);
  const to = addDays(from, 1, data.timeZone);
  const n = Math.round((to - from) / SLOT);
  const measured = toGrid(data.series.pv_power?.samples ?? [], from, to, SLOT).map((v, i) =>
    from + (i + 1) * SLOT <= data.now ? kw(v) : null,
  );
  const pick = (vals: (number | null)[]) =>
    Array.from({ length: n }, (_, i) => {
      const t = from + i * SLOT;
      if (t + SLOT <= data.now) return null;
      const k = fc.at.findIndex((a) => t >= a && t < a + fc.stepMs);
      return k < 0 ? null : (vals[k] ?? null);
    });
  return { values: measured, forecast: pick(fc.p50), low: pick(fc.p10), high: pick(fc.p90) };
}
