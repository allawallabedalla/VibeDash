/**
 * A number with a fixed number of decimals in a locale: a real minus, not a
 * hyphen (Audit05 G5-14), and what rounds to zero has no sign – −0,04 is
 * "0,0", never "−0,0" (Audit05).
 */
export function formatNum(value: number, digits: number, locale: string): string {
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(v)
    .replace('-', '−');
}
