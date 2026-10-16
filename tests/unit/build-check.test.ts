import { describe, expect, it } from 'vitest';
import { newBuild } from '../../src/model/release';

describe('release check', () => {
  it('reloads only when a known build changes to another known build', () => {
    expect(newBuild('abc', 'def')).toBe(true);
    expect(newBuild('abc', 'abc')).toBe(false);
    expect(newBuild(null, 'def')).toBe(false);
    expect(newBuild('abc', null)).toBe(false);
    expect(newBuild('abc', '')).toBe(false);
  });
});
