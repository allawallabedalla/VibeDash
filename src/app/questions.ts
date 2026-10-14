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
  text: string;
}

export function questions(data: DemoData, source: 'demo' | 'influx' = 'demo'): Question[] {
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
  const areaOf = (id: string): Question['area'] => {
    const kind = data.entities.find((x) => x.id === id)?.kind;
    return kind === 'temperature' || kind === 'humidity' ? 'climate' : 'energy';
  };
  const out: Question[] = [];
  for (const [i, issue] of data.issues.entries()) {
    const from = time(issue.from, tz);
    const to = time(issue.to, tz);
    const id = issue.entityIds[0]!;
    if (source === 'demo') {
      // Hand-written questions for the known demo oddities.
      if (issue.kind === 'artifact') {
        out.push({ id: `q${i}`, area: 'climate', text: t('q.artifact', { time: from }) });
      } else if (issue.kind === 'gap' && issue.entityIds.includes('pv_power')) {
        out.push({
          id: `q${i}`,
          area: 'energy',
          text: t('q.loggerGap', { date: date(issue.from), from, to }),
        });
      } else if (issue.kind === 'gap') {
        out.push({ id: `q${i}`, area: 'climate', text: t('q.sensorGap', { from, to }) });
      }
      // Same-second messages are handled (arrival order kept) – nothing to ask.
      continue;
    }
    if (issue.kind === 'gap') {
      out.push({
        id: `q${i}`,
        area: areaOf(id),
        text: t('q.gap', { name: nameOf(id), date: date(issue.from), from, to }),
      });
    } else if (issue.kind === 'artifact') {
      out.push({
        id: `q${i}`,
        area: areaOf(id),
        text: t('q.reset', { name: nameOf(id), date: date(issue.from), time: from }),
      });
    }
  }
  return out;
}
