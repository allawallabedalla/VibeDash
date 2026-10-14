/**
 * Synthetic demo household. Entirely made up: no real address, device or
 * measurement. Realistic daily curves with deliberate data problems:
 *
 * - `gap`: the PV logger is offline for a few hours on one day (meter keeps counting),
 *   and the living-room sensor is silent for a while last night.
 * - `artifact`: one humidity reading of 0 % (a sensor glitch, not a real value).
 * - `same_second`: two grid messages with the same timestamp, kept in arrival order.
 */
import type { Entity, Sample, Series } from '../model/types';
import { localDateKey, localHour } from '../model/time';
import { gaussian, mulberry32 } from './random';

export const DEMO_TIME_ZONE = 'Europe/Berlin';
/** Fixed "now" so screenshots are stable: 21 June 2026, 14:00 local. */
export const DEMO_NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
export const DEMO_STEP_MS = 5 * 60_000;
export const DEMO_DAYS = 30;

export const BATTERY_CAPACITY_WH = 5_000;

export type DemoIssueKind = 'gap' | 'artifact' | 'same_second';

export interface DemoIssue {
  kind: DemoIssueKind;
  entityIds: string[];
  from: number;
  to: number;
}

export interface DemoData {
  now: number;
  timeZone: string;
  entities: Entity[];
  series: Record<string, Series>;
  issues: DemoIssue[];
}

/** Demo entities are synthetic and count as confirmed. */
export const ENTITIES: Entity[] = [
  { id: 'pv_power', name: 'PV', kind: 'power', unit: 'W', confirmed: true },
  { id: 'load_power', name: 'House', kind: 'power', unit: 'W', confirmed: true },
  { id: 'battery_power', name: 'Battery', kind: 'power', unit: 'W', confirmed: true },
  { id: 'battery_soc', name: 'Battery', kind: 'state_of_charge', unit: '%', confirmed: true },
  {
    id: 'battery_capacity',
    name: 'Battery capacity',
    kind: 'capacity',
    unit: 'kWh',
    confirmed: true,
  },
  { id: 'grid_power', name: 'Grid', kind: 'power', unit: 'W', confirmed: true },
  { id: 'pv_energy', name: 'PV', kind: 'energy_counter', unit: 'kWh', confirmed: true },
  { id: 'load_energy', name: 'House', kind: 'energy_counter', unit: 'kWh', confirmed: true },
  { id: 'feed_in_energy', name: 'Feed-in', kind: 'energy_counter', unit: 'kWh', confirmed: true },
  { id: 'import_energy', name: 'Import', kind: 'energy_counter', unit: 'kWh', confirmed: true },
  {
    id: 'living_temp',
    name: 'Living room',
    kind: 'temperature',
    room: 'living',
    unit: '°C',
    confirmed: true,
  },
  {
    id: 'living_humidity',
    name: 'Living room',
    kind: 'humidity',
    room: 'living',
    unit: '%',
    confirmed: true,
  },
];

export const PV_PEAK_W = 6_000;

/** Clear-sky PV output of the demo system at a local hour (no clouds). */
export function clearSkyPower(hour: number): number {
  const x = (hour - 5.5) / 15.5;
  return x > 0 && x < 1 ? PV_PEAK_W * Math.sin(Math.PI * x) ** 2 : 0;
}

/** Clear-sky energy of a whole day in kWh (integral of the curve above). */
export const CLEAR_SKY_DAY_KWH = (PV_PEAK_W / 1000) * 15.5 * 0.5;

const bump = (x: number, mu: number, sigma: number) =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

/** Local wall-clock time on a given day, as UTC ms. Demo period is in summer time, so no DST switch inside. */
const localAt = (dayStartUtc: number, hour: number) => dayStartUtc + hour * 3_600_000;

