/**
 * Board: a page whose content a house service supplies (mapping.boards), shown
 * with VibeDash's own blocks. The service answers one JSON object in this
 * shape; the server checks and trims it (sanitizeBoard) before the page sees
 * it, so a broken or hostile answer can neither break the page nor inject
 * markup (everything is shown as text).
 *
 * {
 *   "updated": 1792072800000,               // ms, optional
 *   "sections": [
 *     { "type": "tiles", "title": "…", "tiles": [
 *         { "label": "Akku", "value": "92", "unit": "%", "sub": "…", "state": "ok",
 *           "icon": "battery", "approx": false, "spark": [1,2,3], "color": "battery",
 *           "info": { "what": "…", "source": "…" } } ] },
 *     { "type": "series", "title": "…", "unit": "kW", "x": [ms…],
 *       "lines": [ { "label": "…", "values": [1,null,2], "color": "sun", "dashed": false } ] },
 *     { "type": "bars", "title": "…", "unit": "kWh", "labels": ["Mo", …], "values": [1, null, …], "color": "home" },
 *     { "type": "table", "title": "…", "columns": [ { "key": "a", "label": "A", "align": "right" } ],
 *       "rows": [ { "cells": { "a": "1" }, "state": "look" } ] },
 *     { "type": "list", "title": "…", "items": [ { "text": "…", "meta": "…", "state": "act" } ] },
 *     { "type": "accuracy", "title": "…", "models": [ { "label": "…", "pct": 82, "n": 31,
 *         "history": [80, 82], "note": "…", "collecting": { "have": 12, "need": 30 },
 *         "details": [ { "label": "Daten seit", "value": "1.9." } ] } ] },
 *     { "type": "text", "title": "…", "text": "…" }
 *   ]
 * }
 * Every section may carry "note" (one line under it) and "info" ({ what, source } behind ⓘ).
 */
export type BoardColor =
  'sun' | 'battery' | 'home' | 'grid' | 'import' | 'feed' | 'climate' | 'muted';
export type BoardState = 'ok' | 'look' | 'act' | 'open';

export interface BoardInfo {
  what: string;
  source: string;
}
interface Base {
  title: string;
  note?: string;
  info?: BoardInfo;
}
export interface BoardTile {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  state?: BoardState;
  icon?: string;
  approx?: boolean;
  spark?: (number | null)[];
  color?: BoardColor;
  info?: BoardInfo;
}
export type BoardSection =
  | (Base & { type: 'tiles'; tiles: BoardTile[] })
  | (Base & {
      type: 'series';
      unit: string;
      x: number[];
      lines: { label: string; values: (number | null)[]; color: BoardColor; dashed: boolean }[];
    })
  | (Base & {
      type: 'bars';
      unit: string;
      labels: string[];
      values: (number | null)[];
      color: BoardColor;
    })
  | (Base & {
      type: 'table';
      columns: { key: string; label: string; align?: 'right' }[];
      rows: { cells: Record<string, string>; state?: BoardState }[];
    })
  | (Base & { type: 'list'; items: { text: string; meta?: string; state?: BoardState }[] })
  | (Base & {
      type: 'accuracy';
      models: {
        label: string;
        pct: number | null;
        n: number;
        history: (number | null)[];
        note?: string;
        collecting?: { have: number; need: number };
        details?: { label: string; value: string }[];
      }[];
    })
  | (Base & { type: 'text'; text: string });

export interface Board {
  updated: number | null;
  sections: BoardSection[];
}

const COLORS: BoardColor[] = [
  'sun',
  'battery',
  'home',
  'grid',
  'import',
  'feed',
  'climate',
  'muted',
];
const STATES: BoardState[] = ['ok', 'look', 'act', 'open'];

type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);
/** Text only, control characters become spaces, at most `max` characters. */
const text = (v: unknown, max = 200): string =>
  Array.from(typeof v === 'string' || typeof v === 'number' ? String(v) : '', (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? ' ' : ch;
  })
    .join('')
    .slice(0, max);
