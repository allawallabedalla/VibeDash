<script lang="ts">
  /**
   * The lens over a bar chart: the bar under the pointer softly underlaid, a box with its
   * label ("13:00–13:15", "Mo. · bis jetzt") and value with unit, a gap "keine Daten",
   * the mean "Mittel x". Same handling as the line lens (Lens.svelte): the mouse follows,
   * leaving hides; a finger laid on and dragged sideways, the box above it, lifting
   * hides; arrow keys step, Home/End, Esc closes only the lens. Loaded on the first
   * touch, hover or focus of a bar chart (budget), then it listens on the host itself.
   */
  import { onMount } from 'svelte';
  import { num } from '../i18n/index.svelte';
  import { barBox, barIndex, barSpan, barText, type BarData } from './bar-lens';
  import { tl } from './lens-text';

  interface Props {
    /** the focusable wrapper the lens listens on and draws in */
    host: HTMLElement;
    /** the grid of the bars (inside host): its columns are the bars */
    grid: HTMLElement;
    /** the event that loaded the lens: shown right away */
    first: Event | null;
    data: BarData;
  }
  let { host, grid, first, data }: Props = $props();

  let idx = $state<number | null>(null);
  let geo = $state({ left: 0, width: 0, gap: 0, top: 0, height: 0, w: 0 });
  let finger = $state<{ x: number; y: number } | null>(null);
  let bw = $state(0);
  let bh = $state(0);

  const n = $derived(
    data.values?.length ?? data.parts?.length ?? data.ranges?.length ?? data.labels.length,
  );
  const box = $derived(
    idx === null
      ? null
      : barBox(idx, data, num, {
          noData: tl('noData'),
          notYet: tl('notYet'),
          soFar: tl('soFar'),
          mean: tl('mean'),
          total: tl('total'),
        }),
  );
  const said = $derived(box ? barText(box) : '');
  const col = $derived(idx === null ? null : barSpan(idx, geo.width, n, geo.gap));
  const cx = $derived(col ? geo.left + col.left + col.width / 2 : 0);
  /** the underlay: the bar and a little of its gaps, never thinner than 12 px (96 bars on a phone) */
  const hw = $derived(col ? Math.max(12, col.width + 2 * Math.min(3, geo.gap / 2)) : 0);

  /** the box: beside the bar (mouse, keys), above the finger (touch) – always inside */
  const pos = $derived.by(() => {
    const gap = 12;
    const maxL = Math.max(0, geo.w - bw);
    const half = (col?.width ?? 0) / 2;
    if (finger) {
      const above = finger.y - bh - 40;
      if (above >= -56) return { l: Math.min(maxL, Math.max(0, cx - bw / 2)), t: above };
      const l = cx > geo.w / 2 ? cx - half - gap - 30 - bw : cx + half + gap + 30;
      return { l: Math.min(maxL, Math.max(0, l)), t: 0 };
    }
    const right = cx + half + gap;
    const l = right + bw <= geo.w ? right : cx - half - gap - bw;
    return { l: Math.min(maxL, Math.max(0, l)), t: geo.top };
  });

  function measure() {
    const h = host.getBoundingClientRect();
    const r = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    // the columns lie inside the grid's padding (StackDayBars keeps room for the last label)
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    geo = {
      left: r.left - h.left + pl,
      width: r.width - pl - pr,
      gap: parseFloat(cs.columnGap) || 0,
      top: r.top - h.top,
      height: r.height,
      w: host.clientWidth,
    };
  }
  function at(clientX: number, clientY: number, touch: boolean) {
    if (!n) return;
    measure();
    const x = clientX - host.getBoundingClientRect().left - geo.left;
    if (x < -8 || x > geo.width + 8) return hide();
    idx = barIndex(x, geo.width, n, geo.gap);
    finger = touch ? { x: x + geo.left, y: clientY - host.getBoundingClientRect().top } : null;
  }
  function hide() {
    idx = null;
    finger = null;
  }
  /** the newest bar with a value: where the keys start */
  function lastFilled() {
    const v = data.values ?? data.parts ?? data.ranges ?? [];
    for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null && v[i] !== undefined) return i;
    return n - 1;
  }

  const pointer = (e: PointerEvent) => {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (e.type === 'pointermove' && touch && e.buttons === 0) return;
    at(e.clientX, e.clientY, touch);
  };
  function key(e: KeyboardEvent) {
    if (!n) return;
    if (e.key === 'Escape') {
      if (idx === null) return;
      // close the lens, not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      return hide();
    }
    const big = Math.max(1, Math.round(n / 12));
    const moves: Record<string, number> = {
      ArrowLeft: e.shiftKey ? -big : -1,
      ArrowRight: e.shiftKey ? big : 1,
      PageDown: -big,
      PageUp: big,
    };
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key in moves) next = idx === null ? lastFilled() : idx + moves[e.key]!;
    else return;
    e.preventDefault();
    measure();
    finger = null;
    idx = Math.max(0, Math.min(n - 1, next));
  }

  onMount(() => {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      host.addEventListener(type, fn);
      return () => host.removeEventListener(type, fn);
    };
    const off = [
      on('pointerdown', pointer),
      on('pointermove', pointer),
      on('pointerup', (e) => e.pointerType !== 'mouse' && hide()),
      on('pointercancel', hide),
      on('pointerleave', hide),
      on('keydown', key),
      on('blur', hide),
    ];
    if (first instanceof PointerEvent) pointer(first);
    else if (first instanceof KeyboardEvent) key(first);
    return () => off.forEach((f) => f());
  });