export function generateDemo(seed = 42): DemoData {
  const now = DEMO_NOW;
  const rand = mulberry32(seed);
  const tz = DEMO_TIME_ZONE;
  const dt = DEMO_STEP_MS;
  const start = now - DEMO_DAYS * 86_400_000;
  const h = dt / 3_600_000;

  const out: Record<string, Sample[]> = Object.fromEntries(ENTITIES.map((e) => [e.id, []]));
  const push = (id: string, t: number, v: number) => out[id]!.push({ t, v });

  // Known problem windows (local midnight of a day = UTC 22:00 the evening before).
  const midnightToday = now - 14 * 3_600_000; // 00:00 local today
  const loggerDay = midnightToday - 18 * 86_400_000;
  const loggerGap = { from: localAt(loggerDay, 10), to: localAt(loggerDay, 13.5) };
  const sensorGap = {
    from: localAt(midnightToday, 2 + 10 / 60),
    to: localAt(midnightToday, 4 + 40 / 60),
  };
  const artifactAt = localAt(midnightToday, 9 + 35 / 60);
  const sameSecondAt = localAt(midnightToday, 11);

  let cloud = 0.8;
  let dayCloud = 0.8;
  let soc = 0.4 * BATTERY_CAPACITY_WH;
  let pvKwh = 18_250;
  let loadKwh = 9_430;
  let feedKwh = 11_020;
  let importKwh = 2_610;
  let currentDay = '';

  for (let t = start; t < now; t += dt) {
    const hour = localHour(t, tz);
    const day = localDateKey(t, tz);
    if (day !== currentDay) {
      currentDay = day;
      dayCloud = 0.25 + 0.75 * rand() ** 0.6;
    }
    cloud += (dayCloud - cloud) * 0.08 + gaussian(rand) * 0.04;
    cloud = Math.min(1, Math.max(0.08, cloud));

    const pv = clearSkyPower(hour) * cloud;

    let load =
      340 +
      900 * bump(hour, 7.3, 0.8) +
      650 * bump(hour, 12.6, 1.0) +
      1_300 * bump(hour, 19.2, 1.4) +
      Math.abs(gaussian(rand)) * 80;
    if (rand() < 0.015) load += 1_800 + rand() * 1_000;

    const surplus = pv - load;
    const battery =
      surplus > 0
        ? Math.min(surplus, 3_000, (BATTERY_CAPACITY_WH - soc) / h)
        : -Math.min(-surplus, 3_000, (soc - 0.05 * BATTERY_CAPACITY_WH) / h);
    soc += battery * h;
    const grid = pv - load - battery; // + feed-in, − import

    pvKwh += (pv * h) / 1_000;
    loadKwh += (load * h) / 1_000;
    feedKwh += (Math.max(grid, 0) * h) / 1_000;
    importKwh += (Math.max(-grid, 0) * h) / 1_000;

    const loggerDown = t >= loggerGap.from && t < loggerGap.to;
    if (!loggerDown) {
      push('pv_power', t, Math.round(pv));
      push('pv_energy', t, round3(pvKwh));
    }
    push('load_power', t, Math.round(load));
    push('battery_power', t, Math.round(battery));
    push('battery_soc', t, round1((soc / BATTERY_CAPACITY_WH) * 100));
    push('battery_capacity', t, BATTERY_CAPACITY_WH / 1000);
    push('grid_power', t, Math.round(grid));
    if (t === sameSecondAt) push('grid_power', t, Math.round(grid) - 140);
    push('load_energy', t, round3(loadKwh));
    push('feed_in_energy', t, round3(feedKwh));
    push('import_energy', t, round3(importKwh));

    const sensorDown = t >= sensorGap.from && t < sensorGap.to;
    if (!sensorDown) {
      const temp = 21.6 + 1.4 * Math.sin(((hour - 10) / 24) * 2 * Math.PI) + 0.6 * dayCloud;
      push('living_temp', t, round1(temp + gaussian(rand) * 0.05));
      const hum = 52 - 5 * Math.sin(((hour - 10) / 24) * 2 * Math.PI) + gaussian(rand) * 0.4;
      push('living_humidity', t, t === artifactAt ? 0 : round1(hum));
    }
  }

  const series: Record<string, Series> = Object.fromEntries(
    ENTITIES.map((e) => [
      e.id,
      { entityId: e.id, source: 'demo', stepMs: dt, samples: out[e.id]! },
    ]),
  );

  return {
    now,
    timeZone: tz,
    entities: ENTITIES,
    series,
    issues: [
      { kind: 'gap', entityIds: ['pv_power', 'pv_energy'], ...loggerGap },
      { kind: 'gap', entityIds: ['living_temp', 'living_humidity'], ...sensorGap },
      { kind: 'artifact', entityIds: ['living_humidity'], from: artifactAt, to: artifactAt },
      { kind: 'same_second', entityIds: ['grid_power'], from: sameSecondAt, to: sameSecondAt },
    ],
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
