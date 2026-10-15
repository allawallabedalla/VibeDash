/**
 * What happens next, in one line: how long the car keeps charging (from the
 * plan's blocks) and how long the house battery lasts or needs to be full at
 * the present power. Plain estimates – the line says "≈" and "at this power".
 */
export interface PlanBlock {
  start: number;
  end: number;
  kwh: number | null;
}

export type CarNext =
  | { kind: 'until'; at: number; kwhLeft: number | null }
  | { kind: 'outside' }
  | { kind: 'next'; at: number }
  | null;

/** The car: charging until the end of the current plan block, or when the next one starts (today/tomorrow). */
export function carNext(now: number, running: boolean, blocks: readonly PlanBlock[]): CarNext {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  if (running) {
    const cur = sorted.find((b) => b.start <= now && now < b.end);
    if (!cur) return { kind: 'outside' };
    // touching blocks count as one stretch
    let end = cur.end;
    let kwh = cur.kwh === null ? null : (cur.kwh * (cur.end - now)) / (cur.end - cur.start);
    for (const b of sorted) {
      if (b.start > cur.start && b.start <= end + 60_000) {
        end = Math.max(end, b.end);
        kwh = kwh === null || b.kwh === null ? null : kwh + b.kwh;
      }
    }
    return { kind: 'until', at: end, kwhLeft: kwh };
  }
  const next = sorted.find((b) => b.start > now && b.start - now < 36 * 3_600_000);
  return next ? { kind: 'next', at: next.start } : null;
}

export type BatteryNext = { kind: 'full' | 'empty'; hours: number } | null;

/**
 * The house battery at the present power: hours until full (charging) or
 * until the discharge limit (discharging). Null when idle, without capacity,
 * or when it is already full / at the limit.
 */
export function batteryNext(
  w: number,
  soc: number | null,
  capKwh: number | null,
  minSoc = 5,
): BatteryNext {
  if (soc === null || capKwh === null || capKwh <= 0 || Math.abs(w) < 200) return null;
  if (w > 0) {
    const kwh = ((100 - soc) / 100) * capKwh;
    return kwh > 0.05 ? { kind: 'full', hours: kwh / (w / 1000) } : null;
  }
  const kwh = ((soc - minSoc) / 100) * capKwh;
  return kwh > 0.05 ? { kind: 'empty', hours: kwh / (-w / 1000) } : null;
}

/** "≈ 25 min", "≈ 1 h 20 min", "über 12 h" – rounded to 5 minutes. */
export function duration(hours: number, words: { over: string }): string {
  if (hours > 12) return `${words.over} 12 h`;
  const m = Math.max(5, Math.round((hours * 60) / 5) * 5);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `≈ ${h ? `${h} h` : ''}${h && r ? ' ' : ''}${r ? `${r} min` : ''}`;
}
