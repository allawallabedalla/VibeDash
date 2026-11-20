/**
 * Two years of made-up daily energy for the demo household, so the year
 * chart shows a current and an earlier year. Synthetic, not measured.
 */
import type { DailyRow } from '../model/calendar';
import { addDays, localDateKey, localMidnight } from '../model/time';
import { mulberry32 } from './random';

export type YearKind = 'pv' | 'import' | 'feed';

export function demoDaily(kind: YearKind, now: number, timeZone: string, days = 760): DailyRow[] {
  const rng = mulberry32(kind === 'pv' ? 11 : kind === 'import' ? 12 : 13);
  const today = localMidnight(now, timeZone);
  const out: DailyRow[] = [];
  for (let k = days; k >= 1; k--) {
    const start = addDays(today, -k, timeZone);
    const doy = (new Date(start).getUTCMonth() * 30.4 + new Date(start).getUTCDate()) / 365;
    const summer = Math.max(0, Math.sin(Math.PI * (doy - 0.22) * 1.6)); // 0 in winter, 1 in June
    const cloud = 0.35 + 0.65 * rng();
    const pv = (6 + 52 * summer) * cloud;
    const v =
      kind === 'pv'
        ? pv
        : kind === 'feed'
          ? Math.max(0, pv - 14 - 6 * rng())
          : Math.max(0, 9 * (1 - summer) * (1.2 - cloud) + 1.4 * rng() - 0.7);
    const day = Math.round(v * 10) / 10;
    // made-up data problems for the import meter (like a real one): two days without a
    // value, and three days without readings whose total the meter still counted
    if (kind === 'import' && (k === 40 || k === 41)) out.push([start, null]);
    else if (kind === 'import' && (k === 63 || k === 62)) continue;
    else if (kind === 'import' && k === 61) out.push([start, null, 0.2]);
    else out.push([start, day]);
  }
  return out;
}

/** Made-up days on which the demo import meter was silent for a few hours. */
export function demoHoles(now: number, timeZone: string): string[] {
  const today = localMidnight(now, timeZone);
  return [20, 33].map((k) => localDateKey(addDays(today, -k, timeZone) + 12 * 3_600_000, timeZone));
}
