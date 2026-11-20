/**
 * Made-up car charges of the demo household (Audit05 I-2): every few days 6–30 kWh,
 * split into sun / house battery / grid by how sunny that demo day was. Entirely
 * synthetic, seeded – no real car, no real house.
 */
import type { OriginDay } from '../model/charge-origin';
import { addDays, localDateKey, localMidnight } from '../model/time';
import { CLEAR_SKY_DAY_KWH, type DemoData } from './generate';
import { mulberry32 } from './random';
import { daily } from './views';

export interface DemoChargeDay extends OriginDay {
  /** kWh charged that day (0 = no charge) */
  kwh: number;
}

/** The last `n` local days (today last). Today's charge has no origin split yet. */
export function demoChargeDays(data: DemoData, n = 30): DemoChargeDay[] {
  const rand = mulberry32(7);
  const tz = data.timeZone;
  const today = localMidnight(data.now, tz);
  const pv = new Map(daily(data, 'pv_energy').map((d) => [d.day, d.value]));
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1), tz);
    const charges = rand() < 0.38;
    const kwh = charges ? Math.round((6 + rand() * 24) * 10) / 10 : 0;
    const sunny = Math.min(1, (pv.get(localDateKey(day, tz)) ?? 0) / CLEAR_SKY_DAY_KWH);
    const sun = Math.round(kwh * (0.15 + 0.6 * sunny) * 100) / 100;
    const battery = Math.round((kwh - sun) * (0.35 + 0.3 * rand()) * 100) / 100;
    const grid = Math.max(0, Math.round((kwh - sun - battery) * 100) / 100);
    if (i === n - 1) return { day, kwh, sun: null, battery: null, grid: null };
    return { day, kwh, sun, battery, grid };
  });
}
