/**
 * Home Assistant long-term statistics (WebSocket `recorder/statistics_during_period`).
 * HA keeps hourly statistics without time limit, while the normal history is
 * purged after 10 days by default. Only entities with a state_class have them.
 *
 * Meters (energy_counter) use the hourly `state` – the absolute reading, so it
 * joins the normal history without a jump. Measurements use the hourly `mean`.
 */
import type { EntityKind } from '../model/types';
import { HaError, type HaConfig, type StateChange } from './homeassistant';

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export function websocketUrl(httpUrl: string): string {
  const u = new URL(httpUrl.replace(/\/$/, '') + '/api/websocket');
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

interface StatRow {
  start: number | string;
  mean?: number | null;
  state?: number | null;
}

export function parseStatistics(
  result: unknown,
  statisticId: string,
  kind: EntityKind,
): StateChange[] {
  const rows = (result as Record<string, StatRow[]> | null)?.[statisticId];
  if (!Array.isArray(rows)) return [];
  const out: StateChange[] = [];
  for (const r of rows) {
    const t = typeof r.start === 'number' ? r.start : Date.parse(String(r.start));
    if (!Number.isFinite(t)) continue;
    const v = kind === 'energy_counter' ? r.state : r.mean;
    out.push({ t, v: typeof v === 'number' && Number.isFinite(v) ? v : null });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** One request over a short-lived WebSocket: auth, query, close. Always ends (timeout). */
export function fetchStatistics(
  config: HaConfig,
  statisticId: string,
  fromMs: number,
  toMs: number,
  open: SocketFactory,
  timeoutMs = 10_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = open(websocketUrl(config.url));
    const finish = (err: Error | null, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      const e = new Error('timeout');
      e.name = 'TimeoutError';
      finish(e);
    }, timeoutMs);
    ws.onerror = () => finish(new HaError('websocket error'));
    ws.onclose = () => finish(new HaError('websocket closed'));
    ws.onmessage = (ev) => {
      let msg: { type?: string; id?: number; success?: boolean; result?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return finish(new HaError('bad websocket message'));
      }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: config.token }));
      } else if (msg.type === 'auth_invalid') {
        finish(new HaError('auth invalid'));
      } else if (msg.type === 'auth_ok') {
        ws.send(
          JSON.stringify({
            id: 1,
            type: 'recorder/statistics_during_period',
            start_time: new Date(fromMs).toISOString(),
            end_time: new Date(toMs).toISOString(),
            statistic_ids: [statisticId],
            period: 'hour',
            types: ['mean', 'state'],
          }),
        );
      } else if (msg.type === 'result' && msg.id === 1) {
        if (msg.success) finish(null, msg.result);
        else finish(new HaError('statistics request failed'));
      }
    };
  });
}

/** Default factory: Node 24 / browsers have a global WebSocket. */
export const nativeSocket: SocketFactory = (url) =>
  new (globalThis as unknown as { WebSocket: new (u: string) => SocketLike }).WebSocket(url);
