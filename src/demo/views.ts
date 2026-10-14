/** Views on the demo data that the gallery and later pages share. */
import { dailyFromCounter, estimate, quantile, toGrid, valueAt } from '../model/series';
import { localDateKey } from '../model/time';
import type { Estimate, Sample } from '../model/types';
import type { DemoData } from './generate';

const HOUR = 3_600_000;

export function latest(data: DemoData, id: string): Sample | undefined {
  return valueAt(data.series[id]!.samples, data.now);
}

/** Last 24 h on a fixed grid; missing slots stay null (visible gap). */
export function last24h(data: DemoData, id: string, stepMs = 15 * 60_000): (number | null)[] {
  return toGrid(data.series[id]!.samples, data.now - 24 * HOUR, data.now, stepMs);
}

/** Daily energy per local day from the meter reading. */
export function daily(data: DemoData, counterId: string): { day: string; value: number }[] {
  const max = data.entities.find((e) => e.id === counterId)?.maxPerDay;
  return dailyFromCounter(
    data.series[counterId]!.samples,
    (t) => localDateKey(t, data.timeZone),
    max,
  );
}

/** Complete days only: today is still running and would bias everything low. */
export function completeDays(data: DemoData, counterId: string): { day: string; value: number }[] {
  const today = localDateKey(data.now, data.timeZone);
  return daily(data, counterId).filter((d) => d.day !== today);
}

/** Typical daily value from past complete days: median, 10–90 % range, n. */
export function typicalDay(data: DemoData, counterId: string): Estimate {
  return estimate(completeDays(data, counterId).map((d) => d.value));
}

/**
 * Typical course of a day: for every time slot, the 10–90 % range over past
 * complete days. Only days before today are used, so today is never compared
 * against itself.
 */
export function typicalProfile(
  data: DemoData,
  id: string,
  stepMs = 15 * 60_000,
): { low: (number | null)[]; high: (number | null)[]; n: number } {
  const slots = (24 * HOUR) / stepMs;
  const todayStart = data.now - 24 * HOUR; // same window as last24h
  const perSlot: number[][] = Array.from({ length: slots }, () => []);
  let n = 0;
  for (let d = 1; d < 30; d++) {
    const from = todayStart - d * 24 * HOUR;
    if (from < data.now - 30 * 24 * HOUR) break;
    const grid = toGrid(data.series[id]!.samples, from, from + 24 * HOUR, stepMs);
    grid.forEach((v, i) => v !== null && perSlot[i]!.push(v));
    n++;
  }
  const q = (vals: number[], p: number) => (vals.length ? quantile(vals, p) : null);
  return { low: perSlot.map((v) => q(v, 0.1)), high: perSlot.map((v) => q(v, 0.9)), n };
}
