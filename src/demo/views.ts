/** Views on the demo data that the gallery and later pages share. */
import { dailyFromCounter, estimate, toGrid, valueAt } from '../model/series';
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
  return dailyFromCounter(data.series[counterId]!.samples, (t) => localDateKey(t, data.timeZone));
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
