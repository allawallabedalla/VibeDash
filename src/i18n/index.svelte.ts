import { de, type MessageKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
const messages: Record<Locale, Record<MessageKey, string>> = { de, en };

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'de' || fromUrl === 'en') return fromUrl;
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let current = $state<Locale>(initialLocale());

export const i18n = {
  get locale(): Locale {
    return current;
  },
  set locale(value: Locale) {
    current = value;
    document.documentElement.lang = value;
  },
};

/** Translate a key; `{name}` placeholders are filled from `vars`. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return messages[current][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}

/** Locale-aware number with a fixed number of decimals. */
export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat(current === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Local time of day, e.g. 02:10. */
export function time(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat(current === 'de' ? 'de-DE' : 'en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(t);
}
