/**
 * Charge plan (M12, stage A) bridge: sends the hourly house load without the car,
 * the battery state and the temperature to the forecasting service, and asks it for
 * the plan with the battery state right now. Plans and shows only – this server
 * never switches anything.
 *
 * Temperature: past hours from Open-Meteo's day-ahead forecasts (previous_day1, what
 * was known the day before), coming hours from the current forecast.
 */
import type { FetchLike } from '../src/adapters/influx1';
import { fetchTemperature, type Location } from '../src/adapters/openmeteo';
import type { Series } from '../src/model/types';
import { localMidnight } from '../src/model/time';
import type { Mapping, PlanMapping, SeriesMapping } from './mapping';
import { hourlyFromCounter } from './pv-bridge';

const H = 3_600_000;
const DAY = 24 * H;
const PLAN_ID = 'haus';
/** A battery reading older than this is not "now". */
const SOC_MAX_AGE = 30 * 60_000;

type Hour = { zeit: string; wert: number };

/** House load without the car: house counter minus wallbox counter, per hour (≥ 0). */
export function loadWithoutCar(house: Hour[], car: Hour[] | null): Hour[] {
  if (!car) return house;
  const c = new Map(car.map((r) => [r.zeit, r.wert]));
  return house
    .filter((r) => c.has(r.zeit)) // without the wallbox reading the hour is unknown
    .map((r) => ({
      zeit: r.zeit,
      wert: Math.max(0, Math.round((r.wert - c.get(r.zeit)!) * 1000) / 1000),
    }));
}

/** Battery % at each full hour: the latest reading at most 15 min before it. */
export function socAtHours(s: Series, from: number, to: number): Hour[] {
  const out: Hour[] = [];
  let i = 0;
  for (let h = Math.ceil(from / H) * H; h <= to; h += H) {
    while (i < s.samples.length && s.samples[i]!.t <= h) i++;
    const x = s.samples[i - 1];
    if (x && h - x.t <= 15 * 60_000) out.push({ zeit: new Date(h).toISOString(), wert: x.v });
  }
  return out;
}

export interface PlanBridgeDeps {
  url: string;
  mapping: Mapping & { plan: PlanMapping };
  fetchFn: FetchLike;
  series: (m: SeriesMapping, from: number, to: number) => Promise<Series>;
  location: () => Promise<Location | null>;
  weatherOn: boolean;
  now: () => number;
  log: (msg: string) => void;
  timeoutMs?: number;
}

export function planBridge(deps: PlanBridgeDeps) {
  const timeout = deps.timeoutMs ?? 10_000;
  const plan = deps.mapping.plan;
  let first = true;

  async function call(path: string, method = 'GET', body?: unknown) {
    const res = await deps.fetchFn(`${deps.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
    return { status: res.status, body: await res.json() };
  }

  const get = (name: string, from: number, to: number) =>
    deps.series(deps.mapping.series[name]!, from, to);

  async function sync() {
    const l = deps.weatherOn ? await deps.location() : null;
    if (!l) {
      deps.log('plan: no location or WEATHER=off – charge plan paused');
      return;
    }
    const now = deps.now();
    const from = now - (first ? 62 : 3) * DAY;
    await call(`/plan/${PLAN_ID}/anlage`, 'PUT', {
      pv: 'pv',
      akku: {
        kapazitaet_kwh: plan.battery.capacityKwh,
        max_laden_kw: plan.battery.maxChargeKw,
        max_entladen_kw: plan.battery.maxDischargeKw,
        min_soc_pct: plan.battery.minSocPct,
        reserve_kwh: plan.battery.reserveKwh,
      },
      auto: {
        kapazitaet_kwh: plan.vehicle.capacityKwh,
        phasen: plan.vehicle.phases,
        min_a: plan.vehicle.minA,
        max_a: plan.vehicle.maxA,
      },
    });
    const house = hourlyFromCounter(await get(plan.load, from, now), now);
    const car = plan.carEnergy
      ? hourlyFromCounter(await get(plan.carEnergy, from, now), now)
      : null;
    const soc = socAtHours(await get(plan.soc, from, now), from, now);
    const past = await fetchTemperature(deps.fetchFn, l, true, timeout);
    const coming = await fetchTemperature(deps.fetchFn, l, false, timeout);
    const temp = [
      ...past.filter((r) => r.t < now && r.t >= from - DAY),
      ...coming.filter((r) => r.t >= now),
    ].map((r) => ({ zeit: new Date(r.t).toISOString(), wert: r.v }));
    const r = await call(`/plan/${PLAN_ID}/daten`, 'PUT', {
      last: loadWithoutCar(house, car),
      soc,
      temp,
    });
    if (r.status === 200) first = false;
  }

  function failed(e: unknown) {
    const err = e as Error;
    return err.name === 'TimeoutError' || err.name === 'AbortError'
      ? { status: 504, body: { error: 'timeout' } }
      : { status: 502, body: { error: 'upstream' } };
  }

  return {
    async syncAll() {
      try {
        await sync();
      } catch (e) {
        deps.log(`plan: ${(e as Error).name}`);
      }
    },
    /** The plan with the battery state right now. */
    async read() {
      try {
        const now = deps.now();
        const s = await get(plan.soc, now - 2 * H, now);
        const last = s.samples[s.samples.length - 1];
        if (!last || now - last.t > SOC_MAX_AGE) {
          return { status: 200, body: { zustand: 'fehlt', was: 'akku_jetzt' } };
        }
        let charged = 0;
        if (plan.carEnergy) {
          const midnight = localMidnight(now, deps.mapping.timeZone);
          const c = await get(plan.carEnergy, midnight - H, now);
          const before = c.samples.filter((x) => x.t <= midnight).at(-1) ?? c.samples[0];
          const after = c.samples.at(-1);
          if (before && after) charged = Math.max(0, after.v - before.v);
        }
        const socKwh = (last.v / 100) * plan.battery.capacityKwh;
        const q = new URLSearchParams({
          soc_kwh: String(Math.round(socKwh * 1000) / 1000),
          geladen_kwh: String(Math.round(charged * 1000) / 1000),
        });
        return await call(`/plan/${PLAN_ID}?${q}`);
      } catch (e) {
        return failed(e);
      }
    },
    async accuracy() {
      try {
        return await call(`/plan/${PLAN_ID}/guete`);
      } catch (e) {
        return failed(e);
      }
    },
  };
}
