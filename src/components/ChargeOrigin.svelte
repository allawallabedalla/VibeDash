<script lang="ts">
  /**
   * "With which power does the car charge?" (Audit05 I-2): one stacked bar per day –
   * sun / house battery / grid – and above it the shares over the window as the legend.
   */
  import Card from './Card.svelte';
  import StackDayBars from './StackDayBars.svelte';
  import { num, t } from '../i18n/index.svelte';
  import { originShares, type StackDay } from '../model/charge-origin';

  interface Props {
    bars: StackDay[];
    labels: string[];
    /** index of the running day */
    partial?: number;
  }
  let { bars, labels, partial }: Props = $props();

  const shares = $derived(originShares(bars));
  const open = $derived(bars.some((b) => b && b.open > 0));
  const colors = ['var(--sun)', 'var(--battery)', 'var(--import)', 'var(--faint)'];
  const names = $derived([t('co.sun'), t('co.battery'), t('co.grid'), t('co.open')]);
</script>

<Card
  title={t('co.title')}
  icon="plugCar"
  color="var(--battery)"
  info={{ what: t('co.info.what'), source: t('co.info.source') }}
  note={shares
    ? t('co.note', { n: shares.n, kwh: num(shares.kwh, 0) })
    : open
      ? t('co.openOnly')
      : t('co.none', { n: bars.length })}
>
  {#if shares}
    <!-- the share line is the legend: colour, word, percent -->
    <p class="shares">
      <span class="span">{t('co.days', { n: bars.length })}</span>
      <span><i style:background={colors[0]}></i>{shares.sun} % {names[0]}</span>
      <span><i style:background={colors[1]}></i>{shares.battery} % {names[1]}</span>
      <span class="grid"><i style:background={colors[2]}></i>{shares.grid} % {names[2]}</span>
      {#if open}<span class="muted"><i style:background={colors[3]}></i>{names[3]}</span>{/if}
    </p>
  {/if}
  <StackDayBars
    values={bars.map((b) => (b ? [b.sun, b.battery, b.grid, b.open] : null))}
    {colors}
    {labels}
    {names}
    unit="kWh"
    {partial}
    label={shares
      ? t('co.aria', { sun: shares.sun, battery: shares.battery, grid: shares.grid })
      : t('co.title')}
  />
</Card>

<style>
  .shares {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .shares span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .shares .span,
  .shares .muted {
    color: var(--muted);
    font-weight: 500;
  }
  .shares .grid {
    color: var(--import-text);
  }
  i {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
  }
</style>
