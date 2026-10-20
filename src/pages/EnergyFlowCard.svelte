<script lang="ts">
  /**
   * "Energy flow now" card: the doodle with the house's current values. Live,
   * it asks the server for the newest values every 30 s (the server answers
   * from its short cache); demo shows the demo house at its "now".
   */
  import { onMount, untrack } from 'svelte';
  import { currentSource, store } from '../app/data.svelte';
  import type { DemoData } from '../demo';
  import { valueAt } from '../model/series';
  import { balanceW } from '../model/balance';
  import { energyFlows, type FlowInput } from '../model/flows';
  import { batteryNext, carNext, duration, type PlanBlock } from '../model/outlook';
  import { batteryCapacityKwh } from '../app/tiles';
  import { localDateKey } from '../model/time';
  import { num, t, time } from '../i18n/index.svelte';
  import Card from '../components/Card.svelte';
  import EnergyFlow from '../components/EnergyFlow.svelte';

  let { house }: { house: DemoData } = $props();

  const IDS = ['pv_power', 'load_power', 'battery_power', 'grid_power', 'battery_soc'] as const;
  const FRESH_MS = 3 * 60_000;

  /** newest value not older than FRESH_MS, from the loaded house data */
  const fromHouse = (id: string, now: number): number | null => {
    const s = house.series[id];
    if (!s?.samples.length) return null;
    const v = valueAt(s.samples, now);
    return v && now - v.t <= Math.max(FRESH_MS, s.stepMs * 2.5) ? v.v : null;
  };

  let values = $state<Record<string, number | null>>(
    untrack(() => Object.fromEntries(IDS.map((id) => [id, fromHouse(id, house.now)]))),
  );
  const v = (id: (typeof IDS)[number]): number | null => values[id] ?? null;
  let car = $state<number | null>(null);
  // the charge planner's view: is the car charging, which blocks are planned
  let charge = $state<{ running: boolean; blocks: PlanBlock[] } | null>(null);
  const loadCharge = async () => {
    if (!store.charging) return;
    try {
      const r = await fetch('/api/charging?days=1', { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return;
      const a = (await r.json()) as {
        now: { running: boolean };
        plan: { blocks: PlanBlock[] } | null;
      };
      charge = { running: a.now.running, blocks: a.plan?.blocks ?? [] };
    } catch {
      // keep the last answer
    }
  };
  let stand = $state(untrack(() => house.now));

  const latest = async (id: string): Promise<number | null> => {
    const r = await fetch(`/api/series/${id}?range=1h`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const body = (await r.json()) as { samples: [number, number][] };
    const last = body.samples.at(-1);
    return last && Date.now() - last[0] <= FRESH_MS ? last[1] : null;
  };

  async function refresh() {
    try {
      const got = await Promise.all(IDS.map((id) => latest(id).catch(() => null)));
      values = Object.fromEntries(IDS.map((id, i) => [id, got[i] ?? null]));
      // the car only when the house records charging; a quiet wallbox = 0 W
      car = store.charging ? ((await latest('car_power').catch(() => null)) ?? 0) : null;
      stand = Date.now();
    } catch {
      // keep the last values; the note says how old they are
    }
  }

  onMount(() => {
    if (currentSource() === 'demo') return;
    void refresh();
    void loadCharge();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    const slow = setInterval(() => {
      if (document.visibilityState === 'visible') void loadCharge();
    }, 60_000);
    return () => {
      clearInterval(timer);
      clearInterval(slow);
    };
  });

  const input = $derived<FlowInput | null>(
    v('pv_power') === null || v('load_power') === null || v('grid_power') === null
      ? null
      : {
          pv: v('pv_power')!,
          // consumption incl. conversion losses = balance of the meters (guideline "Verbrauch", Audit04 EN-02);
          // the inverter's house load lacks the losses and left a fake "feed-in" rest in the flow
          load: balanceW(v('pv_power'), v('battery_power'), v('grid_power')) ?? v('load_power')!,
          battery: v('battery_power') ?? 0,
          grid: v('grid_power')!,
          car,
        },
  );
  const flows = $derived(input ? energyFlows(input) : null);

  // one line about what comes next: the car from the plan, the battery at this power
  const outlook = $derived.by(() => {
    const parts: string[] = [];
    const tz = house.timeZone;
    const clock = (at: number) =>
      localDateKey(at, tz) === localDateKey(stand, tz)
        ? time(at, tz)
        : t('flow.next.tomorrow', { time: time(at, tz) });
    if (charge) {
      const c = carNext(stand, charge.running, charge.blocks);
      if (c?.kind === 'until') {
        parts.push(
          c.kwhLeft !== null && c.kwhLeft >= 0.5
            ? t('flow.next.carUntilKwh', { time: clock(c.at), kwh: num(c.kwhLeft) })
            : t('flow.next.carUntil', { time: clock(c.at) }),
        );
      } else if (c?.kind === 'outside') parts.push(t('flow.next.carOutside'));
      else if (c?.kind === 'next') parts.push(t('flow.next.carNext', { time: clock(c.at) }));
    }
    const b = flows
      ? batteryNext(flows.battery, v('battery_soc'), batteryCapacityKwh(house))
      : null;
    if (b) {
      const d = duration(b.hours, { over: t('flow.next.over') });
      parts.push(
        b.kind === 'full' ? t('flow.next.batFull', { d }) : t('flow.next.batLasts', { d }),
      );
    }
    return parts;
  });

  const summary = $derived.by(() => {
    if (!flows) return t('sources.gap');
    const kw = (w: number) => `${num(w / 1000, 1)} kW`;
    const word = (x: string) =>
      x === 'sun'
        ? t('flow.sun')
        : x === 'battery'
          ? t('flow.battery')
          : x === 'grid'
            ? t('flow.grid')
            : x === 'car'
              ? t('flow.car')
              : t('flow.house');
    return flows.flows.map((f) => `${word(f.from)} → ${word(f.to)} ${kw(f.w)}`).join(', ');
  });
</script>

<Card
  title={t('flow.title')}
  icon="bolt"
  color="var(--sun)"
  note={[...outlook, t('flow.asOf', { time: time(stand, house.timeZone) })].join(' · ')}
  info={{ what: t('flow.info.what'), source: t('flow.info.source') }}
>
  {#if flows}
    <EnergyFlow
      {flows}
      soc={v('battery_soc')}
      {summary}
      labels={{
        sun: t('flow.sun'),
        house: t('flow.house'),
        battery: t('flow.battery'),
        car: t('flow.car'),
        grid: t('flow.grid'),
        charging: t('flow.charging'),
        discharging: t('flow.discharging'),
        idle: t('word.idle'),
        feedIn: t('flow.feedIn'),
        import: t('flow.import'),
        still: t('flow.still'),
      }}
    />
  {:else}
    <p class="muted-note">{t('sources.gap')}</p>
  {/if}
</Card>
