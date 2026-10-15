import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The plan page parses GET /plan/{id}; the service test checks the same key list.
const contract = JSON.parse(readFileSync('tests/contract/plan-api-keys.json', 'utf8')) as {
  keys: string[];
};

describe('plan API contract (Audit01 P-02)', () => {
  it('the page parses exactly the keys the service sends', () => {
    const src = readFileSync('src/app/plan.ts', 'utf8');
    const body = src.slice(src.indexOf('export interface PlanApi'));
    const keys = [...body.slice(0, body.indexOf('\n}\n')).matchAll(/^ {2}([a-z_]+)\??:/gm)].map(
      (m) => m[1],
    );
    expect(keys.sort()).toEqual([...contract.keys].sort());
  });

  it('the screenshot mock carries every key, so a missing one cannot hide', () => {
    const mock = readFileSync('tests/visual/states.spec.ts', 'utf8');
    for (const k of contract.keys) expect(mock).toMatch(new RegExp(`\\b${k}:`));
  });
});
