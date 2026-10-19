/**
 * VibeDash modules (modules/, Python): tools that make whole boards, e.g. the
 * maintenance plan. They run as one local service (MODULES_URL, default
 * http://127.0.0.1:8091) that only this server talks to – the browser never
 * does. A board with `module` in the mapping is fetched from it; clicks on its
 * items go to it; its feeds (e.g. a calendar to subscribe to) go out at
 * /feed/<module>/<file>, but only for modules the mapping names.
 */
import type { BoardMapping, Mapping } from './mapping';

export const MODULES_DEFAULT_URL = 'http://127.0.0.1:8091';

/** feed types passed on as they come; anything else is refused */
const FEED_TYPES: Record<string, string> = { ics: 'text/calendar; charset=utf-8' };
const FEED_PATH = /^\/feed\/([a-z][a-z0-9_-]{0,31})\/([a-z0-9_-]{1,40})\.([a-z]{2,4})$/;

export function moduleBase(env: Record<string, string | undefined>): string {
  return (env.MODULES_URL || MODULES_DEFAULT_URL).replace(/\/+$/, '');
}

export function boardUrl(b: BoardMapping, base: string): string {
  return b.module ? `${base}/board/${b.module}` : b.url!;
}

export function actionTarget(
  b: BoardMapping,
  base: string,
): { url: string; headers: Record<string, string> } | null {
  if (b.module)
    return { url: `${base}/board/${b.module}/action`, headers: { 'X-VibeDash-Action': '1' } };
  if (b.actionUrl) return { url: b.actionUrl, headers: { 'X-Haus-Aktion': '1' } };
  return null;
}

export interface FeedAnswer {
  status: number;
  type: string;
  body: string;
}

/** GET /feed/<module>/<file>.<ext>: null if the path is not a feed path at all. */
export async function moduleFeed(
  path: string,
  mapping: Mapping | null | undefined,
  base: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<FeedAnswer | null> {
  const m = FEED_PATH.exec(path);
  if (!m) return null;
  const [, mod, file, ext] = m;
  const type = FEED_TYPES[ext!];
  if (!type || !mapping?.boards?.some((b) => b.module === mod))
    return { status: 404, type: 'text/plain', body: 'not found' };
  try {
    const r = await fetchFn(`${base}/feed/${mod}/${file}.${ext}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok)
      return { status: r.status === 404 ? 404 : 502, type: 'text/plain', body: 'not found' };
    const body = await r.text();
    return { status: 200, type, body: body.slice(0, 2_000_000) };
  } catch {
    return { status: 502, type: 'text/plain', body: 'module not reachable' };
  }
}