const opt = (v: unknown, max = 200): string | undefined => {
  const s = text(v, max);
  return s ? s : undefined;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const color = (v: unknown, fallback: BoardColor = 'muted'): BoardColor =>
  COLORS.includes(v as BoardColor) ? (v as BoardColor) : fallback;
const state = (v: unknown): BoardState | undefined =>
  STATES.includes(v as BoardState) ? (v as BoardState) : undefined;
const info = (v: unknown): BoardInfo | undefined =>
  isObj(v) && (v.what || v.source)
    ? { what: text(v.what, 600), source: text(v.source, 600) }
    : undefined;

/** Check and trim a service's answer; null when it is not a board at all. */
export function sanitizeBoard(raw: unknown): Board | null {
  if (!isObj(raw) || !Array.isArray(raw.sections)) return null;
  const sections: BoardSection[] = [];
  for (const s of list(raw.sections, 30)) {
    if (!isObj(s)) continue;
    const base = {
      title: text(s.title, 80),
      ...(opt(s.note, 400) ? { note: opt(s.note, 400) } : {}),
      ...(info(s.info) ? { info: info(s.info) } : {}),
    };
    switch (s.type) {
      case 'tiles':
        sections.push({
          ...base,
          type: 'tiles',
          tiles: list(s.tiles, 12)
            .filter(isObj)
            .map((t) => ({
              label: text(t.label, 40),
              value: text(t.value, 20),
              ...(opt(t.unit, 12) ? { unit: opt(t.unit, 12) } : {}),
              ...(opt(t.sub, 120) ? { sub: opt(t.sub, 120) } : {}),
              ...(state(t.state) ? { state: state(t.state) } : {}),
              ...(opt(t.icon, 20) ? { icon: opt(t.icon, 20) } : {}),
              ...(t.approx === true ? { approx: true } : {}),
              ...(Array.isArray(t.spark) ? { spark: list(t.spark, 300).map(num) } : {}),
              ...(t.color ? { color: color(t.color) } : {}),
              ...(info(t.info) ? { info: info(t.info) } : {}),
            })),
        });
        break;
      case 'series': {
        const x = list(s.x, 2000).map(num);
        if (x.some((v) => v === null)) break;
        sections.push({
          ...base,
          type: 'series',
          unit: text(s.unit, 12),
          x: x as number[],
          lines: list(s.lines, 6)
            .filter(isObj)
            .map((l, i) => ({
              label: text(l.label, 40),
              values: list(l.values, x.length).map(num),
              color: color(l.color, i === 0 ? 'sun' : 'muted'),
              dashed: l.dashed === true,
            })),
        });
        break;
      }
      case 'bars': {
        const labels = list(s.labels, 60).map((l) => text(l, 12));
        sections.push({
          ...base,
          type: 'bars',
          unit: text(s.unit, 12),
          labels,
          values: list(s.values, labels.length).map(num),
          color: color(s.color, 'home'),
        });
        break;
      }
      case 'table': {
        const columns = list(s.columns, 12)
          .filter(isObj)
          .map((c) => ({
            key: text(c.key, 30),
            label: text(c.label, 40),
            ...(c.align === 'right' ? { align: 'right' as const } : {}),
          }))
          .filter((c) => c.key);
        sections.push({
          ...base,
          type: 'table',
          columns,
          rows: list(s.rows, 500)
            .filter(isObj)
            .map((r) => {
              const cells = isObj(r.cells) ? r.cells : {};
              return {
                cells: Object.fromEntries(columns.map((c) => [c.key, text(cells[c.key], 200)])),
                ...(state(r.state) ? { state: state(r.state) } : {}),
              };
            }),
        });
        break;
      }
      case 'list':
        sections.push({
          ...base,
          type: 'list',
          items: list(s.items, 100)
            .filter(isObj)
            .map((it) => ({
              text: text(it.text, 400),
              ...(opt(it.meta, 80) ? { meta: opt(it.meta, 80) } : {}),
              ...(state(it.state) ? { state: state(it.state) } : {}),
            })),
        });
        break;
      case 'accuracy':
        sections.push({
          ...base,
          type: 'accuracy',
          models: list(s.models, 20)
            .filter(isObj)
            .map((m) => {
              const c = isObj(m.collecting) ? m.collecting : null;
              const have = c ? num(c.have) : null;
              const need = c ? num(c.need) : null;
              return {
                label: text(m.label, 60),
                pct: num(m.pct) === null ? null : Math.max(0, Math.min(100, num(m.pct)!)),
                n: Math.max(0, Math.round(num(m.n) ?? 0)),
                history: list(m.history, 120).map(num),
                ...(opt(m.note, 160) ? { note: opt(m.note, 160) } : {}),
                ...(have !== null && need !== null && need > 0
                  ? { collecting: { have, need } }
                  : {}),
                ...(Array.isArray(m.details)
                  ? {
                      details: list(m.details, 12)
                        .filter(isObj)
                        .map((d) => ({ label: text(d.label, 40), value: text(d.value, 80) })),
                    }
                  : {}),
              };
            }),
        });
        break;
      case 'text':
        sections.push({ ...base, type: 'text', text: text(s.text, 3000) });
        break;
      default:
        break;
    }
  }
  return { updated: num(raw.updated), sections };
}
