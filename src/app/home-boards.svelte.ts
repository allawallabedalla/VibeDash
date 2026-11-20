/**
 * Tiles of boards on the start page (mapping boards[].home): each such board is loaded when the
 * page opens and every two minutes while it is visible; the first tile of its section with slot
 * "home" stands next to the start page's own, a tap opens the board. The last answer on this device shows at once.
 */
import { onMount } from 'svelte';
import type { Board } from '../model/board';
import type { TileProps } from '../components/Tile.svelte';
import { store } from './data.svelte';
import { boardCache } from './loading';
import { router } from './router.svelte';
import { tileOf } from './board-tile';

export function homeTiles() {
  const tabs = $derived(store.boards.filter((b) => b.home));
  let boards = $state<Record<string, Board>>({});

  async function load() {
    for (const tab of tabs) {
      const cache = boardCache<Board>(tab.id);
      if (!boards[tab.id]) {
        const c = cache.read();
        if (c) boards = { ...boards, [tab.id]: c.b };
      }
      try {
        const r = await fetch(`/api/board/${tab.id}`, { signal: AbortSignal.timeout(25_000) });
        if (r.ok) {
          const b = (await r.json()) as Board;
          boards = { ...boards, [tab.id]: b };
          cache.write(b);
        }
      } catch {
        /* keep what is shown */
      }
    }
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 120_000);
    return () => clearInterval(timer);
  });
  // the board list comes with the first data: load as soon as it names a home board
  $effect(() => {
    if (tabs.some((t) => !boards[t.id])) void load();
  });

  const tiles = $derived(
    tabs.flatMap((tab) =>
      (boards[tab.id]?.sections ?? []).flatMap((s): TileProps[] =>
        s.type === 'tiles' && s.slot === 'home'
          ? s.tiles.slice(0, 1).map((x) => ({
              ...tileOf(x),
              open: { label: tab.title, go: () => router.go(`b/${tab.id}`) },
            }))
          : [],
      ),
    ),
  );
  return {
    get tiles() {
      return tiles;
    },
  };
}
