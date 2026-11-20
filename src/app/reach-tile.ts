/**
 * The battery tile at night (Audit05 I-4): "empty ≈ 03:40 (02:50–04:30) · n" or "lasts
 * until sun", the night as a bar and the estimate for the enlarged view. Loaded by the
 * overview after the first paint, with its own texts – nothing of it is on the first page.
 */
import type { TileProps } from '../components/Tile.svelte';
import type { DemoData } from '../demo';
import { time } from '../i18n/index.svelte';
import { tr } from '../i18n/reach';
import { batteryReach, type Reach } from '../model/reach';
import { batteryCapacityKwh, freshValue } from './tiles';

const tx = (k: string, vars: Record<string, string | number> = {}) =>
  tr(`reach.${k}` as Parameters<typeof tr>[0], vars);

/** " (02:50–04:30)" around the empty time; nothing when both ends read the same */
export function emptyRange(r: Extract<Reach, { kind: 'night' }>, tz: string): string {
  const lo = time(r.emptyEarly ?? r.emptyAt ?? r.sunAt, tz);
  const hi = time(r.emptyLate ?? r.sunAt, tz);
  return lo === hi ? '' : ` (${lo}–${hi})`;
}

/** Does the battery last until sunrise? Only with a fresh charge and a known capacity. */
export function reachOf(data: DemoData): Reach | null {
  const soc = freshValue(data, 'battery_soc');
  const cap = batteryCapacityKwh(data);
  if (soc === null || cap === null) return null;
  const s = (id: string) => data.series[id]?.samples ?? [];
  return batteryReach({
    now: data.now,
    tz: data.timeZone,
    socPct: soc,
    capKwh: cap,
    load: s('load_power'),
    pv: s('pv_power'),
    soc: s('battery_soc'),
  });
}

/** The battery tile with the night estimate; by day only the estimate for the enlarged view. */
export function withReach(tile: TileProps, data: DemoData): TileProps {
  if (tile.value === '–') return tile;
  const reach = reachOf(data);
  if (!reach) return tile;
  const info = tile.info && {
    what: `${tile.info.what} ${tx('info.what')}`,
    source: `${tile.info.source} ${tx('info.source')}`,
  };
  if (reach.kind !== 'night') return { ...tile, reach, ...(info ? { info } : {}) };
  const r = reach;
  const tz = data.timeZone;
  const share = (at: number | null) =>
    at === null ? null : (at - data.now) / (r.sunAt - data.now);
  return {
    ...tile,
    reach,
    ...(info ? { info } : {}),
    sub:
      r.emptyAt !== null
        ? tx('empty', { at: time(r.emptyAt, tz), range: emptyRange(r, tz), n: r.n })
        : r.emptyEarly !== null
          ? tx('tight', { at: time(r.emptyEarly, tz), n: r.n })
          : tx('lasts', { at: time(r.sunAt, tz), n: r.n }),
    // the night as a line now → sun: the dot is "empty" (purple) or the sun (green), the band its spread
    graphic: {
      kind: 'scale',
      min: 0,
      max: 1,
      value: share(r.emptyAt) ?? 1,
      ...(r.emptyEarly !== null
        ? { band: { low: share(r.emptyEarly)!, high: share(r.emptyLate) ?? 1 } }
        : {}),
      color: r.emptyAt !== null ? 'var(--import)' : 'var(--battery)',
      ends: [tx('now'), tx('sun', { at: time(r.sunAt, tz) })],
    },
  };
}
