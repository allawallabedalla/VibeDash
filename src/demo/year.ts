/**
 * Two years of made-up daily energy for the demo household, so the year
 * chart shows a current and an earlier year. Synthetic, not measured.
 */
import { addDays, localMidnight } from '../model/time';
import { mulberry32 } from './random';

export type YearKind = 'pv' | 'import' | 'feed';

export function demoDaily(
  kind: YearKind,
  now: number,
  timeZone: string,
  days = 760,
): [number, number | null][] {
  const rng = mulberry32(kind === 'pv' ? 11 : kind === 'import' ? 12 : 13);
  const today = localMidnight(now, timeZone);
  const out: [number, number | null][] = [];
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
          : Math.max(0, 9 * (1 - summer) * (1.2 - cloud) + rng());
    out.push([start, Math.round(v * 10) / 10]);
  }
  return out;
}
