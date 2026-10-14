const dateFormats = new Map<string, Intl.DateTimeFormat>();
const hourFormats = new Map<string, Intl.DateTimeFormat>();

function cached(
  map: Map<string, Intl.DateTimeFormat>,
  key: string,
  make: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  let f = map.get(key);
  if (!f) map.set(key, (f = make()));
  return f;
}

/** Local calendar date (YYYY-MM-DD) of a UTC timestamp in the given IANA time zone. */
export function localDateKey(t: number, timeZone: string): string {
  return cached(
    dateFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  ).format(t);
}

/** Local wall-clock hour (0–23, fractional) of a UTC timestamp. */
export function localHour(t: number, timeZone: string): number {
  const parts = cached(
    hourFormats,
    timeZone,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  ).formatToParts(t);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h + m / 60;
}

const HOUR = 3_600_000;

/** UTC ms of local 00:00 on the local date of `t`. Correct across DST switches. */
export function localMidnight(t: number, timeZone: string): number {
  const key = localDateKey(t, timeZone);
  const minute = Math.floor(t / 60_000) * 60_000;
  const guess = minute - Math.round(localHour(minute, timeZone) * 60) * 60_000;
  // On DST days the guess is off by the switch; try nearby candidates.
  for (const c of [guess, guess + HOUR, guess - HOUR, guess + 2 * HOUR, guess - 2 * HOUR]) {
    if (localDateKey(c, timeZone) === key && localDateKey(c - 60_000, timeZone) !== key) return c;
  }
  return guess;
}

/** UTC ms of local 00:00 for a YYYY-MM-DD local date. */
export function dayStart(key: string, timeZone: string): number {
  return localMidnight(Date.parse(`${key}T12:00:00Z`), timeZone);
}

/** Local midnight `n` days after the local midnight `start` (days can be 23 or 25 h). */
export function addDays(start: number, n: number, timeZone: string): number {
  return localMidnight(start + n * 24 * HOUR + 12 * HOUR, timeZone);
}
