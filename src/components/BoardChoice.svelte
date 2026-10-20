<script lang="ts">
  /**
   * A choice on a board: a few options, one chosen (e.g. how cautious the
   * charge plan is). A tap sends POST /api/board/<id>/action { item, action:
   * "choose", value } to this server, which passes it to the board's service;
   * the board shows the stored choice on its next load. Loaded only where a
   * board has a choice (first-page budget).
   */
  import type { BoardChoice } from '../model/board';
  import { i18n } from '../i18n/index.svelte';

  let { board, choice, onchanged }: { board: string; choice: BoardChoice; onchanged: () => void } =
    $props();

  let busy = $state<string | null>(null);
  let failed = $state(false);
  // shown at once, before the board reloads; the board's answer wins after that
  let picked = $state<string | null>(null);
  const current = $derived(picked ?? choice.selected);
  $effect(() => {
    // a fresh board answer resets the local pick
    void choice.selected;
    picked = null;
  });
  const TEXT = {
    de: { failed: 'Nicht gespeichert – bitte noch einmal tippen.', saving: 'Speichert …' },
    en: { failed: 'Not saved – please tap again.', saving: 'Saving …' },
  };
  const tx = $derived(TEXT[i18n.locale === 'de' ? 'de' : 'en']);

  async function choose(value: string) {
    if (busy || value === current) return;
    busy = value;
    failed = false;
    try {
      const r = await fetch(`/api/board/${board}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: choice.id, action: 'choose', value }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      picked = value;
      onchanged();
    } catch {
      failed = true;
    } finally {
      busy = null;
    }
  }
</script>

<div class="choice" role="radiogroup">
  {#each choice.options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={current === o.value}
      class:on={current === o.value}
      disabled={busy !== null}
      onclick={() => void choose(o.value)}
    >
      <span class="label">{busy === o.value ? tx.saving : o.label}</span>
      {#if o.sub}<span class="sub">{o.sub}</span>{/if}
    </button>
  {/each}
</div>
{#if failed}<p class="failed" role="alert">{tx.failed}</p>{/if}

<style>
  .choice {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 56px;
    padding: 10px 12px;
    border: 1.5px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button.on {
    border-color: var(--battery);
    background: color-mix(in srgb, var(--battery) 12%, var(--surface));
  }
  button:disabled {
    cursor: progress;
  }
  .label {
    font-weight: 600;
  }
  .sub {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .failed {
    margin: 8px 0 0;
    color: var(--act, #c0392b);
    font-size: 0.9rem;
  }
</style>
