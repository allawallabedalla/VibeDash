import { describe, expect, it } from 'vitest';
import { explainedBy, notesIn } from '../../src/model/notes';

const M = 60_000;
const move = { from: 100 * M, to: 133 * M, text: 'Umzug auf neuen Server' };

describe('known events (mapping notes)', () => {
  it('explain gaps inside them, with a little slack at the edges', () => {
    expect(explainedBy([move], 100 * M, 118 * M)).toBe(move);
    expect(explainedBy([move], 132 * M, 135 * M)).toBe(move);
    expect(explainedBy([move], 90 * M, 118 * M)).toBeNull();
    expect(explainedBy(undefined, 0, 1)).toBeNull();
  });

  it('are found for the range a chart shows', () => {
    expect(notesIn([move], 0, 101 * M)).toEqual([move]);
    expect(notesIn([move], 134 * M, 200 * M)).toEqual([]);
  });
});
