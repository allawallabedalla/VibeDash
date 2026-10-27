/**
 * Data oddities as questions to the person ("data truth before display").
 * Never claimed as a bug: the person knows the house.
 */
import type { DemoData } from '../demo';
import { t, time } from '../i18n/index.svelte';
import { i18n } from '../i18n/index.svelte';

export interface Question {
  id: string;
  area: 'energy' | 'climate';
  /** Device (or entity name) the question is about; the list is grouped by it. */
  group: string;
  text: string;
  /** false: not a yes/no question (it asks for an action elsewhere) */
  answerable?: false;
}

/** More gap clusters than this per device become one summary question. */
const MAX_GAPS_PER_DEVICE = 3;

/** Merges overlapping or touching time windows. */
function clusters<T extends { from: number; to: number }>(
  items: T[],
): { from: number; to: number; items: T[] }[] {
  const out: { from: number; to: number; items: T[] }[] = [];
  for (const x of [...items].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && x.from <= last.to) {
      last.to = Math.max(last.to, x.to);
      last.items.push(x);
    } else out.push({ from: x.from, to: x.to, items: [x] });
  }
  return out;
}

export function questions(data: DemoData, source: 'demo' | 'live' = 'demo'): Question[] {
  const tz = data.timeZone;
  const date = (ms: number) =>
    new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      timeZone: tz,
      day: 'numeric',
      month: 'long',
    }).format(ms);
  const nameOf = (id: string) => {
    const e = data.entities.find((x) => x.id === id);
    return e ? `${e.name}${e.room && e.room !== e.name ? ` (${e.room})` : ''}` : id;
  };
  const groupOf = (id: string) => data.entities.find((x) => x.id === id)?.device ?? nameOf(id);
  const list = (names: string[]) =>
    new Intl.ListFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', { type: 'conjunction' }).format([
      ...new Set(names),
    ]);
  const areaOf = (id: string): Question['area'] => {
    const kind = data.entities.find((x) => x.id === id)?.kind;
    return kind === 'temperature' || kind === 'humidity' ? 'climate' : 'energy';
  };
  // "bis 18:48" alone reads as the same day; a silence past midnight names the day it ended
  const until = (from: number, to: number) =>
    date(to) === date(from) ? time(to, tz) : `${date(to)}, ${time(to, tz)}`;
  const out: Question[] = [];
  for (const [i, issue] of data.issues.entries()) {
    const from = time(issue.from, tz);
    const to = time(issue.to, tz);
    const id = issue.entityIds[0]!;
    if (source === 'demo') {
      // Hand-written questions for the known demo oddities.
      if (issue.kind === 'artifact') {
        out.push({
          id: `q${i}`,
          area: 'climate',
          group: groupOf(id),
          text: t('q.artifact', { time: from }),
        });
      } else if (issue.kind === 'gap' && issue.entityIds.includes('pv_power')) {
        out.push({
          id: `q${i}`,
          area: 'energy',
          group: groupOf(id),
          text: t('q.loggerGap', { date: date(issue.from), from, to }),
        });
      } else if (issue.kind === 'gap') {
        out.push({
          id: `q${i}`,
          area: 'climate',
          group: groupOf(id),
          text: t('q.sensorGap', { from, to }),
        });
      }
      // Same-second messages are handled (arrival order kept) – nothing to ask.
      continue;
    }
    if (issue.kind === 'artifact') {
      out.push({
        id: `reset-${id}-${issue.from}`,
        area: areaOf(id),
        group: groupOf(id),
        text: t('q.reset', { name: nameOf(id), date: date(issue.from), time: from }),
      });
    }
  }

  // Live gaps: per device, silences that overlap are one question ("PV, house and
  // battery reported nothing …"); many silences of one device become one summary.
  if (source === 'live') {
    const byGroup = new Map<string, { from: number; to: number; id: string }[]>();
    for (const issue of data.issues) {
      if (issue.kind !== 'gap') continue;
      const id = issue.entityIds[0]!;
      const g = groupOf(id);
      byGroup.set(g, [...(byGroup.get(g) ?? []), { from: issue.from, to: issue.to, id }]);
    }
    for (const [group, gaps] of byGroup) {
      const cs = clusters(gaps);
      const area = areaOf(gaps[0]!.id);
      const names = (c: (typeof cs)[number]) => list(c.items.map((x) => nameOf(x.id)));
      if (cs.length > MAX_GAPS_PER_DEVICE) {
        const longest = cs.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
        out.push({
          // a new silence asks again
          id: `gaps-${group}-${cs.length}`,
          area,
          group,
          text: t('q.gapRepeat', {
            name: list(gaps.map((x) => nameOf(x.id))),
            n: cs.length,
            since: date(cs[0]!.from),
            date: date(longest.from),
            from: time(longest.from, tz),
            to: until(longest.from, longest.to),
          }),
        });
        continue;
      }
      for (const c of cs) {
        const many = new Set(c.items.map((x) => nameOf(x.id))).size > 1;
        out.push({
          id: `gap-${group}-${c.from}`,
          area,
          group,
          text: t(many ? 'q.gapMany' : 'q.gap', {
            name: names(c),
            date: date(c.from),
            from: time(c.from, tz),
            to: until(c.from, c.to),
          }),
        });
      }
    }
  }
  const unconfirmed = data.entities.filter((e) => e.confirmed === false).length;
  if (source === 'live' && unconfirmed > 0) {
    out.push({
      id: 'unconfirmed',
      area: 'energy',
      group: t('q.groupConfirm'),
      text: unconfirmed === 1 ? t('q.unconfirmedOne') : t('q.unconfirmed', { n: unconfirmed }),
      answerable: false,
    });
  }
  return out;
}

/** Questions grouped by device, in order of first appearance. */
export function groupQuestions(qs: Question[]): { name: string; items: Question[] }[] {
  const m = new Map<string, Question[]>();
  for (const q of qs) m.set(q.group, [...(m.get(q.group) ?? []), q]);
  return [...m.entries()].map(([name, items]) => ({ name, items }));
}
