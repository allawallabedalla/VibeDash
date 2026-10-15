/**
 * Car charging from the house's own records (read-only), for houses without
 * evcc: the current charge, past charges and – optionally – the plan of an
 * external charge planner.
 *
 * mapping.charging:
 *   power:    series id of the car's charging power (W)
 *   sessions: { measurement, energy, running, duration?, source?, id? } – one
 *             row per start (running = true) and one per end (running =
 *             false, with energy in kWh), both stamped at the start
 *   gridMeter: series id of the grid import meter (kWh) – grid energy during
 *             each charge, an upper bound for what the car took from the grid
 *   plan:     { summaryUrl, blocksUrl } – an external planner's summary and
 *             blocks (see README); fetched with the usual timeout
 */
import type { FetchLike } from '../src/adapters/influx1';

export interface ChargingMapping {
  power?: string;
  gridMeter?: string;
  sessions: {
    measurement: string;
    energy: string;
    running: string;
    duration?: string;
    source?: string;
    id?: string;
  };
  plan?: { summaryUrl: string; blocksUrl?: string };
}

export interface ChargeSession {
  start: number;
  end: number | null;
  kwh: number | null;
  source: string | null;
  /** grid import during the charge (house included), kWh */
  gridKwh: number | null;
}

export interface ChargingNow {
  running: boolean;
  since: number | null;
  source: string | null;
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
    // the first known source wins; a later "unknown" never overwrites it
    if (f.source && typeof r[f.source] === 'string' && s.source === null) {
      s.source = r[f.source] as string;
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
export function parsePlan(summary: unknown, blocks: unknown): PlanSummary | null {
  const z = Array.isArray(summary) ? summary[0] : summary;
  if (!z || typeof z !== 'object') return null;
  const o = z as Record<string, unknown>;
  const day = (k: string) => ({
    kwh: num(o[`${k}_kwh`]),
    low: num(o[`${k}_p10`]),
    high: num(o[`${k}_p90`]),
  });
  const bl = Array.isArray(blocks) ? blocks : [];
  return {
    text: typeof o.kurz === 'string' ? o.kurz.slice(0, 200) : null,
    madeAt: num(o.stand),
    days: [day('heute'), day('morgen')],
    socNow: num(o.soc),
    socMin: num(o.soc_mindest),
    blocks: bl
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .map((b) => ({
        start: Number(b.start),
        end: Number(b.ende),
        amps: num(b.a),
        kwh: num(b.kwh),
        reason: typeof b.grund === 'string' ? b.grund.slice(0, 40) : null,
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
  return parsePlan(s, b);
}
