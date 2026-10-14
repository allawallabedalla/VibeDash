/**
 * Read-only inventory for onboarding (see AGENT.md, section 1 and 2).
 * Prints a DRAFT for local/mapping.json to stdout – it never writes a file and
 * never sends anything but GET requests. The person confirms every entry.
 */
import { existsSync } from 'node:fs';
import { haClient, suggestFromStates } from '../src/adapters/homeassistant';
import { influxClient, inventory, parseList } from '../src/adapters/influx1';
import { readConfig } from './config';

if (existsSync('.env')) process.loadEnvFile('.env');
const { config, errors } = readConfig(process.env);
if (errors.length) {
  console.error(errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
if (!config.homeassistant && !config.influx) {
  console.error('Nothing to inventory: set HA_URL/HA_TOKEN and/or INFLUX_URL/INFLUX_DB in .env');
  process.exit(1);
}

const draft: Record<string, unknown> = {};

if (config.homeassistant) {
  const ha = haClient(config.homeassistant, fetch, config.timeoutMs);
  const suggestions = suggestFromStates(await ha.states());
  console.error(`Home Assistant: ${suggestions.length} candidate sensors`);
  for (const s of suggestions) {
    const name = `ha_${s.haEntityId.split('.')[1]}`.slice(0, 64);
    draft[name] = {
      source: 'homeassistant',
      name: s.friendlyName,
      kind: s.kind,
      unit: s.unit,
      entityId: s.haEntityId,
      stepMs: s.kind === 'power' ? 60_000 : 300_000,
      ...(s.kind === 'energy_counter' && s.unit === 'Wh' ? { scale: 0.001 } : {}),
    };
  }
}

if (config.influx) {
  const influx = influxClient(config.influx, fetch, config.timeoutMs);
  const measurements = await influx.measurements();
  console.error(`InfluxDB: ${measurements.length} measurements`);
  for (const m of measurements) {
    const fields = parseList(await influx.query(inventory.fieldKeys(m)), 'fieldKey');
    console.error(`  ${m}: ${fields.join(', ')}`);
  }
  console.error('  (Influx entries are written by hand: measurement, field, tags.)');
}

console.log(
  JSON.stringify(
    {
      $comment:
        'DRAFT – check every entry with the person, rename to the standard names (pv_power, load_power, …), then save as local/mapping.json',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      series: draft,
    },
    null,
    2,
  ),
);
