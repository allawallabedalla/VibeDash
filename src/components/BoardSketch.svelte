<script lang="ts">
  /**
   * Hand-drawn looking side view (section "sketch"): per panel the outline of a
   * building (walls, roof, floors, rooms) as slightly wobbly double strokes, and
   * pins with their value. The wobble is seeded by the line itself, so the
   * drawing stays the same on every refresh. Labels are HTML on top of the SVG,
   * so their size does not shrink with the drawing on a phone. Geometry and names
   * come from the house's config; nothing of a house is in this code. Loaded only
   * where a board has such a section (first-page budget).
   */
  import type { BoardSketch } from '../model/board';
  import { BOARD_COLORS } from '../app/board-tile';

  let { sketch }: { sketch: BoardSketch } = $props();

  type Pt = [number, number];
  type Panel = BoardSketch['panels'][number];

  /** small deterministic random numbers (mulberry32) */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (pts: Pt[], pass: number) =>
    pts.reduce((h, [x, y]) => (Math.imul(h, 31) + Math.round(x * 97 + y * 89)) | 0, 7 + pass);

  /** one wobbly stroke along the polyline (screen units) */
  function wobble(pts: Pt[], pass: number, amp: number): string {
    const r = rng(hash(pts, pass));
    let d = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / 60));
      const nx = -(y1 - y0) / (len || 1);
      const ny = (x1 - x0) / (len || 1);
      // a little overshoot at the start, like a pen that lands early
      const o = (r() - 0.5) * amp;
      if (i === 0) d += `M${(x0 + nx * o).toFixed(1)},${(y0 + ny * o).toFixed(1)}`;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const fm = (k - 0.5) / n;
        const j = (r() - 0.5) * amp * 1.6;
        const e = k === n ? (r() - 0.5) * amp : (r() - 0.5) * amp;
        const cx = x0 + (x1 - x0) * fm + nx * j;
        const cy = y0 + (y1 - y0) * fm + ny * j;
        const ex = x0 + (x1 - x0) * f + nx * e;
        const ey = y0 + (y1 - y0) * f + ny * e;
        d += ` Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      }
    }
    return d;
  }

  const W = 600; // drawing width in SVG units; height follows the panel's box

  function view(p: Panel) {
    const [x0, y0, x1, y1] = p.box;
    const s = W / (x1 - x0);
    const H = (y1 - y0) * s;
    const at = ([x, y]: Pt): Pt => [(x - x0) * s, (y1 - y) * s];
    return {
      s,
      H,
      at,
      pct: ([x, y]: Pt) => [((x - x0) / (x1 - x0)) * 100, ((y1 - y) / (y1 - y0)) * 100],
    };
  }

  const STYLE = {
    wall: { w: 2.6, color: 'var(--text-2)', amp: 3 },
    room: { w: 1.8, color: 'var(--text-2)', amp: 2.4 },
    floor: { w: 1.6, color: 'var(--muted)', amp: 2.4 },
    ground: { w: 2.2, color: 'var(--muted)', amp: 2 },
  } as const;

  /** short hatch strokes below a ground line */
  function hatch(pts: Pt[]): string {
    let d = '';
    const r = rng(hash(pts, 9));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 16);
      for (let k = 0; k < n; k++) {
        const x = x0 + ((x1 - x0) * (k + 0.5)) / n;
        const y = y0 + ((y1 - y0) * (k + 0.5)) / n;
        d += ` M${x.toFixed(1)},${(y + 3).toFixed(1)} l${(-7 - r() * 3).toFixed(1)},${(9 + r() * 3).toFixed(1)}`;
      }
    }
    return d;
  }
</script>

<div class="sketch">
  {#if sketch.left || sketch.right}
    <div class="compass" aria-hidden="true">
      <span>← {sketch.left ?? ''}</span><span>{sketch.right ?? ''} →</span>
    </div>
  {/if}
  <div class="panels" style:--n={sketch.panels.length}>
    {#each sketch.panels as p, i (i)}
      {@const v = view(p)}
      <figure class="panel">
        <div class="draw" style:aspect-ratio={`${W} / ${v.H.toFixed(1)}`}>
          <svg viewBox={`0 0 ${W} ${v.H.toFixed(1)}`} role="img" aria-label={p.name}>
            {#each p.lines as l, k (k)}
              {@const pts = l.points.map(v.at)}
              {@const st = STYLE[l.kind]}
              {#if l.kind === 'ground'}
                <path d={hatch(pts)} class="hatch" />
              {/if}
              <path d={wobble(pts, 1, st.amp)} stroke={st.color} stroke-width={st.w} />
              <path
                d={wobble(pts, 2, st.amp)}
                stroke={st.color}
                stroke-width={st.w * 0.55}
                opacity="0.55"
              />
            {/each}
            {#each p.pins as q, k (k)}
              {@const [x, y] = v.at([q.x, q.y])}
              <circle
                cx={x}
                cy={y}
                r="9"
                fill={q.state === 'look' || q.state === 'open'
                  ? 'var(--surface)'
                  : BOARD_COLORS[q.color]}
                stroke={BOARD_COLORS[q.color]}
                stroke-width="3"
              />
            {/each}
          </svg>
          {#each p.labels as l, k (k)}
            {@const [lx, ly] = v.pct([l.x, l.y])}
            <span class="room" style:left={`${lx}%`} style:top={`${ly}%`}>{l.text}</span>
          {/each}
          {#each p.pins as q, k (k)}
            {@const [px, py] = v.pct([q.x, q.y])}
            <div
              class="pin"
              class:left={q.side === 'l'}
              class:silent={q.state === 'look' || q.state === 'open'}
              style:left={`${px}%`}
              style:top={`${py}%`}
            >
              <b
                >{q.value}{#if q.sub}<small>{q.sub}</small>{/if}</b
              >
              <span>{q.label}</span>
            </div>
          {/each}
        </div>
        <figcaption>{p.name}</figcaption>
      </figure>
    {/each}
  </div>
</div>

<style>
  .sketch {
    display: grid;
    gap: 6px;
  }
  .compass {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    font-size: var(--small);
  }
  .panels {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 520px));
    justify-content: center;
    gap: 20px;
  }
  @media (max-width: 700px) {
    .panels {
      grid-template-columns: 1fr;
    }
  }
  .panel {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .draw {
    position: relative;
    width: 100%;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hatch {
    stroke: var(--muted);
    stroke-width: 1.2;
    opacity: 0.5;
  }
  .room {
    position: absolute;
    transform: translate(-50%, -50%);
    color: var(--muted);
    font-size: var(--small);
    font-style: italic;
    white-space: nowrap;
    pointer-events: none;
  }
  .pin {
    position: absolute;
    transform: translate(12px, -50%);
    display: grid;
    line-height: 1.15;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    max-width: 48%;
  }
  .pin.left {
    transform: translate(calc(-100% - 12px), -50%);
    text-align: right;
  }
  .pin b {
    font-size: 15px;
    color: var(--text);
    white-space: nowrap;
  }
  .pin span {
    font-size: 13px;
    color: var(--text-2);
  }
  @media (max-width: 700px) {
    .pin b {
      font-size: 16px;
    }
    .pin span,
    .pin small {
      font-size: 14px;
    }
  }
  .pin small {
    font-size: 14px;
    font-weight: 400;
    color: var(--text-2);
    margin-left: 5px;
  }
  .pin.silent b {
    color: var(--muted);
  }
  figcaption {
    text-align: center;
    color: var(--text-2);
    font-weight: 600;
  }
</style>
