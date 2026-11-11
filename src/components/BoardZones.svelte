<script lang="ts">
  /**
   * Area picker on a board (section "zones"): one floor of the plan, the areas
   * the house already knows, blocked parts hatched. "Neuer Bereich" turns the
   * plan into a drawing surface: drag a rectangle (finger or mouse), name it,
   * pick a mode, save – POST /api/board/<id>/action { item, action: "zone",
   * zone: { name, rect, mode } }. Own areas can be removed. Geometry comes from
   * the house service; nothing of the house is in this code. Loaded only where a
   * board has such a section (first-page budget).
   */
  import type { BoardZones, ZoneRect } from '../model/board';
  import { i18n, num } from '../i18n/index.svelte';
  import Segmented from './Segmented.svelte';

  let { board, zones, onchanged }: { board: string; zones: BoardZones; onchanged: () => void } =
    $props();

  const TEXT = {
    de: {
      add: 'Neuer Bereich',
      hint: 'Ein Rechteck auf den Plan ziehen.',
      name: 'Name',
      placeholder: 'z. B. Unter dem Esstisch',
      mode: 'Wie putzen',
      save: 'Speichern',
      cancel: 'Abbrechen',
      saving: 'Speichert …',
      remove: 'Löschen',
      sure: 'Wirklich löschen?',
      small: 'Zu klein – größer aufziehen.',
      blocked: 'Berührt eine gesperrte Fläche.',
      failed: 'Nicht gespeichert – bitte noch einmal.',
      blockedLegend: 'gesperrt',
      fixed: 'fest eingerichtet',
      size: (w: string, h: string) => `${w} × ${h} m`,
    },
    en: {
      add: 'New area',
      hint: 'Drag a rectangle on the plan.',
      name: 'Name',
      placeholder: 'e.g. under the table',
      mode: 'How to clean',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving …',
      remove: 'Remove',
      sure: 'Really remove?',
      small: 'Too small – draw it larger.',
      blocked: 'Touches a blocked part.',
      failed: 'Not saved – please try again.',
      blockedLegend: 'blocked',
      fixed: 'set up by the house',
      size: (w: string, h: string) => `${w} × ${h} m`,
    },
  };
  const tx = $derived(TEXT[i18n.locale === 'de' ? 'de' : 'en']);

  const MIN = 0.3; // metres, the house refuses smaller areas
  const STEP = 0.05; // snap to 5 cm
  const [bx0, by0, bx1, by1] = $derived(zones.floor.box);

  let drawing = $state(false);
  let rect = $state<ZoneRect | null>(null);
  let start = $state<[number, number] | null>(null);
  let name = $state('');
  let mode = $state('');
  $effect.pre(() => {
    if (!zones.modes.some((m) => m.value === mode)) mode = zones.modes[0]?.value ?? '';
  });
  let busy = $state(false);
  let message = $state<{ text: string; bad: boolean } | null>(null);
  let picked = $state<string | null>(null);
  let confirm = $state(false);
  let svg = $state<SVGSVGElement | null>(null);

  const snap = (v: number) => Math.round(v / STEP) * STEP;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  function toPlan(e: PointerEvent): [number, number] | null {
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [snap(clamp(p.x, bx0, bx1)), snap(clamp(p.y, by0, by1))];
  }
  function down(e: PointerEvent) {
    if (!drawing) return;
    const p = toPlan(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    start = p;
    rect = [p[0], p[1], p[0], p[1]];
    message = null;
  }
  function move(e: PointerEvent) {
    if (!drawing || !start) return;
    const p = toPlan(e);
    if (!p) return;
    rect = [
      Math.min(start[0], p[0]),
      Math.min(start[1], p[1]),
      Math.max(start[0], p[0]),
      Math.max(start[1], p[1]),
    ];
  }
  function up() {
    start = null;
  }

  const w = $derived(rect ? rect[2] - rect[0] : 0);
  const h = $derived(rect ? rect[3] - rect[1] : 0);
  const tooSmall = $derived(!!rect && (w < MIN || h < MIN));
  const hitsBlocked = $derived(
    !!rect &&
      zones.blocked.some(
        (b) =>
          Math.min(rect![2], b[2]) > Math.max(rect![0], b[0]) &&
          Math.min(rect![3], b[3]) > Math.max(rect![1], b[1]),
      ),
  );
  const canSave = $derived(!!rect && !tooSmall && !hitsBlocked && name.trim().length > 0 && !busy);

  function begin() {
    drawing = true;
    rect = null;
    name = '';
    picked = null;
    message = null;
  }
  function cancel() {
    drawing = false;
    rect = null;
    start = null;
  }

  async function send(zone: unknown): Promise<{ ok: boolean; text: string }> {
    const r = await fetch(`/api/board/${board}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: zones.id, action: 'zone', zone }),
      signal: AbortSignal.timeout(20_000),
    });
    const b = (await r.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
    return { ok: r.ok && b?.ok !== false, text: b?.text || '' };
  }
  async function save() {
    if (!canSave || !rect) return;
    busy = true;
    try {
      const r = await send({ name: name.trim(), rect, mode });
      message = { text: r.text || (r.ok ? '' : tx.failed), bad: !r.ok };
      if (r.ok) {
        cancel();
        onchanged();
      }
    } catch {
      message = { text: tx.failed, bad: true };
    } finally {
      busy = false;
    }
  }
  async function remove(id: string) {
    if (!confirm) {
      confirm = true;
      return;
    }
    busy = true;
    try {
      const r = await send({ remove: id });
      message = { text: r.text || (r.ok ? '' : tx.failed), bad: !r.ok };
      if (r.ok) {
        picked = null;
        onchanged();
      }
    } catch {
      message = { text: tx.failed, bad: true };
    } finally {
      busy = false;
      confirm = false;
    }
  }

  const pct = (v: number, a: number, b: number) => ((v - a) / (b - a)) * 100;
  const path = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') + 'Z';
  const line = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const pickedZone = $derived(zones.zones.find((z) => z.id === picked) ?? null);
  const hatch = $derived(`hatch-${zones.id.replace(/[^a-z0-9]/gi, '')}`);
</script>

<div class="zones">
  <div class="bar">
    {#if drawing}
      <p class="hint" role="status">{tx.hint}</p>
      <button type="button" class="ghost" onclick={cancel}>{tx.cancel}</button>
    {:else}
      <button type="button" class="primary" onclick={begin}>{tx.add}</button>
    {/if}
  </div>

  <div
    class="canvas"
    class:drawing
    style:aspect-ratio="{bx1 - bx0} / {by1 - by0}"
    style:width="min(100%, calc(70vh * {(bx1 - bx0) / (by1 - by0)}))"
  >
    <svg
      bind:this={svg}
      viewBox="{bx0} {by0} {bx1 - bx0} {by1 - by0}"
      role="img"
      aria-label={zones.floor.name}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <defs>
        <pattern
          id={hatch}
          width="0.4"
          height="0.4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="0.4" class="hatchline" />
        </pattern>
      </defs>
      {#each zones.floor.rooms as r (r.id)}
        <path class="room k-{r.kind}" d={path(r.polygon)} />
      {/each}
      {#each zones.floor.walls as wl, i (i)}
        <path class="wall" d={line(wl)} />
      {/each}
      {#each zones.blocked as b, i (i)}
        <rect
          class="blocked"
          x={b[0]}
          y={b[1]}
          width={b[2] - b[0]}
          height={b[3] - b[1]}
          fill="url(#{hatch})"
        />
      {/each}
      {#each zones.zones as z (z.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <rect
          class="zone"
          class:own={z.own}
          class:sel={picked === z.id}
          x={z.rect[0]}
          y={z.rect[1]}
          width={z.rect[2] - z.rect[0]}
          height={z.rect[3] - z.rect[1]}
          rx="0.15"
          role="button"
          tabindex="-1"
          aria-label={z.name}
          onclick={() => {
            if (drawing) return;
            picked = picked === z.id ? null : z.id;
            confirm = false;
          }}
        />
      {/each}
      {#if rect}
        <rect
          class="draft"
          class:bad={tooSmall || hitsBlocked}
          x={rect[0]}
          y={rect[1]}
          width={w}
          height={h}
          rx="0.15"
        />
      {/if}
    </svg>
    {#each zones.floor.rooms.filter((r) => r.kind === 'room') as r (r.id)}
      <span
        class="room-name"
        style:left="{pct(r.label[0], bx0, bx1)}%"
        style:top="{pct(r.label[1], by0, by1)}%">{r.name}</span
      >
    {/each}
    {#each zones.zones as z (z.id)}
      <span
        class="zone-name"
        style:left="{pct((z.rect[0] + z.rect[2]) / 2, bx0, bx1)}%"
        style:top="{pct((z.rect[1] + z.rect[3]) / 2, by0, by1)}%">{z.name}</span
      >
    {/each}
  </div>
  {#if zones.blocked.length}
    <p class="legend"><span class="swatch"></span>{tx.blockedLegend}</p>
  {/if}

  {#if drawing && rect && !start}
    <form
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p class="size" class:bad={tooSmall || hitsBlocked}>
        {tooSmall ? tx.small : hitsBlocked ? tx.blocked : tx.size(num(w, 1), num(h, 1))}
      </p>
      <label>
        <span>{tx.name}</span>
        <input bind:value={name} maxlength="24" placeholder={tx.placeholder} autocomplete="off" />
      </label>
      {#if zones.modes.length > 1}
        <Segmented
          options={zones.modes.map((m) => ({ id: m.value, label: m.label }))}
          bind:value={mode}
          label={tx.mode}
        />
      {/if}
      <div class="buttons">
        <button type="submit" class="primary" disabled={!canSave}
          >{busy ? tx.saving : tx.save}</button
        >
        <button type="button" class="ghost" onclick={cancel}>{tx.cancel}</button>
      </div>
    </form>
  {/if}

  {#if pickedZone && !drawing}
    <section class="detail" aria-live="polite">
      <b>{pickedZone.name}</b>
      <span class="muted"
        >{tx.size(
          num(pickedZone.rect[2] - pickedZone.rect[0], 1),
          num(pickedZone.rect[3] - pickedZone.rect[1], 1),
        )}</span
      >
      {#if pickedZone.own}
        <button
          type="button"
          class="ghost danger"
          disabled={busy}
          onclick={() => void remove(pickedZone.id)}>{confirm ? tx.sure : tx.remove}</button
        >
      {:else}
        <span class="muted">{tx.fixed}</span>
      {/if}
    </section>
  {/if}
  {#if message?.text}<p class="msg" class:bad={message.bad} role="status">{message.text}</p>{/if}
</div>

<style>
  .zones {
    --floor: color-mix(in srgb, var(--text) 4%, var(--surface));
    display: grid;
    gap: 10px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
  }
  button {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 22px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--battery);
    color: var(--surface);
  }
  .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ghost {
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--text);
  }
  .danger {
    border-color: var(--act, #c0392b);
    color: var(--act, #c0392b);
  }
  .canvas {
    position: relative;
    margin: 0 auto;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .drawing svg {
    touch-action: none;
    cursor: crosshair;
  }
  .room {
    fill: var(--floor);
  }
  .room.k-outside,
  .room.k-void {
    fill: transparent;
  }
  .room.k-stairs {
    fill: color-mix(in srgb, var(--text) 8%, var(--surface));
  }
  .wall {
    fill: none;
    stroke: var(--text);
    stroke-width: 0.09;
    stroke-linejoin: round;
    stroke-linecap: round;
    opacity: 0.75;
  }
  .hatchline {
    stroke: var(--muted);
    stroke-width: 0.06;
  }
  .blocked {
    stroke: var(--muted);
    stroke-width: 0.04;
    stroke-dasharray: 0.15 0.1;
    opacity: 0.8;
    pointer-events: none;
  }
  .zone {
    fill: color-mix(in srgb, var(--battery) 14%, transparent);
    stroke: var(--battery);
    stroke-width: 0.06;
    stroke-dasharray: 0.2 0.12;
    cursor: pointer;
  }
  .zone.own {
    stroke-dasharray: none;
    fill: color-mix(in srgb, var(--battery) 22%, transparent);
  }
  .zone.sel {
    stroke-width: 0.12;
  }
  .drawing .zone {
    pointer-events: none;
    opacity: 0.6;
  }
  .draft {
    fill: color-mix(in srgb, var(--battery) 30%, transparent);
    stroke: var(--battery);
    stroke-width: 0.1;
    pointer-events: none;
  }
  .draft.bad {
    fill: color-mix(in srgb, var(--act, #c0392b) 22%, transparent);
    stroke: var(--act, #c0392b);
  }
  .room-name,
  .zone-name {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    white-space: nowrap;
    font-size: var(--small, 0.8rem);
  }
  .room-name {
    color: var(--muted);
    opacity: 0.8;
  }
  .zone-name {
    font-weight: 600;
    color: var(--text);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    padding: 0 4px;
    border-radius: 6px;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--small, 0.8rem);
    color: var(--muted);
  }
  .swatch {
    width: 18px;
    height: 12px;
    border-radius: 3px;
    background: repeating-linear-gradient(45deg, var(--muted) 0 1.5px, transparent 1.5px 5px);
  }
  .form {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    background: var(--surface-2, var(--surface));
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .form label {
    display: grid;
    gap: 4px;
  }
  .form label span {
    font-size: var(--small, 0.8rem);
    color: var(--muted);
  }
  input {
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .size {
    margin: 0;
    font-weight: 600;
  }
  .size.bad,
  .msg.bad {
    color: var(--act, #c0392b);
  }
  .detail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .muted {
    color: var(--muted);
  }
  .msg {
    margin: 0;
  }
</style>
