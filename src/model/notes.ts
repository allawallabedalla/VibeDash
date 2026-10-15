/**
 * Known events the person told us about (mapping "notes", e.g. a server
 * move): a gap inside one is no question, and charts name it instead.
 */
export interface Note {
  from: number;
  to: number;
  text: string;
}

/** Tolerance at the edges: a logger restarts a minute or two before or after. */
const SLACK = 5 * 60_000;

/** The note that explains [from, to] completely, if any. */
export function explainedBy(
  notes: readonly Note[] | undefined,
  from: number,
  to: number,
): Note | null {
  return notes?.find((n) => from >= n.from - SLACK && to <= n.to + SLACK) ?? null;
}

/** Notes that touch [from, to], oldest first. */
export function notesIn(notes: readonly Note[] | undefined, from: number, to: number): Note[] {
  return (notes ?? []).filter((n) => n.to >= from && n.from <= to).sort((a, b) => a.from - b.from);
}
