/** Rows for the look-back table: daily energy from meter readings. */
import type { Row } from '../components/DataTable.svelte';
import { completeDays, type DemoData } from '../demo';
import { localDateKey } from '../model/time';
import { i18n, num, t } from '../i18n/index.svelte';

/** True when the daily consumption is computed from the power (no meter). */
function loadIsDerived(data: DemoData): boolean {
  return data.entities.some((e) => e.id === 'load_energy' && e.derived === true);
}

/** Footnote: where the numbers come from, naming a derived consumption. */
export function reviewNote(data: DemoData): string {
  return loadIsDerived(data) ? t('review.unitDerived') : t('review.unit');
}

export function reviewRows(data: DemoData, count: number): Row[] {
  const byDay = (id: string) => new Map(completeDays(data, id).map((d) => [d.day, d.value]));
  const pv = byDay('pv_energy');
  const load = byDay('load_energy');
  const feed = byDay('feed_in_energy');
  const imp = byDay('import_energy');
  const gapDays = (id: string) =>
    new Set(
      data.issues
        .filter((i) => i.kind === 'gap' && i.entityIds.includes(id))
        .map((i) => localDateKey(i.from, data.timeZone)),
    );
  const loggerGaps = gapDays('pv_power');
  // A consumption summed up from the power misses what happened in a gap.
  const loadGaps = loadIsDerived(data) ? gapDays('load_power') : new Set<string>();
  const fmt = new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  });
  const days = [...pv.keys()].slice(-count).reverse();
  const kwh = (v: number | undefined) => (v === undefined ? '–' : num(v, 1));
  return days.map((day) => {
    const l = load.get(day);
    const i = imp.get(day);
    return {
      id: day,
      cells: {
        day: fmt.format(new Date(`${day}T12:00:00Z`)),
        sun: kwh(pv.get(day)),
        load: kwh(l),
        feed: kwh(feed.get(day)),
        import: kwh(i),
        autarky: l && i !== undefined ? `${num(Math.max(0, 1 - i / l) * 100)} %` : '–',
      },
      note: loadGaps.has(day)
        ? t('review.gapDerived')
        : loggerGaps.has(day)
          ? t('review.loggerGap')
          : undefined,
    };
  });
}
