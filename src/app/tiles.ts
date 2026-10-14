/**
 * Tile definitions shared by pages and the gallery. Call inside a reactive
 * context ($derived) so texts follow the language switch.
 */
import type { TileProps } from '../components/Tile.svelte';
import {
  BATTERY_CAPACITY_WH,
  daily,
  dayAheadForecasts,
  last24h,
  latest,
  type DemoData,
} from '../demo';
import { num, t } from '../i18n/index.svelte';

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

function staleOr(data: DemoData, id: string, tile: TileProps): TileProps {
  if (freshValue(data, id) !== null) return tile;
  return withoutValue(tile, data.series[id]?.samples.length ? 'state.stale' : 'state.noData');
}

export function sunTile(data: DemoData): TileProps {
  return staleOr(data, 'pv_power', {
    label: t('tile.sun'),
    icon: 'sun',
    color: 'var(--sun)',
    value: num(nowValue(data, 'pv_power') / 1000, 1),
    unit: 'kW',
    sub: t('sub.now'),
    graphic: { kind: 'spark', values: last24h(data, 'pv_power').map(kw), min: 0 },
    info: { what: t('info.sun.what'), source: t('info.sun.source') },
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
    info: { what: t('info.home.what'), source: t('info.home.source') },
  });
}

export function batteryTile(data: DemoData): TileProps {
  const soc = nowValue(data, 'battery_soc');
  return staleOr(data, 'battery_soc', {
    label: t('tile.battery'),
    icon: 'battery',
    color: 'var(--battery)',
    value: num(soc),
    unit: '%',
    sub: `${num(((soc / 100) * BATTERY_CAPACITY_WH) / 1000, 1)} / ${num(BATTERY_CAPACITY_WH / 1000)} kWh`,
    graphic: { kind: 'ring', value: soc / 100 },
    info: { what: t('info.battery.what'), source: t('info.battery.source') },
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
  return {
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
  };
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
