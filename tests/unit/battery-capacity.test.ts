import { describe, expect, it } from 'vitest';
import { steadyValue } from '../../src/model/series';

const at = (vs: number[]) => vs.map((v, i) => ({ t: i * 60_000, v }));
const opts = { min: 1, maxJump: 0.1 };

describe('steadyValue (nominal battery capacity)', () => {
  it('drops a read error to 0 and holds the last valid value', () => {
    expect(steadyValue(at([9.6, 9.6, 0, 9.6]), opts)).toBe(9.6);
    expect(steadyValue(at([9.6, 0]), opts)).toBe(9.6);
  });

  it('drops values below 1 and single jumps over 10 %', () => {
    expect(steadyValue(at([0.5, 9.6, 40, 9.6]), opts)).toBe(9.6);
    expect(steadyValue(at([0, 0.2]), opts)).toBeNull();
  });

  it('accepts a new value that holds for three samples (a real change)', () => {
    expect(steadyValue(at([5, 10, 10, 10]), opts)).toBe(10);
    expect(steadyValue(at([5, 10, 10]), opts)).toBe(5);
  });
});
