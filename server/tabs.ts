/**
 * Which tabs show, and in which order (BL-272): one list for the whole house, kept in
 * local/settings.json next to the location, so Mac and phone look the same. Hiding a
 * tab only hides it – the module keeps its contents and comes back as it was.
 * The overview always stays.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TabPrefs {
  /** tab ids that are hidden ("week", "b/garten" …) */
  hidden: string[];
  /** tab ids in the order the person chose; tabs not listed follow in their usual order */
  order: string[];
}

const ID = /^(?:[a-z]+|b\/[a-z][a-z0-9_-]{0,31})$/;
const MAX = 60;

/** Only well-formed ids, no duplicates, never the overview among the hidden ones. */
export function cleanPrefs(raw: unknown): TabPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { hidden?: unknown; order?: unknown };
  const list = (v: unknown) =>
    Array.isArray(v) && v.length <= MAX && v.every((x) => typeof x === 'string' && ID.test(x))
      ? [...new Set(v as string[])]
      : null;
  const hidden = list(r.hidden ?? []);
  const order = list(r.order ?? []);
  if (!hidden || !order) return null;
  return { hidden: hidden.filter((x) => x !== 'overview'), order };
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

export function readTabs(path: string): TabPrefs {
  return cleanPrefs(readAll(path).tabs) ?? { hidden: [], order: [] };
}

export function writeTabs(path: string, prefs: TabPrefs): TabPrefs {
  const all = readAll(path);
  all.tabs = prefs;
  mkdirSync(dirname(path), { recursive: true });
  // atomic, like the location (Audit02 B-04); the rest of the file stays as it is
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
  return prefs;
}
