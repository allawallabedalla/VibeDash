/**
 * Configuration from environment (.env). Influx access must be a read-only
 * user; the server never writes. Errors name the variable, never its value.
 */
import type { InfluxConfig } from '../src/adapters/influx1';

export interface ServerConfig {
  host: string;
  port: number;
  mappingPath: string;
  distDir: string;
  timeoutMs: number;
  influx?: InfluxConfig;
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
    try {
      const u = new URL(env.INFLUX_URL);
      if (!['http:', 'https:'].includes(u.protocol)) errors.push('INFLUX_URL: must be http(s)');
      if (u.username || u.password)
        errors.push('INFLUX_URL: put credentials in INFLUX_USER/INFLUX_PASSWORD, not in the URL');
    } catch {
      errors.push('INFLUX_URL: not a valid URL');
    }
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

  return {
    config: {
      host: env.HOST ?? '0.0.0.0',
      port,
      mappingPath: env.MAPPING_PATH ?? 'local/mapping.json',
      distDir: env.DIST_DIR ?? 'dist',
      timeoutMs: 10_000,
      ...(influx ? { influx } : {}),
    },
    errors,
  };
}
