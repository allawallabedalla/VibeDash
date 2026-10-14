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
