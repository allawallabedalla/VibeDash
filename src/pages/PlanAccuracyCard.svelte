<script lang="ts">
  /**
   * Accuracy of the charge plan (LADESTEUERUNG.md §5–6): share of days on which the car
   * caused no grid import (> 0.1 kWh), with the totals behind it. From a backtest that
   * replans hourly like live – demo in a web worker, live from the forecasting service.
   */
  import { onMount } from 'svelte';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import Card from '../components/Card.svelte';
  import { MIN_PLAN_DAYS, planAccuracy, type PlanAccuracy } from '../app/plan';
  import type { PlanCheck } from '../demo/plan';
  import { num, t } from '../i18n/index.svelte';

  let { demo }: { demo: boolean } = $props();

  type View =
    { s: 'loading' } | { s: 'error' } | { s: 'ready'; acc: PlanAccuracy; pending: number };
  let view = $state<View>({ s: 'loading' });

  async function live() {
    try {
      const res = await fetch('/api/plan/guete', { signal: AbortSignal.timeout(30_000) });
      const b = (await res.json()) as Record<string, unknown>;
      if (res.status !== 200 || typeof b.n !== 'number') throw new Error('upstream');
      view = {
        s: 'ready',
        pending: Number(b.rechnet_noch ?? 0),
        acc: {
          n: b.n,
          pct: (b.korrekt_pct as number | null) ?? null,
          gridKwh: Number(b.netz_kwh ?? 0),
          badDays: Number(b.tage_netz ?? 0),
          chargedKwh: Number(b.geladen_kwh ?? 0),
          possibleKwh: Number(b.moeglich_kwh ?? 0),
          spreadKwh: (b.streuung_kwh as number | null) ?? null,
          history: (b.verlauf as (number | null)[]) ?? [],
        },
      };
    } catch {
      view = { s: 'error' };
    }
  }

  onMount(() => {
    if (!demo) {
      void live();
      return;
    }
    const w = new Worker(new URL('../app/plan-backtest.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent<PlanCheck[]>) => {
      view = { s: 'ready', acc: planAccuracy(e.data), pending: 0 };
      w.terminate();
    };
    w.onerror = () => {
      view = { s: 'error' };
      w.terminate();
    };
    w.postMessage(null);
    return () => w.terminate();
  });
</script>

{#if view.s === 'ready'}
  <AccuracyCard
    label={t('plan.accuracy')}
    pct={view.acc.pct}
    n={view.acc.n}
    history={view.acc.history}
    collecting={view.acc.n < MIN_PLAN_DAYS
      ? { have: view.acc.n, need: MIN_PLAN_DAYS, from: '–' }
      : undefined}
    note={t('plan.accNote', {
      grid: num(view.acc.gridKwh, 1),
      bad: view.acc.badDays,
      charged: num(view.acc.chargedKwh),
      possible: num(view.acc.possibleKwh),
    }) +
      ` · ${t('plan.accFrom')}` +
      (view.pending ? ` · ${t('plan.accCalc')}` : '')}
  />
{:else if view.s === 'loading'}
  <Card title={t('plan.accuracy')} icon="plugCar" color="var(--muted)">
    <p class="muted-note" role="status">{t('plan.accCalc')}</p>
  </Card>
{:else}
  <Card title={t('plan.accuracy')} icon="plugCar" color="var(--muted)">
    <p class="muted-note">{t('state.noData')}</p>
  </Card>
{/if}
