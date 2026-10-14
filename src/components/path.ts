export interface Point {
  x: number;
  y: number;
}

/**
 * Smooth path through points using monotone cubic interpolation
 * (Fritsch–Carlson): soft curves that never overshoot the data.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0]!;
  if (n === 1) return `M${f(p0.x)},${f(p0.y)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push((points[i + 1]!.y - points[i]!.y) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    m.push(
      a * b <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b),
    );
  }
  m.push(slope[n - 2]!);

  let d = `M${f(p0.x)},${f(p0.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${f(a.x + h)},${f(a.y + m[i]! * h)} ${f(b.x - h)},${f(b.y - m[i + 1]! * h)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** Split a series with nulls into runs of consecutive indices with values. */
export function runs(values: readonly (number | null)[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v !== null && start < 0) start = i;
    if (v === null && start >= 0) {
      out.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, end: values.length - 1 });
  return out;
}

const f = (v: number) => (Math.round(v * 10) / 10).toString();
