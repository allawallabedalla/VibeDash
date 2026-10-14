import { describe, expect, it } from 'vitest';
import {
  fetchStatistics,
  parseStatistics,
  websocketUrl,
  type SocketLike,
} from '../../src/adapters/ha-statistics';
import { haClient, type HaMapping } from '../../src/adapters/homeassistant';
import type { FetchLike } from '../../src/adapters/influx1';

const H = 3_600_000;
const T0 = Date.UTC(2026, 5, 1);

/** Minimal fake of HA's WebSocket API. */
function fakeHa(opts: { token?: string; rows?: unknown; hang?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const factory = (url: string): SocketLike => {
    const ws: SocketLike = {
      onmessage: null,
      onerror: null,
      onclose: null,
      send(data: string) {
        const msg = JSON.parse(data);
        sent.push({ ...msg, url });
        if (msg.type === 'auth') {
          const ok = msg.access_token === (opts.token ?? 'tok');
          queueMicrotask(() =>
            ws.onmessage?.({ data: JSON.stringify({ type: ok ? 'auth_ok' : 'auth_invalid' }) }),
          );
        } else if (msg.type === 'recorder/statistics_during_period' && !opts.hang) {
          queueMicrotask(() =>
            ws.onmessage?.({
              data: JSON.stringify({
                id: msg.id,
                type: 'result',
                success: true,
                result: opts.rows ?? {},
              }),
            }),
          );
        }
      },
      close() {},
    };
    queueMicrotask(() => ws.onmessage?.({ data: JSON.stringify({ type: 'auth_required' }) }));
    return ws;
  };
  return { factory, sent };
}

describe('HA long-term statistics', () => {
  it('builds the websocket url', () => {
    expect(websocketUrl('http://ha.example:8123/')).toBe('ws://ha.example:8123/api/websocket');
    expect(websocketUrl('https://ha.example')).toBe('wss://ha.example/api/websocket');
  });

  it('uses the absolute reading for meters and the mean for measurements', () => {
    const r = {
      'sensor.x': [
        { start: T0, mean: 500, state: 1200.5 },
        { start: new Date(T0 + H).toISOString(), mean: null, state: 1201 },
      ],
    };
    expect(parseStatistics(r, 'sensor.x', 'energy_counter')).toEqual([
      { t: T0, v: 1200.5 },
      { t: T0 + H, v: 1201 },
    ]);
    expect(parseStatistics(r, 'sensor.x', 'power')).toEqual([
      { t: T0, v: 500 },
      { t: T0 + H, v: null },
    ]);
    expect(parseStatistics({}, 'sensor.x', 'power')).toEqual([]);
  });

  it('authenticates, asks for hourly statistics, and times out cleanly', async () => {
    const ok = fakeHa({ rows: { 'sensor.x': [] } });
    await fetchStatistics(
      { url: 'http://ha', token: 'tok' },
      'sensor.x',
      T0,
      T0 + 10 * H,
      ok.factory,
    );
    expect(ok.sent[0]).toMatchObject({ type: 'auth', access_token: 'tok' });
    expect(ok.sent[1]).toMatchObject({
      type: 'recorder/statistics_during_period',
      period: 'hour',
      statistic_ids: ['sensor.x'],
    });
    await expect(
      fetchStatistics({ url: 'http://ha', token: 'bad' }, 'sensor.x', T0, T0 + H, fakeHa().factory),
    ).rejects.toThrow(/auth/);
    await expect(
      fetchStatistics(
        { url: 'http://ha', token: 'tok' },
        'sensor.x',
        T0,
        T0 + H,
        fakeHa({ hang: true }).factory,
        30,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('client: statistics for the older part, normal history for the last 48 h, no jump for meters', async () => {
    const now = T0 + 5 * 24 * H;
    const rows: { start: number; state: number }[] = [];
    for (let t = T0; t < now - 48 * H; t += H) rows.push({ start: t, state: 1000 + (t - T0) / H });
    const ws = fakeHa({ rows: { 'sensor.meter': rows } });
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => [
        [
          {
            entity_id: 'sensor.meter',
            state: String(1000 + (now - 48 * H - T0) / H),
            last_changed: new Date(now - 48 * H).toISOString(),
          },
        ],
      ],
      text: async () => '',
    });
    const m: HaMapping = {
      entity: { id: 'pv_energy', name: 'PV', kind: 'energy_counter', unit: 'kWh' },
      haEntityId: 'sensor.meter',
      stepMs: H,
    };
    const s = await haClient({ url: 'http://ha', token: 'tok' }, fetchFn, 1000, ws.factory).series(
      m,
      T0,
      now,
    );
    expect(s.samples[0]!.t).toBe(T0);
    const split = s.samples.findIndex((x) => x.t >= now - 48 * H);
    expect(s.samples[split]!.v - s.samples[split - 1]!.v).toBe(1); // continuous across the seam
    expect(ws.sent.some((x) => x.type === 'recorder/statistics_during_period')).toBe(true);
  });
});
