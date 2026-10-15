<script lang="ts">
  /**
   * One model: bar "correct" + trend sparkline ("is it getting better?") + n +
   * level (good / fair / poor / open). Shows accuracy, never "learning progress".
   */
  import { num, t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';
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
  const levelIcon = {
    good: 'okCircle',
    fair: 'lookCircle',
    poor: 'actCircle',
    open: 'clock',
  } as const;

  // Trend: last value against the one two steps earlier; under 3 points "same".
  const trend = $derived.by(() => {
    const v = history.filter((x): x is number => x !== null);
    if (v.length < 2) return null;
    const d = v[v.length - 1]! - v[Math.max(0, v.length - 3)]!;
    if (Math.abs(d) < 3) return { text: t('acc.same'), cls: '' };
    return d > 0
      ? { text: t('acc.better', { d: num(d) }), cls: 'up' }
      : { text: t('acc.worse', { d: num(-d) }), cls: 'down' };
  });
</script>

<article class="card lv-{level}" class:collecting>
  <header>
    {#if collecting}
      <span class="chip open"><Icon name="clock" size={16} />{t('acc.collecting')}</span>
    {:else}
      <span class="chip {level}"
        ><Icon name={levelIcon[level]} size={16} />{t(levelKey[level])}</span
      >
    {/if}
    {#if !collecting && pct !== null}<span class="n">n = {n}</span>{/if}
  </header>
  <div class="name">{label}</div>

  <div class="value">
    {#if collecting}
      <span class="open">{t('acc.collecting')}</span>
    {:else if pct === null}
      <span class="open">{t('progress.open')}</span>
    {:else}
      {num(pct)}<span class="unit">%</span><span class="word">{t('progress.correct')}</span>
    {/if}
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

  {#if !collecting && pct !== null && history.filter((v) => v !== null).length >= 2}
    <div class="spark">
      <div class="axis"><span>{t('acc.axisTop')}</span><span>0</span></div>
      <div class="plot">
        <Sparkline
          values={history}
          {color}
          min={0}
          max={100}
          height={40}
          label={t('progress.trend')}
        />
      </div>
    </div>
    <div class="foot">
      <span>{t('progress.trend')}</span>
      {#if trend}<span class="trend {trend.cls}">{trend.text}</span>{/if}
    </div>
  {/if}

  <div class="meta">
    {#if collecting}
      {t('acc.days', { have: collecting.have, need: collecting.need })} · {t('progress.from', {
        when: collecting.from,
      })}
    {:else if pct === null}
      n = {n}{#if openFrom}&nbsp;· {t('progress.from', { when: openFrom })}{/if}
    {/if}
    {#if note}<span class="note">{note}</span>{/if}
  </div>
</article>

<style>
  .card {
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow);
    padding: 12px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    border: 1.5px solid transparent;
  }
  .card.lv-poor:not(.collecting) {
    border-color: color-mix(in srgb, var(--poor) 45%, transparent);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 14px;
    font-weight: 700;
    color: var(--muted);
  }
  .chip.good {
    color: var(--good-text);
  }
  .chip.fair {
    color: var(--fair-text);
  }
  .chip.poor {
    color: var(--poor-text);
  }
  .n {
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .name {
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value {
    margin-top: 2px;
    font-size: 30px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: 16px;
    font-weight: 600;
    color: var(--muted);
    margin-left: 3px;
    letter-spacing: 0;
  }
  .word {
    font-size: var(--small);
    font-weight: 400;
    color: var(--muted);
    margin-left: 0.5em;
    letter-spacing: 0;
  }
  .open {
    font-size: 17px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0;
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--track);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 5px;
  }
  .fill.collecting {
    background: var(--open);
    opacity: 0.6;
  }
  .spark {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 44px;
    text-align: right;
    white-space: nowrap;
    font-size: var(--small);
    line-height: 1;
    color: var(--muted);
    flex: none;
  }
  .plot {
    flex: 1;
    min-width: 0;
    border-left: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin-left: 50px;
    font-size: var(--small);
    color: var(--muted);
  }
  .trend.up {
    color: var(--good-text);
    font-weight: 600;
  }
  .trend.down {
    color: var(--poor-text);
    font-weight: 600;
  }
  .note {
    display: block;
  }
  .meta {
    font-size: var(--small);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .meta:empty {
    display: none;
  }
</style>
