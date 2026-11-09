<script lang="ts">
  /**
   * Compare two values on a board: two pickers (grouped, with a search field each, for long lists), the
   * resolution (e.g. hours / days) and a button. The button sends { pair: { a, b, level } } to this server
   * (POST /api/board/<id>/calc), which passes it to the house service; the answer (ordinary sections) is shown
   * right below by the page. Only a calculation – nothing is switched or stored.
   */
  import type { BoardPair, BoardSection } from '../model/board';
  import { i18n } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';

  let {
    board,
    pair,
    onresult,
  }: {
    board: string;
    pair: BoardPair;
    onresult: (r: { sections: BoardSection[]; label: string } | null) => void;
  } = $props();

  // own texts: this part is loaded only where a board has a pair picker (first-page budget)
  const TEXT = {
    de: {
      first: 'Erster Wert',
      second: 'Zweiter Wert',
      search: 'Suchen …',
      level: 'Auflösung',
      none: 'nichts gefunden',
      pick: 'bitte wählen',
      running: 'Rechnet …',
      same: 'Zwei verschiedene Werte wählen',
      failed: 'Rechnung gescheitert – nochmal versuchen',
      busy: 'Rechnet gerade schon – gleich nochmal',
      other: 'Weitere',
    },
    en: {
      first: 'First value',
      second: 'Second value',
      search: 'Search …',
      level: 'Resolution',
      none: 'nothing found',
      pick: 'please choose',
      running: 'Calculating …',
      same: 'Choose two different values',
      failed: 'Calculation failed – try again',
      busy: 'Already calculating – try again shortly',
      other: 'Other',
    },
  };
  const tx = $derived(TEXT[i18n.locale]);

  // the user's choice survives the two-minute reloads of the board
  let level = $state<string | null>(null);
  let a = $state<string | null>(null);
  let b = $state<string | null>(null);
  let qa = $state('');
  let qb = $state('');
  let busy = $state(false);
  let failed = $state<string | null>(null);

  const lv = $derived(level && pair.levels.some((l) => l.value === level) ? level : pair.level);
  const usable = $derived(pair.options.filter((o) => !o.levels || o.levels.includes(lv)));
  const has = (v: string | null) => v !== null && usable.some((o) => o.value === v);
  const va = $derived(has(a) ? a : has(pair.a) ? pair.a : null);
  const vb = $derived(has(b) ? b : has(pair.b) ? pair.b : null);
  const labelOf = (v: string | null) => pair.options.find((o) => o.value === v)?.label ?? '';

  const norm = (s: string) =>
    s.toLocaleLowerCase(i18n.locale).normalize('NFD').replace(/\p{M}/gu, '');
  /** options grouped in their order; the search keeps the chosen one so the select never jumps */
  function groups(q: string, keep: string | null) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const out: { name: string; options: BoardPair['options'] }[] = [];
    for (const o of usable) {
      const hay = norm(`${o.label} ${o.group ?? ''}`);
      if (o.value !== keep && !words.every((w) => hay.includes(w))) continue;
      const name = o.group ?? tx.other;
      let g = out.find((x) => x.name === name);
      if (!g) out.push((g = { name, options: [] }));
      g.options.push(o);
    }
    return out;
  }
  const ga = $derived(groups(qa, va));
  const gb = $derived(groups(qb, vb));

  async function run() {
    failed = null;
    if (!va || !vb) return;
    if (va === vb) {
      failed = tx.same;
      return;
    }
    busy = true;
    try {
      const r = await fetch(`/api/board/${board}/calc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: { a: va, b: vb, level: lv } }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await r.json().catch(() => null)) as { sections?: BoardSection[] } | null;
      if (r.status === 429) failed = tx.busy;
      else if (!r.ok || !body?.sections) failed = tx.failed;
      else onresult({ sections: body.sections, label: `${labelOf(va)} · ${labelOf(vb)}` });
    } catch {
      failed = tx.failed;
    } finally {
      busy = false;
    }
  }
</script>

<div class="pair">
  {#if pair.levels.length > 1}
    <div class="lv">
      <Segmented
        options={pair.levels.map((l) => ({ id: l.value, label: l.label }))}
        bind:value={() => lv, (v) => ((level = v), (failed = null))}
        label={tx.level}
      />
    </div>
  {/if}
  <div class="pick">
    {#each [{ key: 'a', title: tx.first, list: ga, value: va }, { key: 'b', title: tx.second, list: gb, value: vb }] as p (p.key)}
      <div class="one">
        <label class="label" for="pair-{board}-{p.key}">{p.title}</label>
        <input
          type="search"
          placeholder={tx.search}
          aria-label="{p.title}: {tx.search}"
          value={p.key === 'a' ? qa : qb}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            if (p.key === 'a') qa = v;
            else qb = v;
          }}
          disabled={busy}
        />
        <select
          id="pair-{board}-{p.key}"
          value={p.value ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value || null;
            if (p.key === 'a') a = v;
            else b = v;
            failed = null;
          }}
          disabled={busy}
        >
          {#if !p.value}<option value="">{tx.pick}</option>{/if}
          {#each p.list as g (g.name)}
            <optgroup label={g.name}>
              {#each g.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </optgroup>
          {/each}
          {#if !p.list.length}<option value="" disabled>{tx.none}</option>{/if}
        </select>
      </div>
    {/each}
  </div>
  <div class="row">
    <button type="button" class="b main" onclick={() => void run()} disabled={busy || !va || !vb}>
      <Icon name={busy ? 'clock' : 'target'} size={16} />{busy ? tx.running : pair.button}
    </button>
    {#if failed}<span class="fail" role="status">{failed}</span>{/if}
  </div>
</div>

<style>
  .pair {
    display: grid;
    gap: 12px;
  }
  .pick {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 16px;
  }
  @media (max-width: 640px) {
    .pick {
      grid-template-columns: 1fr;
    }
  }
  .one {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .label {
    color: var(--muted);
    font-size: var(--small);
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  input {
    min-height: 38px;
    background: var(--surface-2);
  }
  select {
    cursor: pointer;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }
  .b {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--line);
    border-radius: 22px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 16px;
    cursor: pointer;
  }
  .b:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .fail {
    color: var(--fair-text);
    font-size: var(--small);
  }
</style>
