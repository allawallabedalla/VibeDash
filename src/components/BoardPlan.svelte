<script lang="ts">
  /**
   * Floor plan with live values (board section "plan"): the house's floors side
   * by side, rooms coloured by the chosen view. Light turns the house into a
   * night view where lit rooms glow; motion pulses in the room; a slider (with
   * play) replays today. Tap a room for its values. Geometry and values come
   * from the house service – nothing of the house is in this code.
   */
  import { onMount } from 'svelte';
  import type { BoardPlan } from '../model/board';
  import { colour, SCALES } from '../model/planColors';
  import { num, t, time } from '../i18n/index.svelte';
  import Segmented from './Segmented.svelte';

  let { plan, timeZone }: { plan: BoardPlan; timeZone: string } = $props();

  let viewId = $state('');
  $effect.pre(() => {
    if (!plan.views.some((v) => v.id === viewId)) viewId = plan.views[0]?.id ?? '';
  });
  const view = $derived(plan.views.find((v) => v.id === viewId) ?? plan.views[0]);
  let selected = $state<string | null>(null);
  // 2D plan or 3D model (three.js is loaded only when 3D is chosen)
  let mode = $state<'2d' | '3d'>('2d');

  // colour scales: shared with the 3D model (src/model/planColors.ts)

  // ── replay of today ──────────────────────────────────────────────────────────
  const tl = $derived(plan.timeline);
  const replayable = $derived(!!tl && (view?.kind === 'light' || view?.kind === 'presence'));
  let step = $state(Number.MAX_SAFE_INTEGER); // MAX = now (live values)
  const live = $derived(!tl || step >= tl.steps);
  let playing = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  function play() {
    if (!tl) return;
    if (playing) {
      clearInterval(timer);
      playing = false;
      return;
    }
    if (live) step = 0;
    playing = true;
    timer = setInterval(() => {
      if (step >= tl.steps - 1) {
        step = Number.MAX_SAFE_INTEGER;
        clearInterval(timer);
        playing = false;
      } else step++;
    }, 140);
  }
  onMount(() => () => clearInterval(timer));
  const stepTime = $derived(tl && !live ? tl.start + step * tl.stepMs : null);

  /** value of a room in the current view (live, or from the replay step) */
  function valueOf(id: string): number | null {
    if (!view) return null;
    if (replayable && tl && !live) {
      const arr = view.kind === 'light' ? tl.light[id] : tl.presence[id];
      if (!arr) return null;
      const on = arr[step] === 1;
      return view.kind === 'light' ? (on ? 1 : 0) : on ? 0 : null;
    }
    return view.values[id] ?? null;
  }
  function textOf(id: string): string {
    if (!view) return '';
    if (replayable && !live) return '';
    if (view.texts[id]) return view.texts[id]!;
    const v = view.values[id];
    if (v === null || v === undefined) return '';
    if (view.kind === 'light') return v ? t('fp.on') : '';
    if (view.kind === 'presence') return t('fp.minAgo', { m: num(v) });
    return `${num(v, view.kind === 'temp' ? 1 : 0)}${view.unit}`;
  }

  const night = $derived(view?.kind === 'light');
  const pct = (v: number, a: number, b: number) => ((v - a) / (b - a)) * 100;
  const path = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') + 'Z';
  const line = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const roomName = (id: string) =>
    plan.floors.flatMap((f) => f.rooms).find((r) => r.id === id)?.name ?? id;
  const legend = $derived.by(() => {
    if (!view) return null;
    const s = SCALES[view.kind];
    if (s) {
      return {
        gradient: `linear-gradient(90deg, ${s.map(([, c]) => c).join(', ')})`,
        low: `${num(s[0]![0])}${view.unit}`,
        high: `${num(s.at(-1)![0])}${view.unit}`,
      };
    }
    return null;
  });
</script>

