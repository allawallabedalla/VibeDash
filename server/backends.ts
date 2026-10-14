/** Wire the mapped series to their back-ends (InfluxDB, Home Assistant). */
import { haClient } from '../src/adapters/homeassistant';
import { influxClient, type FetchLike } from '../src/adapters/influx1';
import { deriveCounter } from '../src/model/derive';
import type { Series } from '../src/model/types';
import type { ServerConfig } from './config';
import { ENERGY_TO_KWH, POWER_TO_KW, sourcesOf, type Mapping, type SeriesMapping } from './mapping';

export function createBackends(
  mapping: Mapping,
  config: ServerConfig,
  fetchFn: FetchLike,
):
  | { ok: true; series: (m: SeriesMapping, from: number, to: number) => Promise<Series> }
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

  const measured = (m: SeriesMapping, from: number, to: number): Promise<Series> => {
    if (m.source === 'influx') return influx!.series(m, from, to);
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

  return {
    ok: true,
    series: (m, from, to) =>
      m.source === 'derived' ? derived(m, from, to) : measured(m, from, to),
  };
}
