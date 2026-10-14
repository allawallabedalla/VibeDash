/**
 * Tile definitions shared by pages and the gallery. Call inside a reactive
 * context ($derived) so texts follow the language switch.
 */
import type { TileProps } from '../components/Tile.svelte';
import { daily, dayAheadForecasts, last24h, latest, type DemoData } from '../demo';
import { sunToday, type SunForecast } from './sun-forecast';

export { demoSunForecast, type SunForecast } from './sun-forecast';
import { i18n, num, t, time } from '../i18n/index.svelte';
import { steadyValue } from '../model/series';
import { localDateKey } from '../model/time';

const kw = (w: number | null) => (w === null ? null : w / 1000);
const signed = (v: number, digits: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), digits)}`;

export function nowValue(data: DemoData, id: string): number {
  return latest(data, id)?.v ?? NaN;
}

/**
 * Current value, or null when the sensor has been silent for more than 2.5
 * steps: an old value is not "now".
 */
export function freshValue(data: DemoData, id: string): number | null {
  const s = latest(data, id);
  const step = data.series[id]?.stepMs ?? 60_000;
  return s && data.now - s.t <= step * 2.5 ? s.v : null;
}

/** Same tile, but honest about missing data: a dash and the reason, no graphic. */
function withoutValue(
  tile: TileProps,
  reason: 'state.noData' | 'state.stale' | 'state.open',
): TileProps {
  return {
    ...tile,
    value: '–',
    unit: undefined,
    approx: false,
    sub: t(reason),
    graphic: undefined,
    status: undefined,
  };
}

/** "Data missing since 13:20" (or with the date if it was another day). */
function missingSince(data: DemoData, id: string): string | null {
  const last = data.series[id]?.samples.at(-1);
  if (!last) return null;
  const sameDay = localDateKey(last.t, data.timeZone) === localDateKey(data.now, data.timeZone);
  const when = sameDay
    ? time(last.t, data.timeZone)
    : new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
        timeZone: data.timeZone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(last.t);
  return t('state.missingSince', { when });
}

/** Marks values the person has not confirmed yet (RISIKEN.md: "being checked"). */
function checking(data: DemoData, id: string, tile: TileProps): TileProps {
  const entity = data.entities.find((e) => e.id === id);
  return entity && entity.confirmed === false ? { ...tile, pending: t('state.checking') } : tile;
}

function staleOr(data: DemoData, id: string, tile: TileProps): TileProps {
  if (freshValue(data, id) !== null) return checking(data, id, tile);
  const since = missingSince(data, id);
  if (since) return { ...withoutValue(tile, 'state.stale'), sub: since };
  return withoutValue(tile, 'state.noData');
}

export function sunTile(data: DemoData, fc?: SunForecast | null): TileProps {
  const today = fc ? sunToday(data, fc) : null;
  return staleOr(data, 'pv_power', {
    label: t('tile.sun'),
    icon: 'sun',
    color: 'var(--sun)',
    value: num(nowValue(data, 'pv_power') / 1000, 1),
    unit: 'kW',
    sub: t('sub.now'),
    graphic: today
      ? {
          kind: 'spark',
          values: today.values,
          forecast: today.forecast,
          band: { low: today.low, high: today.high },
          min: 0,
        }
      : { kind: 'spark', values: last24h(data, 'pv_power').map(kw), min: 0 },
    info: {
      what: t('info.sun.what'),
      source: t('info.sun.source') + (today ? ` ${t('info.sun.forecast')}` : ''),
    },
  });
}

export function loadTile(data: DemoData): TileProps {
  return staleOr(data, 'load_power', {
    label: t('tile.home'),
    icon: 'home',
    color: 'var(--home)',
    value: num(nowValue(data, 'load_power') / 1000, 1),
    unit: 'kW',
    sub: t('sub.now'),
    graphic: { kind: 'spark', values: last24h(data, 'load_power').map(kw), min: 0 },
    info: { what: t('info.home.what'), source: loadSource(data) },
  });
}

/**
 * Where the house load comes from. A derived consumption (integral of the
 * load, see `home_energy` / `load_balance_energy` in the mapping) is named as
 * such, with the car share and the inverter's own balance to compare.
 */
function loadSource(data: DemoData): string {
  const today = localDateKey(data.now, data.timeZone);
  const todayOf = (id: string) => {
    if (!data.series[id]?.samples.length) return undefined;
    const d = daily(data, id).at(-1);
    return d && d.day === today ? d.value : undefined;
  };
  const balance = todayOf('load_balance_energy');
  const home = todayOf('home_energy');
  if (balance === undefined && home === undefined) return t('info.home.source');
  const load = todayOf('load_energy');
  const parts: string[] = [];
  if (load !== undefined) parts.push(t('info.home.derived', { load: num(load, 1) }));
  if (load !== undefined && home !== undefined) {
    parts.push(t('info.home.car', { car: num(load - home, 1), home: num(home, 1) }));
  }
  if (load !== undefined && balance !== undefined && balance > 0) {
    parts.push(
      t('info.home.balance', {
        balance: num(balance, 1),
        diff: num(balance - load, 1),
        pct: num(((balance - load) / balance) * 100),
      }),
    );
  }
  return parts.join(' ');
}

/**
 * Nominal battery capacity in kWh as the device reports it (not a measured
 * capacity): read errors (0, < 1 kWh, jumps > 10 %) dropped, the last valid
 * value held. null if unknown – then the tile shows % only.
 */
export function batteryCapacityKwh(data: DemoData): number | null {
  const s = data.series.battery_capacity;
  if (!s?.samples.length) return null;
  const unit = data.entities.find((e) => e.id === 'battery_capacity')?.unit;
  const factor = unit === 'Wh' ? 0.001 : unit === 'kWh' ? 1 : null;
  if (factor === null) return null;
  const v = steadyValue(
    s.samples.map((x) => ({ t: x.t, v: x.v * factor })),
    { min: 1, maxJump: 0.1 },
  );
  return v;
}

export function batteryTile(data: DemoData): TileProps {
  const soc = nowValue(data, 'battery_soc');
  const cap = batteryCapacityKwh(data);
  return staleOr(data, 'battery_soc', {
    label: t('tile.battery'),
    icon: 'battery',
    color: 'var(--battery)',
    value: num(soc),
    unit: '%',
    sub: cap === null ? undefined : `${num((soc / 100) * cap, 1)} / ${num(cap, 1)} kWh`,
    graphic: { kind: 'ring', value: soc / 100 },
    info: {
      what: t('info.battery.what'),
      source:
        t('info.battery.source') +
        (cap === null ? '' : ` ${t('info.battery.capacity', { cap: num(cap, 1) })}`),
    },
  });
}

export function gridTile(data: DemoData): TileProps {
  const grid = nowValue(data, 'grid_power');
  return staleOr(data, 'grid_power', {
    label: Number.isNaN(grid) ? t('sources.grid') : grid >= 0 ? t('tile.feedIn') : t('tile.import'),
    icon: 'grid',
    color: grid >= 0 ? 'var(--feed)' : 'var(--import)',
    value: signed(grid / 1000, 1),
    unit: 'kW',
    sub: t('sub.now'),
    graphic: {
      kind: 'spark',
      values: last24h(data, 'grid_power').map(kw),
      signed: true,
      color: 'var(--feed)',
    },
    info: { what: t('info.grid.what'), source: t('info.grid.source') },
  });
}

export function tempTile(data: DemoData): TileProps {
  const temp = nowValue(data, 'living_temp');
  return staleOr(data, 'living_temp', {
    label: t('tile.temp'),
    icon: 'thermometer',
    color: 'var(--climate)',
    value: num(temp, 1),
    unit: '°C',
    sub: t('sub.comfort', { low: num(20), high: num(24) }),
    graphic: { kind: 'scale', value: temp, min: 16, max: 28, band: { low: 20, high: 24 } },
    info: { what: t('info.temp.what'), source: t('info.temp.source') },
  });
}

export function humidityTile(data: DemoData): TileProps {
  const humidity = nowValue(data, 'living_humidity');
  return staleOr(data, 'living_humidity', {
    label: t('tile.humidity'),
    icon: 'droplet',
    color: 'var(--climate)',
    value: num(humidity),
    unit: '%',
    sub: t('sub.comfort', { low: num(40), high: num(60) }),
    graphic: {
      kind: 'scale',
      value: humidity,
      min: 20,
      max: 80,
      band: { low: 40, high: 60 },
    },
    // Only a real open question earns the dot, never a permanent one.
    ...(data.issues.some((i) => i.entityIds.includes('living_humidity'))
      ? { status: 'look' as const, statusLabel: t('info.humidity.what') }
      : {}),
    info: { what: t('info.humidity.what'), source: t('info.humidity.source') },
  });
}

/** Today's expected yield (day-ahead forecast) with the total so far as a dot. */
export function yieldTodayTile(data: DemoData): TileProps {
  const fc = dayAheadForecasts(data).find((f) => f.day === 'today')?.energy;
  const soFar = daily(data, 'pv_energy').at(-1)?.value;
  const base: TileProps = {
    label: t('tile.yield'),
    icon: 'forecast',
    color: 'var(--sun)',
    value: '–',
  };
  if (!fc)
    return withoutValue(
      base,
      data.series.pv_energy?.samples.length ? 'state.open' : 'state.noData',
    );
  return checking(data, 'pv_energy', {
    label: t('tile.yield'),
    icon: 'forecast',
    color: 'var(--sun)',
    approx: true,
    value: num(fc.value),
    unit: 'kWh',
    sub: t('sub.range', { low: num(fc.low), high: num(fc.high), n: fc.n }),
    graphic: {
      kind: 'scale',
      value: soFar ?? 0,
      min: 0,
      max: Math.ceil(fc.high / 10) * 10 + 10,
      band: { low: fc.low, high: fc.high },
      tick: fc.value,
    },
    info: {
      what: t('info.yield.what', { soFar: soFar === undefined ? '–' : num(soFar) }),
      source: t('info.yield.source', { n: fc.n }),
    },
  });
}

export function tomorrowTile(data: DemoData): TileProps {
  const fc = dayAheadForecasts(data).find((f) => f.day === 'tomorrow')?.energy;
  const base: TileProps = {
    label: t('tile.tomorrow'),
    icon: 'cloudSun',
    color: 'var(--sun)',
    value: '–',
  };
  if (!fc)
    return withoutValue(
      base,
      data.series.pv_energy?.samples.length ? 'state.open' : 'state.noData',
    );
  return {
    label: t('tile.tomorrow'),
    icon: 'cloudSun',
    color: 'var(--sun)',
    approx: true,
    value: num(fc.value),
    unit: 'kWh',
    sub: t('sub.range', { low: num(fc.low), high: num(fc.high), n: fc.n }),
    graphic: {
      kind: 'scale',
      value: fc.value,
      min: 0,
      max: Math.ceil(fc.high / 10) * 10 + 10,
      band: { low: fc.low, high: fc.high },
    },
    info: { what: t('info.tomorrow.what'), source: t('info.tomorrow.source', { n: fc.n }) },
  };
}

/** Share of today's consumption covered without the grid, from meter readings. */
export function autarkyTile(data: DemoData): TileProps {
  const load = daily(data, 'load_energy').at(-1)?.value;
  const imp = daily(data, 'import_energy').at(-1)?.value;
  const base: TileProps = {
    label: t('tile.autarky'),
    icon: 'target',
    color: 'var(--battery)',
    value: '–',
  };
  if (load === undefined || imp === undefined) return withoutValue(base, 'state.noData');
  const share = load > 0 ? Math.max(0, 1 - imp / load) : 0;
  return {
    label: t('tile.autarky'),
    icon: 'target',
    color: 'var(--battery)',
    value: num(share * 100),
    unit: '%',
    sub: t('sub.autarky', { load: num(load, 1), import: num(imp, 1) }),
    graphic: { kind: 'ring', value: share },
    info: { what: t('info.autarky.what'), source: t('info.autarky.source') },
  };
}
