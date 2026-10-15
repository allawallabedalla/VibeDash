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
  | (Base & { type: 'text'; text: string })
  | (Base & BoardPlan);

/**
 * A floor plan with live values per room (section type "plan"). Coordinates in
 * plan units (e.g. metres); `box` is the visible area [x0, y0, x1, y1].
 *   floors:   [{ id, name, box, walls: [[[x,y],…],…], rooms: [{ id, name, kind, polygon, label }] }]
 *   views:    [{ id, label, kind, unit, values: { roomId: number|null }, texts?: { roomId: "23,1°" } }]
 *             kind: temp (°C) · humidity (%) · valve (%) · light (1 on / 0 off) · presence (minutes
 *             since the last motion; null = none recently)
 *   details:  { roomId: [{ label, value }] } – shown when a room is tapped
 *   timeline: { start, stepMs, steps, light?: { roomId: [0|1 …] }, presence?: { roomId: [0|1 …] } }
 *             today in steps, for the replay slider
 *   link:     { label, url } – e.g. a 3D view of the house
 */
export type PlanViewKind = 'temp' | 'humidity' | 'valve' | 'light' | 'presence';
export type PlanRoomKind = 'room' | 'outside' | 'void' | 'stairs';
export interface BoardPlan {
  type: 'plan';
  floors: {
    id: string;
    name: string;
    box: [number, number, number, number];
    walls: [number, number][][];
    rooms: {
      id: string;
      name: string;
      kind: PlanRoomKind;
      polygon: [number, number][];
      label: [number, number];
    }[];
  }[];
  views: {
    id: string;
    label: string;
    kind: PlanViewKind;
    unit: string;
    values: Record<string, number | null>;
    texts: Record<string, string>;
  }[];
  details: Record<string, { label: string; value: string }[]>;
  timeline?: {
    start: number;
    stepMs: number;
    steps: number;
    light: Record<string, number[]>;
    presence: Record<string, number[]>;
  };
  link?: { label: string; url: string };
}

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
      case 'plan': {
        const plan = sanitizePlan(s);
        if (plan) sections.push({ ...base, ...plan });
        break;
      }
      case 'text':
        sections.push({ ...base, type: 'text', text: text(s.text, 3000) });
        break;
      default:
        break;
    }
  }
  return { updated: num(raw.updated), sections };
}

const VIEW_KINDS: PlanViewKind[] = ['temp', 'humidity', 'valve', 'light', 'presence'];
const ROOM_KINDS: PlanRoomKind[] = ['room', 'outside', 'void', 'stairs'];
const LIMIT = 10_000;
const coord = (v: unknown): number | null => {
  const n = num(v);
  return n === null || Math.abs(n) > LIMIT ? null : n;
};
const point = (v: unknown): [number, number] | null => {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = coord(v[0]);
  const y = coord(v[1]);
  return x === null || y === null ? null : [x, y];
};
const points = (v: unknown, max: number): [number, number][] =>
  list(v, max)
    .map(point)
    .filter((p): p is [number, number] => p !== null);
const roomMap = <T>(v: unknown, ids: Set<string>, f: (x: unknown) => T): Record<string, T> => {
  if (!isObj(v)) return {};
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) if (ids.has(k)) out[k] = f(x);
  return out;
};

/** Check a floor plan; null when it has no floor with rooms. */
function sanitizePlan(s: O): Omit<BoardPlan, never> | null {
  const floors = list(s.floors, 4)
    .filter(isObj)
    .map((f) => {
      const box = list(f.box, 4).map(coord);
      return {
        id: text(f.id, 30),
        name: text(f.name, 40),
        box: (box.length === 4 &&
        box.every((b) => b !== null) &&
        box[2]! > box[0]! &&
        box[3]! > box[1]!
          ? box
          : [0, 0, 10, 10]) as [number, number, number, number],
        walls: list(f.walls, 400)
          .map((w) => points(w, 200))
          .filter((w) => w.length >= 2),
        rooms: list(f.rooms, 60)
          .filter(isObj)
          .map((r) => ({
            id: text(r.id, 30),
            name: text(r.name, 60),
            kind: ROOM_KINDS.includes(r.kind as PlanRoomKind) ? (r.kind as PlanRoomKind) : 'room',
            polygon: points(r.polygon, 200),
            label: point(r.label) ?? [0, 0],
          }))
          .filter((r) => r.id && r.polygon.length >= 3),
      };
    })
    .filter((f) => f.rooms.length);
  if (!floors.length) return null;
  const ids = new Set(floors.flatMap((f) => f.rooms.map((r) => r.id)));
  const views = list(s.views, 8)
    .filter(isObj)
    .filter((v) => VIEW_KINDS.includes(v.kind as PlanViewKind))
    .map((v) => ({
      id: text(v.id, 20) || text(v.kind, 20),
      label: text(v.label, 30),
      kind: v.kind as PlanViewKind,
      unit: text(v.unit, 8),
      values: roomMap(v.values, ids, num),
      texts: roomMap(v.texts, ids, (x) => text(x, 24)),
    }));
  const details = roomMap(s.details, ids, (x) =>
    list(x, 16)
      .filter(isObj)
      .map((d) => ({ label: text(d.label, 30), value: text(d.value, 60) })),
  );
  const tl = isObj(s.timeline) ? s.timeline : null;
  const steps = tl ? Math.min(200, Math.max(0, Math.round(num(tl.steps) ?? 0))) : 0;
  const series = (v: unknown) =>
    roomMap(v, ids, (x) => list(x, steps).map((y) => (num(y) ? 1 : 0)));
  const timeline =
    tl && steps > 0 && num(tl.start) !== null && (num(tl.stepMs) ?? 0) > 0
      ? {
          start: num(tl.start)!,
          stepMs: num(tl.stepMs)!,
          steps,
          light: series(tl.light),
          presence: series(tl.presence),
        }
      : undefined;
  const lk = isObj(s.link) ? s.link : null;
  const href = lk ? text(lk.url, 300) : '';
  return {
    type: 'plan',
    floors,
    views,
    details,
    ...(timeline ? { timeline } : {}),
    ...(lk && /^https?:\/\/\S+$/.test(href)
      ? { link: { label: text(lk.label, 30), url: href } }
      : {}),
  };
}
