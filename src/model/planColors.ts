/**
 * Colours of the floor plan views, shared by the 2D plan and the 3D model:
 * temperature from cool blue to warm red, humidity from dry amber via green
 * to wet violet, an open heating valve as warm orange.
 */
import type { PlanViewKind } from './board';

type Stop = [number, string];
export const SCALES: Partial<Record<PlanViewKind, Stop[]>> = {
  temp: [
    [16, '#4a7fd4'],
    [19, '#4fb3d9'],
    [21, '#34c77b'],
    [23, '#f5b041'],
    [25, '#e8553a'],
    [27, '#b0302a'],
  ],
  humidity: [
    [30, '#e0a100'],
    [40, '#a8c66c'],
    [50, '#34c77b'],
    [60, '#4fb3d9'],
    [70, '#5e5ce6'],
    [80, '#af52de'],
  ],
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, f: number) => {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * f)).join(',')})`;
};

/** CSS colour of a value in a view, or null when it has none (no value, valve closed …). */
export function colour(kind: PlanViewKind, v: number | null): string | null {
  if (v === null) return null;
  const s = SCALES[kind];
  if (s) {
    if (v <= s[0]![0]) return s[0]![1];
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i]![0])
        return mix(s[i - 1]![1], s[i]![1], (v - s[i - 1]![0]) / (s[i]![0] - s[i - 1]![0]));
    }
    return s.at(-1)![1];
  }
  if (kind === 'valve') return v > 0 ? `rgba(255,122,69,${Math.min(0.9, 0.15 + v / 120)})` : null;
  return null;
}
