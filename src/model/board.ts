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
 *           "sparkFrom": ms, "sparkTo": ms,   // optional: time of the first / last spark value
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
 *     { "type": "text", "title": "…", "text": "…" },
 *     { "type": "calc", "title": "…", "label": "…", "min": 960, "max": 1425, "step": 15,
 *       "value": 960, "format": "clock", "days": 7, "button": "…" }
 *   ]
 * }
 * "calc" (only if the board has a calcUrl in the mapping): a slider and a button. The
 * button sends the slider value to POST /api/board/<id>/calc; the house service answers
 * { "sections": [ … ] } with ordinary sections (no "calc"), shown right below. Only a
 * calculation – it must not change anything. format "clock": minutes from today 0:00
 * (local), from 1440 on tomorrow; "number": the value itself with "unit". With "days"
 * (clock only, 2–7): weekday buttons side by side, today first and chosen; the slider is
 * the time of day (today from "min", other days from 0:00 up to "max" < 1440) and the
 * value sent is day × 1440 + minutes.
 * "choice" (only if the board takes actions): a few options side by side, one chosen –
 *   { "type": "choice", "title": "…", "id": "<kind>:<key>", "selected": "a",
 *     "options": [ { "value": "a", "label": "…", "sub": "…" }, … ] } (2–5 options, value a-z0-9_-).
 *   A tap sends POST /api/board/<id>/action { item: id, action: "choose", value }; the service
 *   stores the choice and shows it on the next load. A setting for the house's own logic (e.g. how
 *   cautious a charge plan is) – never a direct switch.
 * "chargetimeline": charge windows to try on the house's weather cases (shown only, switches nothing) –
 *   { "type": "chargetimeline", "title": "…", "days": [ { "label": "Heute", "startStep": 35, "startKwh": 4.8,
 *     "pv": [[96 kW values] × cases], "load": [[96] × cases] } ], "battery": { "kwh", "reserveKwh", "eta", "kw" },
 *     "carNeedKwh": 30, "powers": [4.3, 7.1, 11.4] } – 15-minute steps from 0:00, at most 2 days and 40 cases.
 * Every section may carry "note" (one line under it) and "info" ({ what, source } behind ⓘ), and
 * "slot": "top" | "plan" – where a page that embeds the board (the charging page, mapping
 * boards[].onPage) puts it: above its own content, after its plan; without slot at the end.
 */
export type BoardColor =
  'sun' | 'battery' | 'home' | 'grid' | 'import' | 'feed' | 'climate' | 'muted';
export type BoardState = 'ok' | 'look' | 'act' | 'open';

/** An item the user can act on: "<kind>:<key>", chosen by the house service. */
export const ITEM_ID = /^[a-z]{1,16}:[A-Za-z0-9_.-]{1,64}$/;
export type ItemAction = 'done' | 'ack' | 'comment' | 'delete' | 'undo' | 'snooze';
export const ITEM_ACTIONS: ItemAction[] = ['done', 'ack', 'comment', 'delete', 'undo', 'snooze'];
export interface BoardListItem {
  text: string;
  meta?: string;
  state?: BoardState;
  /** with id and actions the item gets buttons (only if the board takes actions) */
  id?: string;
  actions?: ItemAction[];
  /** when it was marked done ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM") / acknowledged (date) */
  done?: string;
  acked?: string;
  /** put off until this date (YYYY-MM-DD) with "later" */
  snoozed?: string;
  comments?: { text: string; at: string }[];
}

export interface BoardInfo {
  what: string;
  source: string;
}
interface Base {
  title: string;
  note?: string;
  info?: BoardInfo;
  slot?: 'top' | 'plan';
}
export interface SeriesLine {
  label: string;
  values: (number | null)[];
  color: BoardColor;
  dashed: boolean;
}
/**
 * Sections with the same "group" share one time-span switch (shown above the
 * first of them); each brings its own "ranges" with matching ids.
 */
interface Grouped {
  group?: string;
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
  /** time (ms) of the first and the last spark value: the enlarged tile shows a time axis */
  sparkFrom?: number;
  sparkTo?: number;
  color?: BoardColor;
  info?: BoardInfo;
}
export type BoardSection =
  | (Base & { type: 'tiles'; tiles: BoardTile[] })
  | (Base &
      Grouped & {
        type: 'series';
        unit: string;
        x: number[];
        lines: SeriesLine[];
        /** the same chart for other time spans; a switch above the group picks one */
        ranges?: { id: string; label: string; x: number[]; lines: SeriesLine[] }[];
      })
  | (Base &
      Grouped & {
        type: 'bars';
        unit: string;
        labels: string[];
        values: (number | null)[];
        color: BoardColor;
        ranges?: { id: string; label: string; labels: string[]; values: (number | null)[] }[];
      })
  | (Base & {
      type: 'table';
      columns: { key: string; label: string; align?: 'right' }[];
      rows: { cells: Record<string, string>; state?: BoardState }[];
    })
  | (Base & { type: 'list'; items: BoardListItem[] })
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
  | (Base & BoardCalc)
  | (Base & BoardChoice)
  | (Base & BoardChargeTimeline)
  | (Base & BoardPlan);

