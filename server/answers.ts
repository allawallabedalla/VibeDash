/**
 * Answers to the questions on the overview ("Wurde da etwas neu gestartet?" – yes or no),
 * kept in local/settings.json next to the tab choice, so Mac and phone show the same.
 * An answered question leaves the open list; taking the answer back brings it back.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AnswerValue = 'yes' | 'no';
export interface Answer {
  a: AnswerValue;
  /** when it was answered (ms) */
  at: number;
}
export type Answers = Record<string, Answer>;

/** printable, no control characters; question ids carry device names ("gap-Wechselrichter-…") */
const ID = /^[^\p{Cc}]{1,160}$/u;
/** the oldest answers go first beyond this */
const MAX = 500;

export interface AnswerChange {
  id: string;
  /** null takes the answer back */
  answer: AnswerValue | null;
}

export function cleanChange(raw: unknown): AnswerChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; answer?: unknown };
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null;
  if (r.answer !== 'yes' && r.answer !== 'no' && r.answer !== null) return null;
  return { id: r.id, answer: r.answer };
}

function readAll(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clean(raw: unknown): Answers {
  const out: Answers = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const x = v as { a?: unknown; at?: unknown } | null;
    if (ID.test(id) && x && (x.a === 'yes' || x.a === 'no') && typeof x.at === 'number') {
      out[id] = { a: x.a, at: x.at };
    }
  }
  return out;
}

export function readAnswers(path: string): Answers {
  return clean(readAll(path).answers);
}

/** One change at a time, so two devices answering different questions never undo each other. */
export function writeAnswer(path: string, change: AnswerChange, now = Date.now()): Answers {
  const all = readAll(path);
  const answers = clean(all.answers);
  if (change.answer === null) delete answers[change.id];
  else answers[change.id] = { a: change.answer, at: now };
  const kept = Object.entries(answers)
    .sort((x, y) => y[1].at - x[1].at)
    .slice(0, MAX);
  all.answers = Object.fromEntries(kept);
  mkdirSync(dirname(path), { recursive: true });
  // atomic, like the tabs; the rest of the file stays as it is
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
  return all.answers as Answers;
}
