<script lang="ts">
  /**
   * One model: bar "correct" + trend sparkline ("is it getting better?") + n +
   * level (good / fair / poor / open). Shows accuracy, never "learning progress".
   */
  import { num, t } from '../i18n/index.svelte';
  import Sparkline from './Sparkline.svelte';

  interface Props {
    label: string;
    pct: number | null;
    n: number;
    /** Accuracy over time (e.g. weekly), oldest first; null = not assessable then. */
    history: (number | null)[];
    openFrom?: string;
    /**
     * Still collecting data: the only place a progress bar is shown
     * ("collecting data · 12 of 30 days · from approx. 3 Nov").
     */
    collecting?: { have: number; need: number; from: string };
    /** Extra fact, e.g. "beats the rule of thumb by 12 %" or "from backtest". */
    note?: string;
  }
  let { label, pct, n, history, openFrom, collecting, note }: Props = $props();

  type Level = 'good' | 'fair' | 'poor' | 'open';
  const level = $derived<Level>(
    pct === null ? 'open' : pct >= 75 ? 'good' : pct >= 50 ? 'fair' : 'poor',
  );
  const levelKey = {
    good: 'level.good',
    fair: 'level.fair',
    poor: 'level.poor',
    open: 'level.open',
  } as const;
  const color = $derived(`var(--${level})`);
</script>

<article class="card">
  <header>
    <span class="label">{label}</span>
    {#if !collecting}<span class="level {level}">{t(levelKey[level])}</span>{/if}
  </header>

  <div class="main">
    <div class="value">
      {#if collecting}
        <span class="open">{t('acc.collecting')}</span>
      {:else if pct === null}
        <span class="open">{t('progress.open')}</span>
      {:else}
        {num(pct)}<span class="unit">%</span><span class="word">{t('progress.correct')}</span>
      {/if}
    </div>
    <div class="trend">
      {#if history.filter((v) => v !== null).length >= 2}
        <Sparkline
          values={history}
          {color}
          min={0}
          max={100}
          height={36}
          label={t('progress.trend')}
        />
      {/if}
    </div>
  </div>

  <div
    class="bar"
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={pct ?? undefined}
    aria-valuetext={pct === null ? t('progress.open') : `${num(pct)} % ${t('progress.correct')}`}
  >
    {#if collecting}<div
        class="fill collecting"
        style:width="{Math.min(100, (collecting.have / collecting.need) * 100)}%"
      ></div>{:else if pct !== null}<div
        class="fill"
        style:width="{Math.max(2, pct)}%"
        style:background={color}
      ></div>{/if}
  </div>

  <div class="meta">
    {#if collecting}
      {t('acc.days', { have: collecting.have, need: collecting.need })} · {t('progress.from', {
        when: collecting.from,
      })}
    {:else}
      n = {n}{#if pct === null && openFrom}&nbsp;· {t('progress.from', { when: openFrom })}{/if}
    {/if}
    {#if note}<span class="note">{note}</span>{/if}
  </div>
</article>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .label {
    font-size: 15px;
  }
  .level {
    font-size: var(--small);
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    white-space: nowrap;
  }
  .level.good {
    color: var(--good);
  }
  .level.fair {
    color: var(--fair);
  }
  .level.poor {
    color: var(--poor);
  }
  .main {
    display: flex;
    align-items: flex-end;
    gap: 16px;
  }
  .value {
    font-size: 28px;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: 15px;
    font-weight: 500;
    color: var(--muted);
    margin-left: 3px;
  }
  .word {
    font-size: 15px;
    font-weight: 400;
    color: var(--muted);
    margin-left: 0.35em;
    letter-spacing: 0;
  }
  .open {
    font-weight: 500;
    color: var(--open);
  }
  .trend {
    flex: 1;
    min-width: 0;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 4px;
  }
  .fill.collecting {
    background: var(--open);
    opacity: 0.6;
  }
  .note {
    display: block;
  }
  .meta {
    font-size: var(--small);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
