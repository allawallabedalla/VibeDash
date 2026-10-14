import { describe, expect, it } from 'vitest';
import {
  haClient,
  HaError,
  isHaEntityId,
  parseHistory,
  suggestFromStates,
  toSamples,
  type HaMapping,
} from '../../src/adapters/homeassistant';
import type { FetchLike } from '../../src/adapters/influx1';
import { createBackends } from '../../server/backends';
import { readConfig } from '../../server/config';
import { validateMapping } from '../../server/mapping';

// Synthetic examples only – no real entity ids, hosts or tokens.
const T0 = Date.UTC(2026, 5, 21, 10, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

describe('history parsing', () => {
  it('reads minimal_response lists and marks unavailable/unknown as gaps', () => {
    const body = [
      [
        { entity_id: 'sensor.example_power', state: '500', last_changed: iso(T0) },
        { state: '650.5', last_changed: iso(T0 + 3 * MIN) },
        { state: 'unavailable', last_changed: iso(T0 + 5 * MIN) },
        { state: 'unknown', last_changed: iso(T0 + 6 * MIN) },
        { state: '700', last_changed: iso(T0 + 9 * MIN) },
      ],
    ];
    expect(parseHistory(body, 'sensor.example_power')).toEqual([
      { t: T0, v: 500 },
      { t: T0 + 3 * MIN, v: 650.5 },
      { t: T0 + 5 * MIN, v: null },
      { t: T0 + 6 * MIN, v: null },
      { t: T0 + 9 * MIN, v: 700 },
    ]);
  });

  it('ignores other entities and rejects odd responses', () => {
    const body = [[{ entity_id: 'sensor.other', state: '1', last_changed: iso(T0) }]];
    expect(parseHistory(body, 'sensor.example_power')).toEqual([]);
    expect(() => parseHistory({}, 'sensor.x')).toThrow(HaError);
    expect(() => parseHistory([[{ state: '1' }]], 'sensor.x')).toThrow(/time/);
  });
});

describe('state changes → regular series', () => {
  const changes = [
    { t: T0, v: 500 },
    { t: T0 + 3 * MIN, v: 650 },
    { t: T0 + 5 * MIN, v: null },
    { t: T0 + 9 * MIN, v: 700 },
  ];

  it('holds a value until the next change (no change ≠ gap)', () => {
    const s = toSamples(changes, T0, T0 + 5 * MIN, MIN);
    expect(s.map((x) => x.v)).toEqual([500, 500, 500, 650, 650]);
  });

  it('keeps "unavailable" stretches empty', () => {
    const s = toSamples(changes, T0, T0 + 11 * MIN, MIN);
    const times = s.map((x) => (x.t - T0) / MIN);
    expect(times).toEqual([0, 1, 2, 3, 4, 9, 10]);
  });

  it('stops holding after maxHoldMs (silent device without "unavailable")', () => {
    const s = toSamples([{ t: T0, v: 21 }], T0, T0 + 10 * MIN, MIN, 1, 4 * MIN);
    expect(s).toHaveLength(5);
  });

  it('applies the scale and leaves time before the first state empty', () => {
    const s = toSamples([{ t: T0 + 2 * MIN, v: 1500 }], T0, T0 + 4 * MIN, MIN, 0.001);
    expect(s).toEqual([
      { t: T0 + 2 * MIN, v: 1.5 },
      { t: T0 + 3 * MIN, v: 1.5 },
    ]);
  });
});

describe('suggestions from /api/states', () => {
  it('proposes kinds from device_class/state_class and skips the rest', () => {
    const states = [
      {
        entity_id: 'sensor.example_pv_power',
        state: '1',
        attributes: { device_class: 'power', unit_of_measurement: 'W', friendly_name: 'PV power' },
      },
      {
        entity_id: 'sensor.example_pv_energy',
        state: '1',
        attributes: {
          device_class: 'energy',
          state_class: 'total_increasing',
          unit_of_measurement: 'kWh',
        },
      },
      {
        entity_id: 'sensor.example_battery',
        state: '80',
        attributes: { device_class: 'battery', unit_of_measurement: '%' },
      },
      {
        entity_id: 'sensor.example_temp',
        state: '21',
        attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
      },
      { entity_id: 'light.example', state: 'on', attributes: {} },
      { entity_id: 'sensor.example_text', state: 'abc', attributes: {} },
    ];
    const s = suggestFromStates(states);
    expect(s.map((x) => [x.haEntityId, x.kind])).toEqual([
      ['sensor.example_pv_energy', 'energy_counter'],
      ['sensor.example_pv_power', 'power'],
      ['sensor.example_battery', 'state_of_charge'],
      ['sensor.example_temp', 'temperature'],
    ]);
  });
});

describe('client', () => {
  const m: HaMapping = {
    entity: { id: 'pv_power', name: 'PV', kind: 'power', unit: 'W' },
    haEntityId: 'sensor.example_pv_power',
    stepMs: MIN,
  };

  it('uses a bearer header, never the URL, and asks for all changes', async () => {
    let seenUrl = '';
    let auth = '';
    const fetchFn: FetchLike = async (url, init) => {
      seenUrl = url;
      auth = init?.headers?.Authorization ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => [[{ entity_id: m.haEntityId, state: '42', last_changed: iso(T0) }]],
        text: async () => '',
      };
    };
    const s = await haClient({ url: 'http://ha.example:8123/', token: 'tok' }, fetchFn).series(
      m,
      T0,
      T0 + 2 * MIN,
    );
    expect(s.samples).toEqual([
      { t: T0, v: 42 },
      { t: T0 + MIN, v: 42 },
    ]);
    expect(auth).toBe('Bearer tok');
    expect(seenUrl).not.toContain('tok');
    expect(seenUrl).toContain('/api/history/period/');
    expect(seenUrl).toContain('filter_entity_id=sensor.example_pv_power');
    expect(seenUrl).toContain('significant_changes_only=0');
  });

  it('refuses malformed entity ids before sending anything', async () => {
    let called = false;
    const fetchFn: FetchLike = async () => {
      called = true;
      throw new Error('should not be called');
    };
    const bad = { ...m, haEntityId: 'sensor.x&filter_entity_id=sensor.y' };
    await expect(
      haClient({ url: 'http://ha', token: 't' }, fetchFn).series(bad, 0, 1),
    ).rejects.toThrow(HaError);
    expect(called).toBe(false);
    expect(isHaEntityId('sensor.ok_1')).toBe(true);
  });
});

