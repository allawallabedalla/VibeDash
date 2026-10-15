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
import { addDays, localDateKey, localMidnight } from '../model/time';

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
 * Where the daily consumption comes from. `load_energy` may be the inverter's
 * balance of meters; `device_energy` (power summed up) then shows what reached
 * the devices, the difference is named as loss. `home_energy` gives the share
 * without the car.
 */
function loadSource(data: DemoData): string {
  const today = localDateKey(data.now, data.timeZone);
  const todayOf = (id: string) => {
    if (!data.series[id]?.samples.length) return undefined;
    const d = daily(data, id).at(-1);
    return d && d.day === today ? d.value : undefined;
  };
  const load = todayOf('load_energy');
  const devices = todayOf('device_energy');
  const home = todayOf('home_energy');
  if (load === undefined || (devices === undefined && home === undefined)) {
    return t('info.home.source');
  }
  const fromPower = data.entities.some((e) => e.id === 'load_energy' && e.derived === true);
  const parts = [t(fromPower ? 'info.home.derived' : 'info.home.meters', { load: num(load, 1) })];
  if (devices !== undefined && load > 0) {
    parts.push(
      t('info.home.loss', {
        devices: num(devices, 1),
        loss: num(load - devices, 1),
        pct: num(((load - devices) / load) * 100),
      }),
    );
  }
  if (home !== undefined) {
    parts.push(t('info.home.car', { car: num(load - home, 1), home: num(home, 1) }));
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
    graphic: { kind: 'battery', soc, flow: freshValue(data, 'battery_power') ?? 0 },
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

/** The latest open gap / odd value of a sensor, from the data itself (never a fixed text). */
function sensorNotes(data: DemoData, id: string): { gap?: string; outlier?: string } {
  const mine = data.issues.filter((i) => i.entityIds.includes(id));
  const gap = mine.filter((i) => i.kind === 'gap').at(-1);
  const odd = mine.filter((i) => i.kind === 'artifact').at(-1);
  const at = (ms: number) => time(ms, data.timeZone);
  return {
    ...(gap ? { gap: t('info.gapNote', { from: at(gap.from), to: at(gap.to) }) } : {}),
    ...(odd ? { outlier: t('info.outlier', { time: at(odd.from) }) } : {}),
  };
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
    graphic: {
      kind: 'scale',
      value: temp,
      min: 16,
      max: 28,
      zone: { low: 20, high: 24 },
      temperature: true,
    },
    info: {
      what: t('info.temp.what'),
      source: [t('info.temp.source'), sensorNotes(data, 'living_temp').gap]
        .filter(Boolean)
        .join(' '),
    },
  });
}

export function humidityTile(data: DemoData): TileProps {
  const humidity = nowValue(data, 'living_humidity');
  const notes = sensorNotes(data, 'living_humidity');
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
      zone: { low: 40, high: 60 },
    },
    // Only a real open question earns the dot, never a permanent one.
    ...(notes.outlier || notes.gap
      ? { status: 'look' as const, statusLabel: notes.outlier ?? notes.gap }
      : {}),
    info: {
      what: notes.outlier ?? t('info.humidity.what'),
      source: [t('info.humidity.source'), notes.gap, notes.outlier ? t('info.outlierNote') : '']
        .filter(Boolean)
        .join(' '),
    },
  });
}

/** The house's own daily PV forecast (series pv_forecast_day, optional _low/_high). */
export function houseDayForecast(
  data: DemoData,
  offset: number,
): { value: number; low: number; high: number } | null {
  const s = data.series.pv_forecast_day?.samples;
  if (!s?.length) return null;
  const start = addDays(localMidnight(data.now, data.timeZone), offset, data.timeZone);
  const at = (id: string) =>
    data.series[id]?.samples.find(
      (p) => p.t >= start - 3 * 3_600_000 && p.t < start + 21 * 3_600_000,
    )?.v;
  const value = at('pv_forecast_day');
  if (value === undefined) return null;
  return {
    value,
    low: at('pv_forecast_day_low') ?? value,
    high: at('pv_forecast_day_high') ?? value,
  };
}

/** Today's expected yield (day-ahead forecast) with the total so far as a dot. */
export function yieldTodayTile(data: DemoData): TileProps {
  const own = houseDayForecast(data, 0);
  const fc = own
    ? { ...own, n: 0 }
    : dayAheadForecasts(data).find((f) => f.day === 'today')?.energy;
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
    sub: own
      ? fc.high > fc.low
        ? t('sub.span', { low: num(fc.low), high: num(fc.high) })
        : t('sub.houseForecast')
      : t('sub.range', { low: num(fc.low), high: num(fc.high), n: fc.n }),
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
      source: own ? t('info.yield.house') : t('info.yield.source', { n: fc.n }),
    },
  });
}

