/**
 * While the house's series are still arriving one by one (data.svelte.ts), a tile without data says
 * "lädt …" instead of "keine Daten". A plain value on purpose: every arriving batch replaces the house data,
 * so the tiles are computed again anyway.
 */
export const loading = { pending: 0 };

/** Every n-th sample plus the last one – for the snapshot of the last visit (a few hundred points per series). */
export function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / (max - 1);
  const out: T[] = [];
  for (let k = 0; k < max - 1; k++) out.push(xs[Math.floor(k * step)]!);
  out.push(xs[xs.length - 1]!);
  return out;
}

/** A board's last answer on this device, for an instant page while the fresh one is fetched (≤ 24 h old). */
export function boardCache<T>(id: string): {
  read: () => { at: number; b: T } | null;
  write: (b: T) => void;
} {
  const key = `vibedash.board.${id}`;
  return {
    read: () => {
      try {
        const x = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; b: T } | null;
        return x && Date.now() - x.at < 24 * 3_600_000 ? x : null;
      } catch {
        return null;
      }
    },
    write: (b: T) => {
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), b }));
      } catch {
        /* full storage: just no instant page next time */
      }
    },
  };
}