describe('mapping and wiring with Home Assistant', () => {
  const raw = {
    timeZone: 'Europe/Berlin',
    series: {
      pv_power: {
        source: 'homeassistant',
        name: 'PV',
        kind: 'power',
        unit: 'W',
        entityId: 'sensor.example_pv_power',
        stepMs: 60000,
      },
      load_power: {
        name: 'House',
        kind: 'power',
        unit: 'W',
        measurement: 'm',
        field: 'f',
        stepMs: 60000,
      },
    },
  };

  it('accepts mixed sources and rejects Influx keys on HA entries', () => {
    expect(validateMapping(raw).ok).toBe(true);
    const bad = validateMapping({
      ...raw,
      series: {
        x: {
          source: 'homeassistant',
          name: 'X',
          kind: 'power',
          unit: 'W',
          entityId: 'pv',
          measurement: 'm',
          stepMs: 60000,
        },
      },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toMatch(/measurement: unknown key for source homeassistant/);
      expect(bad.errors.join('\n')).toMatch(/entityId/);
    }
  });

  it('needs HA_URL/HA_TOKEN when the mapping uses Home Assistant', () => {
    const r = validateMapping(raw);
    if (!r.ok) throw new Error('invalid');
    const { config } = readConfig({ INFLUX_URL: 'http://i', INFLUX_DB: 'd' });
    const b = createBackends(r.mapping, config, async () => {
      throw new Error('unused');
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join()).toMatch(/HA_URL/);
    expect(readConfig({ HA_URL: 'http://ha' }).errors.join()).toMatch(/HA_TOKEN/);
    expect(readConfig({ HA_URL: 'http://u:p@ha', HA_TOKEN: 't' }).errors.join()).toMatch(/HA_URL/);
  });
});