export interface BoardChargeTimeline {
  type: 'chargetimeline';
  days: { label: string; startStep: number; startKwh: number; pv: number[][]; load: number[][] }[];
  battery: { kwh: number; reserveKwh: number; eta: number; kw: number };
  carNeedKwh: number;
  powers: number[];
}

export interface BoardChoice {
  type: 'choice';
  /** item id the choice is sent with ("<kind>:<key>") */
  id: string;
  /** disabled: shown but not selectable (e.g. the automatic while it is still locked) */
  options: { value: string; label: string; sub?: string; disabled?: boolean }[];
  selected: string | null;
}

export interface BoardCalc {
  type: 'calc';
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: 'clock' | 'number';
  unit?: string;
  /** weekday buttons (today first), see above */
  days?: number;
  button: string;
}

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
  /**
   * Optional solid model for a 3D view, same coordinates as the plan, z in
   * metres up: per floor the wall mass (outline minus the rooms), its base
   * and height; roof faces (polygons of [x, y, z]); stairs; extra blocks
   * (e.g. a barn). Floors are matched to the plan's floors by id.
   */
  model3d?: {
    floors: { id: string; base: number; height: number; walls: Solid[] }[];
    roof: [number, number, number][][];
    stairs: {
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      base: number;
      height: number;
      steps: number;
    }[];
    blocks: { base: number; height: number; walls: Solid[] }[];
  };
}
export interface Solid {
  outer: [number, number][];
  holes: [number, number][][];
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
/** "group": a short name shared by sections that switch their time span together. */
const grouped = (s: O): { group?: string } =>
  typeof s.group === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(s.group) ? { group: s.group } : {};
/** up to 4 time spans, each with an id, a short label and its own data */
function ranged<T>(s: O, one: (r: O) => T | null): ({ id: string; label: string } & T)[] {
  const out: ({ id: string; label: string } & T)[] = [];
  for (const r of list(s.ranges, 4)) {
    if (!isObj(r) || typeof r.id !== 'string' || !/^[a-z0-9_-]{1,16}$/.test(r.id)) continue;
    if (out.some((o) => o.id === r.id)) continue;
    const d = one(r);
    if (d) out.push({ id: r.id, label: text(r.label, 16) || r.id, ...d });
  }
  return out;
}
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
      ...(s.slot === 'top' || s.slot === 'plan' ? { slot: s.slot as 'top' | 'plan' } : {}),
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
              ...(num(t.sparkFrom) !== null &&
              num(t.sparkTo) !== null &&
              num(t.sparkTo)! > num(t.sparkFrom)!
                ? { sparkFrom: num(t.sparkFrom)!, sparkTo: num(t.sparkTo)! }
                : {}),
              ...(t.color ? { color: color(t.color) } : {}),
              ...(info(t.info) ? { info: info(t.info) } : {}),
            })),
        });
        break;
      case 'series': {
        const one = (raw: O) => {
          const x = list(raw.x, 2000).map(num);
          if (x.some((v) => v === null)) return null;
          return {
            x: x as number[],
            lines: list(raw.lines, 6)
              .filter(isObj)
              .map((l, i) => ({
                label: text(l.label, 40),
                values: list(l.values, x.length).map(num),
                color: color(l.color, i === 0 ? 'sun' : 'muted'),
                dashed: l.dashed === true,
              })),
          };
        };
        const main = one(s);
        if (!main) break;
        const ranges = ranged(s, (r) => one(r));
        sections.push({
          ...base,
          ...grouped(s),
          type: 'series',
          unit: text(s.unit, 12),
          ...main,
          ...(ranges.length ? { ranges } : {}),
        });
        break;
      }
      case 'bars': {
        const one = (raw: O) => {
          const labels = list(raw.labels, 60).map((l) => text(l, 12));
          return { labels, values: list(raw.values, labels.length).map(num) };
        };
        const ranges = ranged(s, (r) => one(r));
        sections.push({
          ...base,
          ...grouped(s),
          type: 'bars',
          unit: text(s.unit, 12),
          ...one(s),
          color: color(s.color, 'home'),
          ...(ranges.length ? { ranges } : {}),
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
            .map((it) => {
              const id = typeof it.id === 'string' && ITEM_ID.test(it.id) ? it.id : null;
              const actions = id
                ? list(it.actions, 5).filter((a): a is ItemAction =>
                    ITEM_ACTIONS.includes(a as ItemAction),
                  )
                : [];
              const day = (v: unknown) =>
                typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
              const stamp = (v: unknown) =>
                typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(v) ? v : null;
              const comments = list(it.comments, 5)
                .filter(isObj)
                .map((c) => ({ text: text(c.text, 500), at: text(c.at, 20) }))
                .filter((c) => c.text);
              return {
                text: text(it.text, 400),
                ...(opt(it.meta, 80) ? { meta: opt(it.meta, 80) } : {}),
                ...(state(it.state) ? { state: state(it.state) } : {}),
                ...(id && actions.length ? { id, actions: [...new Set(actions)] } : {}),
                ...(stamp(it.done) ? { done: stamp(it.done)! } : {}),
                ...(day(it.acked) ? { acked: day(it.acked)! } : {}),
                ...(day(it.snoozed) ? { snoozed: day(it.snoozed)! } : {}),
                ...(comments.length ? { comments } : {}),
              };
            }),
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
      case 'calc': {
        const c = sanitizeCalc(s);
        if (c) sections.push({ ...base, ...c });
        break;
      }
      case 'chargetimeline': {
        const c = sanitizeTimeline(s);
        if (c) sections.push({ ...base, ...c });
        break;
      }
      case 'choice': {
        const c = sanitizeChoice(s);
        if (c) sections.push({ ...base, ...c });
        break;
      }
      default:
        break;
    }
  }
  return { updated: num(raw.updated), sections };
}

