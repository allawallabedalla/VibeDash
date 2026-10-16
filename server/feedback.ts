/**
 * Feedback: a small local backlog for VibeDash itself. Every page has a button;
 * what is typed lands here (local/feedback.json next to the mapping, never in
 * the repo) so the dashboard can be improved step by step. Entries can be
 * marked done or dropped again; nothing leaves this machine.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type FeedbackKind = 'idea' | 'bug' | 'question';
export type FeedbackStatus = 'open' | 'done' | 'dropped';
export interface FeedbackEntry {
  id: string;
  at: number;
  page: string;
  kind: FeedbackKind;
  text: string;
  status: FeedbackStatus;
  /** when the status last changed */
  changed?: number;
}

export const KINDS: FeedbackKind[] = ['idea', 'bug', 'question'];
export const STATUSES: FeedbackStatus[] = ['open', 'done', 'dropped'];
const MAX_ENTRIES = 500;

export interface FeedbackStore {
  list: () => FeedbackEntry[];
  add: (e: { page: string; kind: FeedbackKind; text: string }) => FeedbackEntry;
  setStatus: (id: string, status: FeedbackStatus) => FeedbackEntry | null;
}

/** One line of plain text: no control characters, single spaces. */
export function cleanText(v: unknown, max: number): string {
  let out = '';
  for (const ch of String(v ?? '')) {
    const c = ch.codePointAt(0)!;
    out += c < 32 || (c >= 127 && c < 160) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function fileStore(path: string, now: () => number = Date.now): FeedbackStore {
  const read = (): FeedbackEntry[] => {
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      return Array.isArray(raw?.entries) ? (raw.entries as FeedbackEntry[]) : [];
    } catch {
      return [];
    }
  };
  const write = (entries: FeedbackEntry[]) => {
    mkdirSync(dirname(path), { recursive: true });
    // atomic, private: a crash mid-write never leaves half a file
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ entries }, null, 1) + '\n', { mode: 0o600 });
    renameSync(tmp, path);
  };
  return {
    list: read,
    add: (e) => {
      const entries = read();
      const t = now();
      const entry: FeedbackEntry = {
        id: `${t.toString(36)}${Math.floor(Math.random() * 1296)
          .toString(36)
          .padStart(2, '0')}`,
        at: t,
        page: e.page,
        kind: e.kind,
        text: e.text,
        status: 'open',
      };
      entries.push(entry);
      write(entries.slice(-MAX_ENTRIES));
      return entry;
    },
    setStatus: (id, status) => {
      const entries = read();
      const e = entries.find((x) => x.id === id);
      if (!e) return null;
      e.status = status;
      e.changed = now();
      write(entries);
      return e;
    },
  };
}