</script>

{#if col}
  <span
    class="hl"
    aria-hidden="true"
    style:left="{cx - hw / 2}px"
    style:width="{hw}px"
    style:top="{geo.top}px"
    style:height="{geo.height}px"
  ></span>
{/if}
<div
  class="box"
  class:shown={box !== null}
  bind:offsetWidth={bw}
  bind:offsetHeight={bh}
  style:left="{pos.l}px"
  style:top="{pos.t}px"
>
  {#if box}
    <p class="when">{box.when}</p>
    {#each box.rows as r, i (i)}
      <p class="row" class:gap={r.gap} class:mean={r.mean} class:total={r.total}>
        {#if r.color || r.mean}<span class="key" style:color={r.color ?? 'var(--text-2)'}
          ></span>{/if}
        {#if r.label}<span class="lab">{r.label}</span>{/if}
        <b>{r.value}</b>
      </p>
    {/each}
  {/if}
</div>
<p class="sr" aria-live="polite">{said}</p>

<style>
  .hl {
    position: absolute;
    z-index: -1;
    border-radius: 8px;
    background: var(--accent-bg);
    pointer-events: none;
  }
  .box {
    position: absolute;
    z-index: 2;
    display: none;
    /* its own width, not what is left right of it (the position keeps it inside) */
    width: max-content;
    max-width: min(300px, 100%);
    box-sizing: border-box;
    padding: 8px 12px;
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-high);
    font-size: 14px;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .box.shown {
    display: block;
  }
  .box p {
    margin: 0;
  }
  .when {
    font-weight: 600;
    margin-bottom: 2px !important;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
  }
  .lab {
    color: var(--text-2, var(--muted));
  }
  .row b {
    font-weight: 600;
  }
  .row.gap b,
  .row.gap {
    color: var(--muted);
    font-weight: 400;
  }
  .row.mean,
  .row.total + .row {
    border-top: 1px solid var(--line);
    margin-top: 3px !important;
    padding-top: 3px;
  }
  .key {
    width: 14px;
    height: 4px;
    border-radius: 2px;
    background: currentColor;
    flex: none;
  }
  .mean .key {
    background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    margin: 0;
  }
</style>