const CALC_LIMIT = 1_000_000;
/** Check a calculator (slider + button); null without a sensible range. */
function sanitizeCalc(s: O): BoardCalc | null {
  const min = num(s.min);
  const max = num(s.max);
  const step = num(s.step) ?? 1;
  if (min === null || max === null || max <= min || step <= 0) return null;
  if (Math.abs(min) > CALC_LIMIT || Math.abs(max) > CALC_LIMIT || (max - min) / step > 2000)
    return null;
  const v = num(s.value) ?? min;
  const d = num(s.days);
  const days =
    s.format === 'clock' && d !== null && d >= 2 && max < 1440 && min >= 0
      ? Math.min(7, Math.round(d))
      : null;
  return {
    type: 'calc',
    label: text(s.label, 40),
    min,
    max,
    step,
    value: Math.min(max, Math.max(min, v)),
    format: s.format === 'clock' ? 'clock' : 'number',
    ...(opt(s.unit, 12) ? { unit: opt(s.unit, 12) } : {}),
    ...(days ? { days } : {}),
    button: text(s.button, 20) || 'OK',
  };
}

const kwRow = (r: unknown): number[] | null =>
  Array.isArray(r) && r.length === 96 && r.every((v) => typeof v === 'number' && v >= 0 && v <= 200)
    ? (r as number[])
    : null;
/** Check a charge timeline: up to 2 days, 2–40 cases of 96 steps each, sane battery numbers. */
function sanitizeTimeline(s: O): BoardChargeTimeline | null {
  const b = s.battery as O | undefined;
  const kwh = num(b?.kwh);
  const reserve = num(b?.reserveKwh);
  const eta = num(b?.eta);
  const kw = num(b?.kw);
  if (!b || !kwh || kwh <= 0 || kwh > 500 || reserve === null || reserve < 0 || reserve >= kwh)
    return null;
  if (!eta || eta <= 0.5 || eta > 1 || !kw || kw <= 0 || kw > 200) return null;
  if (!Array.isArray(s.days)) return null;
  const days: BoardChargeTimeline['days'] = [];
  for (const d of s.days.slice(0, 2)) {
    if (!d || typeof d !== 'object') continue;
    const x = d as O;
    if (!Array.isArray(x.pv) || !Array.isArray(x.load) || x.pv.length !== x.load.length) continue;
    if (x.pv.length < 2 || x.pv.length > 40) continue;
    const pv = x.pv.map(kwRow);
    const load = x.load.map(kwRow);
    if (pv.some((r) => !r) || load.some((r) => !r)) continue;
    const st = Math.round(num(x.startStep) ?? 0);
    const sk = num(x.startKwh);
    days.push({
      label: text(x.label, 16),
      startStep: Math.max(0, Math.min(95, st)),
      startKwh: sk === null ? reserve : Math.max(0, Math.min(kwh, sk)),
      pv: pv as number[][],
      load: load as number[][],
    });
  }
  if (!days.length) return null;
  const need = num(s.carNeedKwh);
  const powers = Array.isArray(s.powers)
    ? s.powers.filter((p): p is number => typeof p === 'number' && p > 0 && p <= 50).slice(0, 4)
    : [];
  return {
    type: 'chargetimeline',
    days,
    battery: { kwh, reserveKwh: reserve, eta, kw },
    carNeedKwh: need && need > 0 && need <= 200 ? need : 40,
    powers: powers.length ? powers : [3.7, 7.4, 11],
  };
}

