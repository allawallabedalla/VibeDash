<script lang="ts">
  /**
   * A calculator on a board: a slider and a button. The button sends the value
   * to this server (POST /api/board/<id>/calc), which passes it to the house
   * service; the answer (ordinary sections) is handed to the page, which shows
   * it right below. Only a calculation – nothing is switched or stored.
   */
  import type { BoardCalc, BoardSection } from '../model/board';
  import { i18n } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let {
    board,
    calc,
    onresult,
  }: {
    board: string;
    calc: BoardCalc;
    onresult: (r: { sections: BoardSection[]; label: string } | null) => void;
  } = $props();

  // the slider keeps the user's choice across reloads of the board (until it leaves the range)
  let chosen = $state<number | null>(null);
  const value = $derived(
    chosen === null ? calc.value : Math.min(calc.max, Math.max(calc.min, chosen)),
  );
  // own texts: this part is loaded only where a board has a calculator (first-page budget)
  const TEXT = {
    de: {
      tomorrow: 'morgen',
      running: 'Rechnet …',
      failed: 'Rechnung gescheitert – nochmal versuchen',
      busy: 'Rechnet gerade schon – gleich nochmal',
    },
    en: {
      tomorrow: 'tomorrow',
      running: 'Calculating …',
      failed: 'Calculation failed – try again',
      busy: 'Already calculating – try again shortly',
    },
  };
  const tx = $derived(TEXT[i18n.locale]);
  let busy = $state(false);
  let failed = $state<string | null>(null);

  const pad = (n: number) => String(n).padStart(2, '0');
  /** minutes from today 0:00 -> "16:30" / "morgen 06:15" */
  function show(v: number): string {
    if (calc.format !== 'clock') return `${v}${calc.unit ? ` ${calc.unit}` : ''}`;
    const day = Math.floor(v / 1440);
    const m = ((v % 1440) + 1440) % 1440;
    const hm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    return day === 0 ? hm : day === 1 ? `${tx.tomorrow} ${hm}` : hm;
  }

  async function run() {
    busy = true;
    failed = null;
    const label = show(value);
    try {
      const r = await fetch(`/api/board/${board}/calc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await r.json().catch(() => null)) as { sections?: BoardSection[] } | null;
      if (r.status === 429) failed = tx.busy;
      else if (!r.ok || !body?.sections) failed = tx.failed;
      else onresult({ sections: body.sections, label });
    } catch {
      failed = tx.failed;
    } finally {
      busy = false;
    }
  }
</script>

<div class="calc">
  <div class="top">
    <span class="label">{calc.label}</span>
    <span class="val">{show(value)}</span>
  </div>
  <input
    type="range"
    min={calc.min}
    max={calc.max}
    step={calc.step}
    {value}
    oninput={(e) => {
      chosen = Number((e.currentTarget as HTMLInputElement).value);
      failed = null;
    }}
    aria-label={calc.label}
    aria-valuetext={show(value)}
    disabled={busy}
  />
  <div class="ends" aria-hidden="true">
    <span>{show(calc.min)}</span><span>{show(calc.max)}</span>
  </div>
  <div class="row">
    <button type="button" class="b main" onclick={() => void run()} disabled={busy}>
      <Icon name={busy ? 'clock' : 'target'} size={16} />{busy ? tx.running : calc.button}
    </button>
    {#if failed}<span class="fail" role="status">{failed}</span>{/if}
  </div>
</div>

<style>
  .calc {
    display: grid;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    color: var(--muted);
  }
  .val {
    font-size: 28px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  input {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--battery);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    font-size: var(--small);
    font-variant-numeric: tabular-nums;
    margin-top: -6px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-top: 4px;
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
