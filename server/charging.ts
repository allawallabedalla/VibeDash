/**
 * Car charging from the house's own records (read-only), for houses without
 * evcc: the current charge, past charges and – optionally – the plan of an
 * external charge planner.
 *
 * mapping.charging (all house specifics live there, none in the code):
 *   power:    series id of the car's charging power (W)
 *   maxKw:    end of the power scale, e.g. 11 for 3 × 16 A (no scale without it)
 *   sessions: { measurement, energy, running, duration?, source?, id? } – one
 *             row per start (running = true) and one per end (running =
 *             false, with energy in kWh), both stamped at the start
 *   sources:  { "<raw value>": "auto" | "app" | "card" } – who started a charge
 *   gridMeter: series id of the grid import meter (kWh) – grid energy during
 *             each charge, an upper bound for what the car took from the grid
 *   plan:     { summaryUrl, blocksUrl?, fields?, span? } – an external planner's
 *             summary and blocks; `fields` names its JSON keys (defaults in
 *             PLAN_FIELDS), `span` says what its two day numbers mean (README)
 */
import type { FetchLike } from '../src/adapters/influx1';

export type Starter = 'auto' | 'app' | 'card';

/** JSON keys of the planner's answer. */
export interface PlanFields {
  text: string;
  madeAt: string;
  soc: string;
  socMin: string;
  /** Today, tomorrow …: planned kWh and the two span numbers. */
  days: { kwh: string; low: string; high: string }[];
  blocks: { start: string; end: string; amps: string; kwh: string; reason: string };
}

export const PLAN_FIELDS: PlanFields = {
  text: 'text',
  madeAt: 'madeAt',
  soc: 'soc',
  socMin: 'socMin',
  days: [
    { kwh: 'todayKwh', low: 'todayLow', high: 'todayHigh' },
    { kwh: 'tomorrowKwh', low: 'tomorrowLow', high: 'tomorrowHigh' },
  ],
  blocks: { start: 'start', end: 'end', amps: 'amps', kwh: 'kwh', reason: 'reason' },
};

/**
 * What the two day numbers are: "quantiles" = a 10–90 % range,
 * "cautious-good" = cautious plan (low) and what good weather allows (high).
 */
export type PlanSpan = 'quantiles' | 'cautious-good';

export interface ChargingMapping {
  power?: string;
  maxKw?: number;
  sources?: Record<string, Starter>;
  gridMeter?: string;
  sessions: {
    measurement: string;
    energy: string;
    running: string;
    duration?: string;
    source?: string;
    id?: string;
  };
  plan?: { summaryUrl: string; blocksUrl?: string; fields?: PlanFields; span?: PlanSpan };
}

export interface ChargeSession {
  start: number;
  end: number | null;
  kwh: number | null;
  /** who started it, from mapping.charging.sources; null = unknown */
  source: Starter | null;
  /** grid import during the charge (house included), kWh */
  gridKwh: number | null;
}

export interface ChargingNow {
  running: boolean;
  since: number | null;
  source: Starter | null;
  powerW: number | null;
  powerAt: number | null;
  /** energy of the running charge so far, summed up from power (≈) */
  kwhSoFar: number | null;
}

export interface PlanBlock {
  start: number;
  end: number;
  amps: number | null;
  kwh: number | null;
  reason: string | null;
}

export interface PlanSummary {
  text: string | null;
  madeAt: number | null;
  days: { kwh: number | null; low: number | null; high: number | null }[];
  socNow: number | null;
  socMin: number | null;
  blocks: PlanBlock[];
}

const ident = (n: string) => `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

type Query = (
  q: string,
) => Promise<{ results?: { series?: { columns: string[]; values?: unknown[][] }[] }[] }>;

function rows(res: Awaited<ReturnType<Query>>): Record<string, unknown>[] {
  const s = res.results?.[0]?.series?.[0];
  if (!s) return [];
  return (s.values ?? []).map((v) => Object.fromEntries(s.columns.map((c, i) => [c, v[i]])));
}

/** Charges whose start lies in [from, to), oldest first; a still running one has end = null. */
export async function chargeSessions(
  query: Query,
  m: ChargingMapping,
  from: number,
  to: number,
): Promise<ChargeSession[]> {
  const f = m.sessions;
  const cols = [f.energy, f.running, f.source, f.id, f.duration].filter(Boolean) as string[];
  const res = await query(
    `SELECT ${cols.map(ident).join(', ')} FROM ${ident(f.measurement)} WHERE time >= ${Math.floor(from)}ms AND time < ${Math.floor(to)}ms`,
  );
  const byStart = new Map<string, ChargeSession>();
  for (const r of rows(res)) {
    const t = Number(r.time);
    const key = f.id && r[f.id] != null ? String(r[f.id]) : String(t);
    const s = byStart.get(key) ?? { start: t, end: null, kwh: null, source: null, gridKwh: null };
    s.start = Math.min(s.start, t);
    // the first known source wins; a later unknown one never overwrites it
    const raw = f.source ? r[f.source] : undefined;
    if (
      typeof raw === 'string' &&
      s.source === null &&
      m.sources &&
      Object.hasOwn(m.sources, raw)
    ) {
      s.source = m.sources[raw]!;
    }
    if (r[f.running] === false) {
      // a second end row of the same charge (e.g. a repeated stop) without
      // energy never wipes the first one's energy (Audit02 N-06)
      const kwh = num(r[f.energy]);
      if (kwh !== null || s.kwh === null) {
        const d = f.duration ? num(r[f.duration]) : null;
        if (kwh !== null || s.end === null) s.end = d !== null ? t + d * 60_000 : t;
        if (kwh !== null) s.kwh = kwh;
      }
    }
    byStart.set(key, s);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Validate the external planner's answers into one plain shape. */
export function parsePlan(
  summary: unknown,
  blocks: unknown,
  f: PlanFields = PLAN_FIELDS,
): PlanSummary | null {
  const z = Array.isArray(summary) ? summary[0] : summary;
  if (!z || typeof z !== 'object') return null;
  const o = z as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
  const bl = Array.isArray(blocks) ? blocks : [];
  const k = f.blocks;
  return {
    text: text(o[f.text], 200),
    madeAt: num(o[f.madeAt]),
    days: f.days.map((d) => ({ kwh: num(o[d.kwh]), low: num(o[d.low]), high: num(o[d.high]) })),
    socNow: num(o[f.soc]),
    socMin: num(o[f.socMin]),
    blocks: bl
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .map((b) => ({
        start: Number(b[k.start]),
        end: Number(b[k.end]),
        amps: num(b[k.amps]),
        kwh: num(b[k.kwh]),
        reason: text(b[k.reason], 40),
      }))
      .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start),
  };
}

export async function fetchPlan(
  fetchFn: FetchLike,
  plan: NonNullable<ChargingMapping['plan']>,
  timeoutMs: number,
): Promise<PlanSummary | null> {
  const get = async (url: string) => {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`plan HTTP ${r.status}`);
    return r.json();
  };
  const [s, b] = await Promise.all([
    get(plan.summaryUrl),
    plan.blocksUrl ? get(plan.blocksUrl).catch(() => []) : Promise.resolve([]),
  ]);
  return parsePlan(s, b, plan.fields);
}