const CHOICE_VALUE = /^[a-z0-9_-]{1,32}$/;
/** Check a choice (2–5 options with unique values); null otherwise. */
function sanitizeChoice(s: O): BoardChoice | null {
  const id = typeof s.id === 'string' && ITEM_ID.test(s.id) ? s.id : null;
  if (!id || !Array.isArray(s.options)) return null;
  const options: BoardChoice['options'] = [];
  for (const o of s.options.slice(0, 5)) {
    if (!o || typeof o !== 'object') continue;
    const x = o as O;
    const value = typeof x.value === 'string' && CHOICE_VALUE.test(x.value) ? x.value : null;
    if (!value || options.some((y) => y.value === value)) continue;
    const sub = opt(x.sub, 80);
    options.push({
      value,
      label: text(x.label, 24) || value,
      ...(sub ? { sub } : {}),
      ...(x.disabled === true ? { disabled: true } : {}),
    });
  }
  if (options.length < 2) return null;
  const sel = typeof s.selected === 'string' ? s.selected : null;
  return {
    type: 'choice',
    id,
    options,
    selected: options.some((o) => o.value === sel) ? sel : null,
  };
}

/** A calculator's answer: ordinary sections, at most 8, no calculator inside. */
export function sanitizeCalcResult(raw: unknown): BoardSection[] | null {
  const b = sanitizeBoard(raw);
  return b
    ? b.sections
        .filter(
          (x) =>
            x.type !== 'calc' &&
            x.type !== 'plan' &&
            x.type !== 'choice' &&
            x.type !== 'chargetimeline',
        )
        .slice(0, 8)
    : null;
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
  const model3d = sanitizeModel3d(s.model3d);
  const lk = isObj(s.link) ? s.link : null;
  const href = lk ? text(lk.url, 300) : '';
  return {
    type: 'plan',
    floors,
    views,
    details,
    ...(timeline ? { timeline } : {}),
    ...(model3d ? { model3d } : {}),
    ...(lk && /^https?:\/\/\S+$/.test(href)
      ? { link: { label: text(lk.label, 30), url: href } }
      : {}),
  };
}

const solids = (v: unknown, max: number): Solid[] =>
  list(v, max)
    .filter(isObj)
    .map((w) => ({
      outer: points(w.outer, 400),
      holes: list(w.holes, 60)
        .map((h) => points(h, 200))
        .filter((h) => h.length >= 3),
    }))
    .filter((w) => w.outer.length >= 3);
const height = (v: unknown, fallback: number) => {
  const n = num(v);
  return n === null || n < 0 || n > 100 ? fallback : n;
};

/** Check an optional 3D model; null when there is no floor with walls. */
function sanitizeModel3d(v: unknown): BoardPlan['model3d'] | null {
  if (!isObj(v)) return null;
  const floors = list(v.floors, 4)
    .filter(isObj)
    .map((f) => ({
      id: text(f.id, 30),
      base: height(f.base, 0),
      height: height(f.height, 2.75),
      walls: solids(f.walls, 20),
    }))
    .filter((f) => f.id && f.walls.length);
  if (!floors.length) return null;
  const roof = list(v.roof, 20)
    .map((face) =>
      list(face, 12)
        .map((p) => {
          if (!Array.isArray(p) || p.length < 3) return null;
          const c = [coord(p[0]), coord(p[1]), coord(p[2])];
          return c.every((x) => x !== null) ? (c as [number, number, number]) : null;
        })
        .filter((p): p is [number, number, number] => p !== null),
    )
    .filter((face) => face.length >= 3);
  const stairs = list(v.stairs, 4)
    .filter(isObj)
    .map((st) => ({
      x0: coord(st.x0) ?? 0,
      x1: coord(st.x1) ?? 0,
      y0: coord(st.y0) ?? 0,
      y1: coord(st.y1) ?? 0,
      base: height(st.base, 0),
      height: height(st.height, 3),
      steps: Math.min(40, Math.max(1, Math.round(num(st.steps) ?? 12))),
    }))
    .filter((st) => st.x1 > st.x0 && st.y1 > st.y0);
  const blocks = list(v.blocks, 6)
    .filter(isObj)
    .map((b) => ({
      base: height(b.base, 0),
      height: height(b.height, 3),
      walls: solids(b.walls, 10),
    }))
    .filter((b) => b.walls.length);
  return { floors, roof, stairs, blocks };
}
