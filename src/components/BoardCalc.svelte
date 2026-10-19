<script lang="ts">
  /**
   * A calculator on a board: weekday buttons (optional, today first), a slider and a button. The button sends the value
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
    timeZone,
    hideLabel = false,
    onresult,
  }: {
    board: string;
    calc: BoardCalc;
    timeZone: string;
    /** the card above already says it */
    hideLabel?: boolean;
    onresult: (r: { sections: BoardSection[]; label: string } | null) => void;
  } = $props();

  // the slider keeps the user's choice across reloads of the board (until it leaves the range)
  let chosen = $state<number | null>(null);
  /** chosen day: 0 = today (preselected), 1 = tomorrow … */
  let day = $state(0);
  const days = $derived(calc.days ?? 0);
  // today the slider starts at "min" (now), other days at 0:00
  const lo = $derived(day === 0 ? calc.min : 0);
  const value = $derived(Math.min(calc.max, Math.max(lo, chosen === null ? calc.value : chosen)));
  /** short weekday names in the house's time zone, today first */
  const dayNames = $derived.by(() => {
    const f = new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'short',
      timeZone,
    });
    const long = new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'long',
      timeZone,
    });
    const now = Date.now();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
    );
    // steps of 24 h from today's noon never skip a weekday, also across a clock change
    const noon = now + (12 - hour) * 3_600_000;
    return Array.from({ length: days }, (_, k) => {
      const d = new Date(noon + k * 86_400_000);
      return { short: f.format(d).replace('.', ''), long: long.format(d) };
    });
  });
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
  /** minutes from 0:00 -> "16:30" / "morgen 06:15"; with weekday buttons the time of the chosen day */
  function show(v: number): string {
    if (calc.format !== 'clock') return `${v}${calc.unit ? ` ${calc.unit}` : ''}`;
    const d = Math.floor(v / 1440);
    const m = ((v % 1440) + 1440) % 1440;
    const hm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    return days || d !== 1 ? hm : `${tx.tomorrow} ${hm}`;
  }
  const sent = $derived(days ? day * 1440 + value : value);

  async function run() {
    busy = true;
    failed = null;
    const label = days ? `${dayNames[day]?.short ?? ''} ${show(value)}` : show(value);
    try {
      const r = await fetch(`/api/board/${board}/calc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: sent }),
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
  {#if days}
    <div class="days" role="radiogroup" aria-label={calc.label}>
      {#each dayNames as n, k (k)}
        <button
          type="button"
          role="radio"
          aria-checked={day === k}
          aria-label={n.long}
          class:on={day === k}
          disabled={busy}
          onclick={() => {
            day = k;
            failed = null;
          }}>{n.short}</button
        >
      {/each}
    </div>
  {/if}
  <div class="top">
    {#if !hideLabel}<span class="label">{calc.label}</span>{/if}
    <span class="val"
      >{#if days}<span class="wd">{dayNames[day]?.short}</span>{/if}{show(value)}</span
    >
  </div>
  <input
    type="range"
    min={lo}
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
    <span>{show(lo)}</span><span>{show(calc.max)}</span>
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
  .days {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 4px;
    margin-bottom: 4px;
  }
  .days button {
    min-height: 40px;
    min-width: 0;
    padding: 0 2px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--muted);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }
  .days button.on {
    background: var(--surface-2);
    color: var(--text);
    border-color: var(--battery);
    font-weight: 600;
  }
  .days button:disabled {
    cursor: default;
  }
  .wd {
    margin-right: 8px;
    color: var(--muted);
    font-weight: 500;
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
