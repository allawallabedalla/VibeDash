/**
 * Configuration from environment (.env). Influx access must be a read-only
 * user; the server never writes. Errors name the variable, never its value.
 */
import type { EvccConfig } from '../src/adapters/evcc';
import type { HaConfig } from '../src/adapters/homeassistant';
import type { InfluxConfig } from '../src/adapters/influx1';

export interface ServerConfig {
  host: string;
  port: number;
  mappingPath: string;
  distDir: string;
  timeoutMs: number;
  influx?: InfluxConfig;
  homeassistant?: HaConfig;
  evcc?: EvccConfig;
}

function checkUrl(name: string, value: string, errors: string[]) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) errors.push(`${name}: must be http(s)`);
    if (u.username || u.password) {
      errors.push(`${name}: no credentials in the URL; use the separate variables`);
    }
  } catch {
    errors.push(`${name}: not a valid URL`);
  }
}

export function readConfig(env: Record<string, string | undefined>): {
  config: ServerConfig;
  errors: string[];
} {
  const errors: string[] = [];
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT: must be 1–65535');

  let influx: InfluxConfig | undefined;
  if (env.INFLUX_URL) {
    checkUrl('INFLUX_URL', env.INFLUX_URL, errors);
    if (!env.INFLUX_DB) errors.push('INFLUX_DB: required when INFLUX_URL is set');
    influx = {
      url: env.INFLUX_URL,
      database: env.INFLUX_DB ?? '',
      ...(env.INFLUX_USER
        ? { username: env.INFLUX_USER, password: env.INFLUX_PASSWORD ?? '' }
        : {}),
      ...(env.INFLUX_RP ? { retentionPolicy: env.INFLUX_RP } : {}),
    };
  }

  let homeassistant: HaConfig | undefined;
  if (env.HA_URL) {
    checkUrl('HA_URL', env.HA_URL, errors);
    if (!env.HA_TOKEN) errors.push('HA_TOKEN: required when HA_URL is set');
    homeassistant = { url: env.HA_URL, token: env.HA_TOKEN ?? '' };
  }

  let evcc: EvccConfig | undefined;
  if (env.EVCC_URL) {
    checkUrl('EVCC_URL', env.EVCC_URL, errors);
    evcc = { url: env.EVCC_URL };
  }

  return {
    config: {
      // only this machine unless HOST says otherwise (Audit01 S-02)
      host: env.HOST ?? '127.0.0.1',
      port,
      mappingPath: env.MAPPING_PATH ?? 'local/mapping.json',
      distDir: env.DIST_DIR ?? 'dist',
      timeoutMs: 10_000,
      ...(influx ? { influx } : {}),
      ...(homeassistant ? { homeassistant } : {}),
      ...(evcc ? { evcc } : {}),
    },
    errors,
  };
}
