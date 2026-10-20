<script lang="ts">
  /**
   * A board's charge timeline (section "chargetimeline"): the house's own weather cases for today and tomorrow,
   * windows to try. Shown only – nothing is sent anywhere. Loaded only where a board has one (first-page budget).
   */
  import type { BoardChargeTimeline } from '../model/board';
  import type { House } from '../app/charge-timeline';
  import ChargeTimeline from './ChargeTimeline.svelte';

  let { tl }: { tl: BoardChargeTimeline } = $props();
  let day = $state(0);
  const d = $derived(tl.days[Math.min(day, tl.days.length - 1)]!);
  const house = $derived<House>({
    batteryKwh: tl.battery.kwh,
    startKwh: d.startKwh,
    reserveKwh: tl.battery.reserveKwh,
    carNeedKwh: tl.carNeedKwh,
    eta: tl.battery.eta,
    batteryKw: tl.battery.kw,
  });
</script>

{#if tl.days.length > 1}
  <div class="days" role="tablist">
    {#each tl.days as x, k (k)}
      <button
        type="button"
        role="tab"
        aria-selected={day === k}
        class:on={day === k}
        onclick={() => (day = k)}>{x.label}</button
      >
    {/each}
  </div>
{/if}
{#key day}
  <ChargeTimeline
    cases={{ pv: d.pv, load: d.load }}
    {house}
    startStep={d.startStep}
    kwOptions={tl.powers}
  />
{/key}

<style>
  .days {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  button {
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--line);
    border-radius: 22px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button.on {
    border-color: var(--battery);
    background: color-mix(in srgb, var(--battery) 14%, var(--surface));
    font-weight: 600;
  }
</style>
