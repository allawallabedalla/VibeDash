/**
 * A board tile (from a house service or module) as the props of VibeDash's own tile. Shared by the
 * board page and the start page (boards with mapping "home": their tiles of slot "home").
 */
import type { BoardColor, BoardTile } from '../model/board';
import { iconOf } from '../components/Icon.svelte';
import type { TileProps } from '../components/Tile.svelte';
import { t } from '../i18n/index.svelte';

export const BOARD_COLORS: Record<BoardColor, string> = {
  sun: 'var(--sun)',
  battery: 'var(--battery)',
  home: 'var(--home)',
  grid: 'var(--feed)',
  import: 'var(--import)',
  feed: 'var(--feed)',
  climate: 'var(--climate)',
  muted: 'var(--muted)',
};

export const tileOf = (x: BoardTile): TileProps => ({
  label: x.label,
  icon: iconOf(x.icon ?? 'info'),
  color: BOARD_COLORS[x.color ?? 'muted'],
  value: x.value,
  ...(x.unit ? { unit: x.unit } : {}),
  ...(x.sub ? { sub: x.sub } : {}),
  ...(x.approx ? { approx: true } : {}),
  ...(x.state === 'look' || x.state === 'act' ? { status: x.state } : {}),
  ...(x.state === 'open' ? { pending: t('board.open') } : {}),
  ...(x.info ? { info: x.info } : {}),
  ...(x.spark && x.spark.some((v) => v !== null)
    ? {
        graphic: {
          kind: 'spark' as const,
          values: x.spark,
          color: BOARD_COLORS[x.color ?? 'muted'],
          // a percentage on its own scale made 4 % look half full (Audit05 G5-03)
          ...(x.unit === '%' ? { min: 0, max: 100 } : {}),
          ...(x.sparkFrom !== undefined && x.sparkTo !== undefined
            ? { span: { from: x.sparkFrom, to: x.sparkTo } }
            : {}),
        },
      }
    : {}),
});
