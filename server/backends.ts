/** Wire the mapped series to their back-ends (InfluxDB, Home Assistant). */
import { haClient } from '../src/adapters/homeassistant';
import { influxClient, type FetchLike, type InfluxResponse } from '../src/adapters/influx1';
import { deriveCounter } from '../src/model/derive';
import { holdForward } from '../src/model/series';
import type { Series } from '../src/model/types';
import type { ServerConfig } from './config';
import { ENERGY_TO_KWH, POWER_TO_KW, sourcesOf, type Mapping, type SeriesMapping } from './mapping';

export function createBackends(
  mapping: Mapping,
  config: ServerConfig,
  fetchFn: FetchLike,
):
  | {
      ok: true;
      series: (m: SeriesMapping, from: number, to: number) => Promise<Series>;
      daily: (m: SeriesMapping, from: number, to: number) => Promise<[number, number | null][]>;
      /** raw InfluxQL for read-only helpers (charging records); null without Influx */
      query: ((q: string) => Promise<InfluxResponse>) | null;
    }
  | { ok: false; errors: string[] } {
  const needed = sourcesOf(mapping);
  const errors: string[] = [];
  if (needed.includes('influx') && !config.influx) {
    errors.push('INFLUX_URL: required because local/mapping.json uses source "influx"');
  }
  if (needed.includes('homeassistant') && !config.homeassistant) {
    errors.push(
      'HA_URL / HA_TOKEN: required because local/mapping.json uses source "homeassistant"',
    );
  }
  if (errors.length) return { ok: false, errors };

  const influx = config.influx ? influxClient(config.influx, fetchFn, config.timeoutMs) : null;
  const ha = config.homeassistant
    ? haClient(config.homeassistant, fetchFn, config.timeoutMs)
    : null;

  const measured = async (m: SeriesMapping, from: number, to: number): Promise<Series> => {
    if (m.source === 'influx') {
      if (!m.maxHoldMs) return influx!.series(m, from, to);
      // reports on change only: look back far enough to know the value at `from`
      const s = await influx!.series(m, from - m.maxHoldMs, to);
      return { ...s, samples: holdForward(s.samples, m.stepMs, m.maxHoldMs, from, to) };
    }
    if (m.source === 'homeassistant') return ha!.series(m, from, to);
    throw new Error('derived series inside a derived series');
  };

  // Derived counters: fetch the parts (one step earlier, so the first slot is
  // complete) and compute; the mapping check guarantees the parts exist.
  const derived = async (
    m: Extract<SeriesMapping, { source: 'derived' }>,
    from: number,
    to: number,
  ): Promise<Series> => {
    const parts = await Promise.all(
      m.terms.map(async (term) => {
        const src = mapping.series[term.series]!;
        const factor =
          term.how === 'integrate'
            ? POWER_TO_KW[src.entity.unit]!
            : ENERGY_TO_KWH[src.entity.unit]!;
        const series = await measured(src, from - src.stepMs * 2, to);
        return { how: term.how, sign: term.sign, factor, series };
      }),
    );
    return {
      entityId: m.entity.id,
      source: 'derived',
      stepMs: m.stepMs,
      samples: deriveCounter(parts, from, to, m.stepMs),
    };
  };

  /**
   * Daily energy of a meter over long ranges, cheaply: the last reading per
   * local day from InfluxDB (older days from `history`), each day the
   * difference to the day before. A drop or a day above maxPerDay is a gap
   * (null), never a negative or a giant day.
   */
  const dailyOf = async (
    m: SeriesMapping,
    from: number,
    to: number,
  ): Promise<[number, number | null][]> => {
    if (m.source !== 'influx' || m.entity.kind !== 'energy_counter') {
      throw new Error('daily values only for Influx meters');
    }
    const tz = mapping.timeZone;
    const main = await influx!.dailyLast(m, from - 86_400_000, to, tz);
    const first = main[0]?.t ?? Infinity;
    const older = m.history
      ? (await influx!.dailyLast(m.history, from - 86_400_000, Math.min(to, first), tz)).filter(
          (x) => x.t < first,
        )
      : [];
    const readings = [...older, ...main];
    const max = m.entity.maxPerDay ?? Infinity;
    const out: [number, number | null][] = [];
    for (let i = 1; i < readings.length; i++) {
      const a = readings[i - 1]!;
      const b = readings[i]!;
      if (b.t < from) continue;
      const d = b.v - a.v;
      // a day without a reading in between (gap of days) is not split up
      const oneDay = b.t - a.t <= 26 * 3_600_000;
      out.push([b.t, oneDay && d >= 0 && d <= max ? d : null]);
    }
    return out;
  };

  return {
    ok: true,
    series: (m, from, to) =>
      m.source === 'derived' ? derived(m, from, to) : measured(m, from, to),
    daily: dailyOf,
    query: influx ? influx.query : null,
  };
}
