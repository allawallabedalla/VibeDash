/** Wire the mapped series to their back-ends (InfluxDB, Home Assistant). */
import { haClient } from '../src/adapters/homeassistant';
import { influxClient, type FetchLike } from '../src/adapters/influx1';
import type { Series } from '../src/model/types';
import type { ServerConfig } from './config';
import { sourcesOf, type Mapping, type SeriesMapping } from './mapping';

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

  return {
    ok: true,
    series: (m, from, to) =>
      m.source === 'influx' ? influx!.series(m, from, to) : ha!.series(m, from, to),
  };
}