<div class="plan" class:night>
  <div class="bar">
    {#if plan.views.length > 1}
      <div class="views">
        <Segmented
          options={plan.views.map((v) => ({ id: v.id, label: v.label }))}
          bind:value={viewId}
          label={t('fp.view')}
        />
      </div>
    {/if}
    {#if plan.model3d}
      <Segmented
        options={[
          { id: '2d', label: '2D' },
          { id: '3d', label: '3D' },
        ]}
        bind:value={() => mode, (v) => (mode = v as '2d' | '3d')}
        label={t('fp.mode')}
      />
    {/if}
    {#if plan.link}
      <a class="link" href={plan.link.url} target="_blank" rel="noopener noreferrer"
        >{plan.link.label}</a
      >
    {/if}
  </div>

  <div class="legend">
    {#if legend}
      <span>{legend.low}</span><span class="grad" style:background={legend.gradient}></span><span
        >{legend.high}</span
      >
    {:else if view?.kind === 'light'}
      <span class="dot lit"></span>{t('fp.lightOn')}<span class="dot dark"></span>{t('fp.lightOff')}
    {:else if view?.kind === 'presence'}
      <span class="dot pulse"></span>{t('fp.motion')}
    {:else if view?.kind === 'valve'}
      <span class="dot warm"></span>{t('fp.heating')}
    {/if}
  </div>

  {#if replayable && tl}
    <div class="replay">
      <button
        type="button"
        class="playbtn"
        onclick={play}
        aria-label={playing ? t('fp.pause') : t('fp.play')}
      >
        {#if playing}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
        {/if}
      </button>
      <input
        type="range"
        min="0"
        max={tl.steps}
        value={Math.min(step, tl.steps)}
        oninput={(e) => {
          const v = Number((e.currentTarget as HTMLInputElement).value);
          step = v >= tl.steps ? Number.MAX_SAFE_INTEGER : v;
        }}
        aria-label={t('fp.time')}
      />
      <span class="when">{stepTime !== null ? time(stepTime, timeZone) : t('fp.now')}</span>
    </div>
  {/if}

  {#if mode === '3d' && plan.model3d}
    {#await import('./Plan3D.svelte')}
      <p class="muted-note" role="status">{t('state.loading')}</p>
    {:then { default: Plan3D }}
      <Plan3D
        plan={{ ...plan, model3d: plan.model3d }}
        kind={view?.kind}
        {valueOf}
        {textOf}
        tick={[viewId, step, plan]}
        {selected}
        onselect={(id) => (selected = id)}
      />
    {/await}
  {:else}
    <div class="floors" class:two={plan.floors.length > 1}>
      {#each plan.floors as f (f.id)}
        {@const [x0, y0, x1, y1] = f.box}
        <figure class="floor">
          <figcaption>{f.name}</figcaption>
          <div class="canvas" style:aspect-ratio="{x1 - x0} / {y1 - y0}">
            <svg viewBox="{x0} {y0} {x1 - x0} {y1 - y0}" aria-hidden="true">
              <defs>
                <radialGradient id="glow-{f.id}" cx="50%" cy="50%" r="65%">
                  <stop offset="0%" stop-color="#fff3c4" />
                  <stop offset="55%" stop-color="#ffcf6b" />
                  <stop offset="100%" stop-color="#ff9f2e" />
                </radialGradient>
                <filter id="blur-{f.id}" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="0.35" />
                </filter>
              </defs>
              {#each f.rooms as r (r.id)}
                {@const v = valueOf(r.id)}
                {@const lit = view?.kind === 'light' && v === 1}
                {@const fill = view ? colour(view.kind, v) : null}
                {#if lit}
                  <path
                    class="halo"
                    d={path(r.polygon)}
                    filter="url(#blur-{f.id})"
                    fill="#ffc35a"
                  />
                {/if}
                <path
                  class="room k-{r.kind}"
                  class:lit
                  class:sel={selected === r.id}
                  d={path(r.polygon)}
                  style:fill={lit ? `url(#glow-${f.id})` : (fill ?? undefined)}
                  role="button"
                  tabindex="0"
                  aria-label={roomName(r.id)}
                  onclick={() => (selected = selected === r.id ? null : r.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selected = selected === r.id ? null : r.id;
                    }
                  }}
                />
                {#if view?.kind === 'presence' && v !== null && v <= 15}
                  <circle
                    class="pulse"
                    cx={r.label[0]}
                    cy={r.label[1]}
                    r="0.55"
                    style:opacity={Math.max(0.35, 1 - v / 15)}
                  />
                {/if}
              {/each}
              {#each f.walls as w, i (i)}
                <path class="wall" d={line(w)} />
              {/each}
            </svg>
            {#each f.rooms.filter((r) => r.kind !== 'void') as r (r.id)}
              {@const txt = textOf(r.id)}
              <div
                class="lbl"
                style:left="{pct(r.label[0], x0, x1)}%"
                style:top="{pct(r.label[1], y0, y1)}%"
              >
                <span class="name">{r.name}</span>
                {#if txt}<b>{txt}</b>{/if}
              </div>
            {/each}
          </div>
        </figure>
      {/each}
    </div>
  {/if}

  {#if selected}
    <section class="detail" aria-live="polite">
      <header>
        <b>{roomName(selected)}</b>
        <button
          type="button"
          class="x"
          onclick={() => (selected = null)}
          aria-label={t('info.close')}>×</button
        >
      </header>
      {#if plan.details[selected]?.length}
        <dl>
          {#each plan.details[selected]! as d (d.label)}<dt>{d.label}</dt>
            <dd>{d.value}</dd>{/each}
        </dl>
      {:else}
        <p class="muted-note">{t('board.empty')}</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .plan {
    --floor: color-mix(in srgb, var(--text) 4%, var(--surface));
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  /* the view switch scrolls sideways on narrow screens instead of widening the page */
  .views {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .views::-webkit-scrollbar {
    display: none;
  }
  .link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 4px;
    font-size: var(--small);
    color: var(--muted);
  }
  .grad {
    width: 140px;
    height: 8px;
    border-radius: 4px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.lit {
    background: radial-gradient(#fff3c4, #ff9f2e);
    box-shadow: 0 0 8px #ffb340;
  }
  .dot.dark {
    background: #1d2433;
    margin-left: 10px;
  }
  .dot.pulse {
    background: var(--home);
    animation: beat 1.8s ease-in-out infinite;
  }
  .dot.warm {
    background: #ff7a45;
  }
  .replay {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0;
  }
  .playbtn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: none;
  }
  .playbtn svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .replay input {
    flex: 1;
    accent-color: var(--sun);
    min-height: 44px;
  }
  .when {
    min-width: 52px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .floors {
    display: grid;
    gap: 16px;
    margin-top: 8px;
  }
  @media (min-width: 900px) {
    .floors.two {
      grid-template-columns: 1fr 1fr;
    }
  }
  .floor {
    margin: 0;
  }
  figcaption {
    font-size: var(--small);
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .canvas {
    position: relative;
    width: 100%;
    border-radius: 14px;
    overflow: hidden;
    transition: background 0.8s ease;
  }
  .night .canvas {
    background: #0f1420;
  }
  .canvas > svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .room {
    fill: var(--floor);
    stroke: none;
    cursor: pointer;
    transition:
      fill 0.6s ease,
      opacity 0.6s ease;
    outline: none;
  }
  /* outside: a light tint only, so the house stays the main thing */
  .room.k-outside {
    fill: transparent;
    fill-opacity: 0.28;
  }
  .room.k-void {
    fill: transparent;
    pointer-events: none;
  }
  .room.k-stairs {
    fill: color-mix(in srgb, var(--text) 8%, var(--surface));
  }
  .night .room:not(.lit) {
    fill: #1d2433;
  }
  .night .room.k-outside:not(.lit),
  .night .room.k-void {
    fill: transparent;
  }
  .room.sel,
  .room:focus-visible {
    stroke: var(--text);
    stroke-width: 0.12;
  }
  .halo {
    opacity: 0.85;
    pointer-events: none;
  }
  .wall {
    fill: none;
    stroke: var(--text);
    stroke-width: 0.09;
    stroke-linejoin: round;
    stroke-linecap: round;
    opacity: 0.75;
    pointer-events: none;
  }
  .night .wall {
    stroke: #8a93a8;
  }
  .pulse {
    fill: var(--home);
    transform-box: fill-box;
    transform-origin: center;
    animation: beat 1.8s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes beat {
    0%,
    100% {
      transform: scale(0.75);
    }
    50% {
      transform: scale(1.25);
    }
  }
  .lbl {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    text-align: center;
    line-height: 1.1;
    white-space: nowrap;
  }
  .lbl .name {
    font-size: 12px;
    color: var(--text-2);
  }
  .lbl b {
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-shadow: 0 0 6px var(--surface);
  }
  .night .lbl .name {
    color: #b8c0d4;
  }
  .night .lbl b {
    color: #fff;
    text-shadow: 0 0 6px #0f1420;
  }
  @media (max-width: 600px) {
    .lbl .name {
      display: none;
    }
    .lbl b {
      font-size: 14px;
    }
  }
  .detail {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .detail header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .x {
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 24px;
    cursor: pointer;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 4px 0 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse,
    .dot.pulse {
      animation: none;
    }
    .room,
    .canvas {
      transition: none;
    }
  }
</style>
