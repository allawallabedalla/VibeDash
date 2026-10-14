import { describe, expect, it } from 'vitest';
import {
  ident,
  influxClient,
  InfluxError,
  inventory,
  lastQuery,
  literal,
  parseList,
  parseSamples,
  rawQuery,
  type InfluxMapping,
  type InfluxResponse,
} from '../../src/adapters/influx1';
import { counterResets } from '../../src/model/series';

// Synthetic example only – no real measurement names, hosts or values.
const mapping: InfluxMapping = {
  entity: { id: 'pv_power', name: 'PV', kind: 'power', unit: 'W' },
  measurement: 'demo_power',
  field: 'value',
  tags: { device: 'inverter "a"', phase: "it's" },
  stepMs: 60_000,
};

describe('InfluxQL building', () => {
  it('quotes identifiers and literals safely', () => {
    expect(ident('a"b')).toBe('"a\\"b"');
    expect(literal("x' OR '1'='1")).toBe("'x\\' OR \\'1\\'=\\'1'");
  });

  it('builds a raw time-range query with tags', () => {
    expect(rawQuery(mapping, 1000, 2000)).toBe(
      'SELECT "value" FROM "demo_power" WHERE time >= 1000ms AND time < 2000ms AND "device" = \'inverter "a"\' AND "phase" = \'it\\\'s\'',
    );
  });

  it('supports a retention policy and LAST()', () => {
    expect(lastQuery({ ...mapping, tags: {} }, 5000, 'autogen')).toBe(
      'SELECT LAST("value") FROM "autogen"."demo_power" WHERE time <= 5000ms',
    );
    expect(inventory.tagValues('m', 'k')).toBe('SHOW TAG VALUES FROM "m" WITH KEY = "k"');
  });
});

describe('response parsing', () => {
  const res: InfluxResponse = {
    results: [
      {
        statement_id: 0,
        series: [
          {
            name: 'demo_power',
            columns: ['time', 'value'],
            values: [
              [1000, 5],
              [2000, null],
              [3000, 7],
              [3000, 3],
              [4000, true],
            ],
          },
        ],
      },
    ],
  };

  it('keeps arrival order for equal timestamps and drops nulls as gaps', () => {
    expect(parseSamples(res)).toEqual([
      { t: 1000, v: 5 },
      { t: 3000, v: 7 },
      { t: 3000, v: 3 },
      { t: 4000, v: 1 },
    ]);
  });

  it('applies the scale (e.g. Wh → kWh)', () => {
    expect(parseSamples(res, 0.001)[0]!.v).toBeCloseTo(0.005);
  });

  it('raises statement errors instead of returning empty data', () => {
    expect(() => parseSamples({ results: [{ error: 'database not found: x' }] })).toThrow(
      InfluxError,
    );
  });

  it('rejects RFC3339 timestamps (epoch=ms is required)', () => {
    const bad = {
      results: [{ series: [{ name: 'm', columns: ['time', 'v'], values: [['2026-01-01', 1]] }] }],
    };
    expect(() => parseSamples(bad)).toThrow(/epoch/);
  });

  it('reads SHOW lists', () => {
    const list = {
      results: [{ series: [{ name: 'measurements', columns: ['name'], values: [['a'], ['b']] }] }],
    };
    expect(parseList(list)).toEqual(['a', 'b']);
  });
});

describe('client', () => {
  it('sends basic auth in a header, never in the URL, and asks for epoch=ms', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const client = influxClient(
      { url: 'http://influx.example:8086/', database: 'demo', username: 'u', password: 'p' },
      async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ series: [{ name: 'm', columns: ['time', 'value'], values: [[1, 2]] }] }],
          }),
          text: async () => '',
        };
      },
    );
    const s = await client.series(mapping, 0, 10);
    expect(s.samples).toEqual([{ t: 1, v: 2 }]);
    expect(seenUrl.startsWith('http://influx.example:8086/query?')).toBe(true);
    expect(seenUrl).toContain('epoch=ms');
    expect(seenUrl).not.toContain('p=');
    expect(seenUrl).not.toContain('u=');
    expect(seenHeaders.Authorization).toBe(`Basic ${btoa('u:p')}`);
  });

  it('reports HTTP errors', async () => {
    const client = influxClient({ url: 'http://x', database: 'd' }, async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized',
    }));
    await expect(client.query('SHOW MEASUREMENTS')).rejects.toThrow(/401/);
  });
});

describe('counterResets', () => {
  it('finds meter readings that go down', () => {
    expect(
      counterResets([
        { t: 1, v: 100 },
        { t: 2, v: 101 },
        { t: 3, v: 2 },
        { t: 4, v: 3 },
      ]),
    ).toEqual([{ t: 3, from: 101, to: 2 }]);
  });
});
