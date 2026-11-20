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
/** Time of the first and the last slot of last24h (slot middles), for a time axis. */
export function last24hSpan(data: DemoData, stepMs = 15 * 60_000): { from: number; to: number } {
  const from = data.now - 24 * HOUR;
  const n = Math.floor((24 * HOUR) / stepMs);
  return { from: from + stepMs / 2, to: from + (n - 1) * stepMs + stepMs / 2 };
}

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
