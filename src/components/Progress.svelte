<script lang="ts">
  /**
   * Accuracy bar 0–100 % "correct". `pct = null` means not yet assessable and
   * is shown as "open", never as a fake 100 %.
   */
  import { num, t } from '../i18n/index.svelte';

  interface Props {
    label: string;
    pct: number | null;
    n: number;
    /** For open ratings: when it becomes assessable, e.g. "14 days". */
    openFrom?: string;
  }
  let { label, pct, n, openFrom }: Props = $props();

  const level = $derived(pct === null ? 'open' : pct >= 75 ? 'good' : pct >= 50 ? 'fair' : 'poor');
</script>

<div class="progress">
  <div class="head">
    <span class="label">{label}</span>
    {#if pct === null}
      <span class="value open">{t('progress.open')}</span>
    {:else}
      <span class="value">{num(pct)} %<span class="word">{t('progress.correct')}</span></span>
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
    {#if pct !== null}
      <div class="fill {level}" style:width="{Math.max(2, pct)}%"></div>
    {/if}
  </div>
  <div class="meta">
    n = {n}{#if pct === null && openFrom}&nbsp;· {t('progress.from', { when: openFrom })}{/if}
  </div>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .label {
    font-size: 15px;
  }
  .value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .value.open {
    font-weight: 500;
    color: var(--muted);
  }
  .word {
    margin-left: 0.3em;
    font-weight: 400;
    color: var(--muted);
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
  .fill.good {
    background: var(--good);
  }
  .fill.fair {
    background: var(--fair);
  }
  .fill.poor {
    background: var(--poor);
  }
  .meta {
    font-size: var(--small);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
