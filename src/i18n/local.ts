/**
 * Texts that belong to one page loaded on demand: kept next to it instead of in de.ts/en.ts, so
 * they never weigh on the first page (budget < 200 KB). Same {name} placeholders as t().
 */
import { i18n } from './index.svelte';

export function localTexts<K extends string>(texts: {
  de: Record<K, string>;
  en: Record<K, string>;
}): (key: K, vars?: Record<string, string | number>) => string {
  return (key, vars = {}) =>
    texts[i18n.locale === 'de' ? 'de' : 'en'][key].replace(/\{(\w+)\}/g, (_, n: string) =>
      String(vars[n] ?? `{${n}}`),
    );
}