export function tomorrowTile(data: DemoData): TileProps {
  const own = houseDayForecast(data, 1);
  const fc = own
    ? { ...own, n: 0 }
    : dayAheadForecasts(data).find((f) => f.day === 'tomorrow')?.energy;
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
    sub: own
      ? fc.high > fc.low
        ? t('sub.span', { low: num(fc.low), high: num(fc.high) })
        : t('sub.houseForecast')
      : t('sub.range', { low: num(fc.low), high: num(fc.high), n: fc.n }),
    graphic: {
      kind: 'scale',
      value: fc.value,
      min: 0,
      max: Math.ceil(fc.high / 10) * 10 + 10,
      band: { low: fc.low, high: fc.high },
    },
    info: {
      what: t('info.tomorrow.what'),
      source: own ? t('info.yield.house') : t('info.tomorrow.source', { n: fc.n }),
    },
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

/** Highest value seen in the loaded data, rounded up (scale for "now" graphics). */
function peak(data: DemoData, id: string, step: number, floor: number): number {
  let hi = 0;
  for (const x of data.series[id]?.samples ?? []) hi = Math.max(hi, Math.abs(x.v));
  return Math.max(floor, Math.ceil(hi / step) * step);
}

/** Sun now: half arc against the highest output seen, word instead of "now". */
export function sunNowTile(data: DemoData): TileProps {
  const w = nowValue(data, 'pv_power');
  const top = peak(data, 'pv_power', 1000, 1000);
  return staleOr(data, 'pv_power', {
    label: t('tile.sun'),
    icon: 'sun',
    color: 'var(--sun)',
    value: num(w / 1000, 1),
    unit: 'kW',
    sub: w >= 50 ? t('word.sunOn') : t('word.sunOff'),
    graphic: { kind: 'arc', share: w / top, off: w < 50 },
    info: { what: t('info.sun.what'), source: t('info.sun.source') },
  });
}

/** Consumption now: where it comes from (sun directly, battery, grid). */
export function loadNowTile(data: DemoData): TileProps {
  const load = Math.max(0, nowValue(data, 'load_power') || 0);
  const fromBattery = Math.max(0, -(freshValue(data, 'battery_power') ?? 0));
  const grid = freshValue(data, 'grid_power') ?? 0;
  const fromGrid = Math.abs(grid) < 50 ? 0 : Math.max(0, -grid);
  const fromSun = Math.max(0, load - fromBattery - fromGrid);
  return staleOr(data, 'load_power', {
    label: t('tile.home'),
    icon: 'home',
    color: 'var(--home)',
    value: num(load / 1000, 1),
    unit: 'kW',
    sub: t('word.consumption'),
    graphic: {
      kind: 'origin',
      parts: [
        { value: fromSun, color: 'var(--sun-soft)', label: t('origin.sun') },
        { value: fromBattery, color: 'var(--battery)', label: t('origin.battery') },
        { value: fromGrid, color: 'var(--import)', label: t('origin.grid') },
      ],
    },
    info: { what: t('info.home.what'), source: loadSource(data) },
  });
}

/** Battery now: word for what it does. */
export function batteryNowTile(data: DemoData): TileProps {
  const flow = freshValue(data, 'battery_power') ?? 0;
  const tile = batteryTile(data);
  if (tile.value === '–') return tile;
  return {
    ...tile,
    sub: flow >= 100 ? t('word.charging') : flow <= -100 ? t('word.discharging') : t('word.idle'),
  };
}

/** Grid now: pendulum, feed-in positive to the right; under 50 W "balanced". */
export function gridNowTile(data: DemoData): TileProps {
  const w = nowValue(data, 'grid_power');
  const quiet = Math.abs(w) < 50;
  return staleOr(data, 'grid_power', {
    label: t('tile.grid'),
    icon: 'grid',
    color: quiet || w > 0 ? 'var(--feed)' : 'var(--import)',
    value: quiet ? num(0, 1) : signed(w / 1000, 1),
    unit: 'kW',
    sub: quiet ? t('word.balanced') : w > 0 ? t('word.feed') : t('word.import'),
    graphic: {
      kind: 'pendulum',
      watts: quiet ? 0 : w,
      range: peak(data, 'grid_power', 1000, 3000),
    },
    info: { what: t('info.grid.what'), source: t('info.grid.source') },
  });
}
