import { describe, expect, it } from 'vitest';
import { energyFlows } from '../../src/model/flows';

const w = (r: ReturnType<typeof energyFlows>, from: string, to: string) =>
  Math.round(r.flows.find((f) => f.from === from && f.to === to)?.w ?? 0);

describe('energy flows: who feeds whom', () => {
  it('sunny noon, battery full, car charging: sun feeds house, car and grid', () => {
    const r = energyFlows({ pv: 10_000, load: 5_000, battery: 0, grid: 5_000, car: 4_300 });
    expect(r.house).toBe(700);
    expect(w(r, 'sun', 'house')).toBe(700);
    expect(w(r, 'sun', 'car')).toBe(4_300);
    expect(w(r, 'sun', 'grid')).toBe(5_000);
    expect(r.flows).toHaveLength(3);
  });

  it('evening: battery and grid share house and car, nothing invented', () => {
    const r = energyFlows({ pv: 0, load: 5_000, battery: -3_000, grid: -2_000, car: 4_000 });
    expect(w(r, 'battery', 'house')).toBe(1_000);
    expect(w(r, 'battery', 'car')).toBe(2_000);
    expect(w(r, 'grid', 'car')).toBe(2_000);
    expect(w(r, 'sun', 'car')).toBe(0);
    expect(r.battery).toBe(-3_000);
    expect(r.grid).toBe(-2_000);
  });

  it('morning: sun covers the house and charges the battery', () => {
    const r = energyFlows({ pv: 3_000, load: 800, battery: 2_200, grid: 0, car: null });
    expect(r.car).toBeNull();
    expect(w(r, 'sun', 'house')).toBe(800);
    expect(w(r, 'sun', 'battery')).toBe(2_200);
  });

  it('meter noise under 50 W is no flow', () => {
    const r = energyFlows({ pv: 30, load: 400, battery: -390, grid: -20, car: 0 });
    expect(r.sun).toBe(0);
    expect(w(r, 'battery', 'house')).toBe(390);
    expect(r.flows.every((f) => f.w >= 50)).toBe(true);
  });
});
