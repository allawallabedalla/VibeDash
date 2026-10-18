/**
 * A few round time marks for an enlarged chart: full 6 h for a day (midnight
 * shows the weekday), the weekday per day for a week, every 7th day for a
 * month. Daily points get their weekday each. Local time of the house.
 */
export interface Tick {
  t: number;
  label: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function timeTicks(
  from: number,
  to: number,
  timeZone: string,
  opts: { points?: number; locale?: string; hour?: (h: number) => string } = {},
): Tick[] {
  if (!(to > from)) return [];
  const locale = opts.locale ?? 'de-DE';
  const hourText = opts.hour ?? ((h: number) => `${h} Uhr`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
    day: 'numeric',
  });
  const wd = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' });
  const dm = new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'numeric' });
  const weekday = (t: number) => wd.format(t).replace(/\.$/, '');
  const span = to - from;

  // one point per day (week tiles): each point its weekday
  const n = opts.points ?? 0;
  if (n >= 2 && n <= 10 && span / (n - 1) >= 20 * HOUR) {
    return Array.from({ length: n }, (_, i) => {
      const t = from + (span * i) / (n - 1);
      return { t, label: weekday(t) };
    });
  }

  const hourOf = (t: number) => {
    const h = parts.formatToParts(t).find((p) => p.type === 'hour')?.value;
    return Number(h ?? 0);
  };
  const out: Tick[] = [];
  const start = Math.ceil(from / HOUR) * HOUR;
  if (span <= 2.5 * DAY) {
    for (let t = start; t <= to; t += HOUR) {
      const h = hourOf(t);
      if (h % 6 !== 0) continue;
      out.push({ t, label: h === 0 ? weekday(t) : hourText(h) });
    }
    return out;
  }
  const midnights: number[] = [];
  for (let t = start; t <= to; t += HOUR) if (hourOf(t) === 0) midnights.push(t);
  if (span <= 10 * DAY) return midnights.map((t) => ({ t, label: weekday(t) }));
  // a month: every 7th midnight, counted back from the newest
  return midnights
    .filter((_, i) => (midnights.length - 1 - i) % 7 === 0)
    .map((t) => ({ t, label: dm.format(t) }));
}
