<script lang="ts">
  /**
   * Grid, last 24 hours: the signed curve plus the meter totals in the curve's
   * colours, so a day without feed-in no longer shows a bare line along the top.
   */
  import Card from '../components/Card.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import { num, t } from '../i18n/index.svelte';

  interface Props {
    /** kW per slot, + = feed-in, − = import */
    values: (number | null)[];
    /** kWh from the meters over the same 24 h; null = no meter (shown as open) */
    importKwh: number | null;
    feedKwh: number | null;
    height?: number;
  }
  let { values, importKwh, feedKwh, height }: Props = $props();

  const peak = $derived(Math.max(0, ...values.map((v) => (v === null ? 0 : -v))));
  const kwh = (v: number | null) => (v === null ? t('spark.gridOpen') : num(v, v < 10 ? 1 : 0));
</script>

<Card
  title={t('spark.grid')}
  icon="grid"
  color="var(--feed)"
  info={{
    what: t('spark.gridInfo', { peak: num(peak, 1) }),
    source: t('info.grid.source'),
  }}
>
  <ul class="legend">
    <li>
      <span class="key" style:color="var(--import)"></span>{t('spark.gridImport', {
        v: kwh(importKwh),
      })}
    </li>
    <li>
      <span class="key" style:color="var(--feed)"></span>{t('spark.gridFeed', { v: kwh(feedKwh) })}
    </li>
  </ul>
  <Sparkline {values} signed color="var(--feed)" {height} label={t('spark.grid')} />
</Card>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
    color: var(--text-2);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .key {
    display: inline-block;
    width: 14px;
    height: 3px;
    margin-right: 6px;
    vertical-align: middle;
    border-radius: 2px;
    background: currentColor;
  }
</style>
