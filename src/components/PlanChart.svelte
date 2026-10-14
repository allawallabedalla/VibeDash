<script lang="ts">
  /**
   * Hour chart of a charge plan: PV forecast as its own line with the 10–90 % band,
   * house load (forecast), planned charging blocks, and below the battery path with
   * its band. Everything here is a forecast – drawn dashed, never as measured values.
   */
  import { num } from '../i18n/index.svelte';

  interface Props {
    hours: number[];
    pv: { p10: number[]; p50: number[]; p90: number[] };
    load: number[];
    carKw: number[];
    soc: { p10: number[]; p50: number[]; p90: number[] };
    capacityKwh: number;
    timeZone: string;
    locale: string;
    labels: { pv: string; band: string; load: string; car: string; battery: string; now: string };
  }
  let { hours, pv, load, carKw, soc, capacityKwh, timeZone, locale, labels }: Props = $props();

  // Drawn at the real pixel width, so text stays at its real size on the phone.
  let width = $state(640);
  const W = $derived(Math.max(width, 280));
  const H = 180;
  const SH = 56;
  const PAD = { l: 34, r: 8, t: 8, b: 22 };
  const n = $derived(hours.length);
  const step = $derived((W - PAD.l - PAD.r) / Math.max(n, 1));
  const top = $derived(Math.max(1, ...pv.p90, ...load, ...carKw.map((v) => v)) * 1.08);
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const ys = (kwh: number) => 6 + (1 - kwh / capacityKwh) * (SH - 12);

  const line = (vals: number[], f: (v: number) => number) =>
    vals
      .map((v, i) => `${i ? 'L' : 'M'}${(x(i) + step / 2).toFixed(1)},${f(v).toFixed(1)}`)
      .join('');
  const area = (lo: number[], hi: number[], f: (v: number) => number) =>
    hi
      .map((v, i) => `${i ? 'L' : 'M'}${(x(i) + step / 2).toFixed(1)},${f(v).toFixed(1)}`)
      .join('') +
    lo
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${(x(i) + step / 2).toFixed(1)},${f(v).toFixed(1)}`)
      .join('') +
    'Z';

  const hourOf = (t: number) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(t),
    );
  const every = $derived(W < 480 ? 12 : 6);
  const ticks = $derived(
    hours.map((t, i) => ({ i, h: hourOf(t) })).filter(({ i, h }) => i > 1 && h % every === 0),
  );
  const dayFmt = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }));
  const yTicks = $derived(
    [0, 0.5, 1]
      .map((f) => Math.round(top * f * 0.9 * 10) / 10)
      .filter((v, i, a) => a.indexOf(v) === i),
  );
</script>

<figure class="plan" bind:clientWidth={width}>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={labels.pv}>
    {#each yTicks as v (v)}
      <line class="grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
      <text class="ax" x={PAD.l - 6} y={y(v) + 4} text-anchor="end">{num(v, v < 10 ? 1 : 0)}</text>
    {/each}
    {#each ticks as tk (tk.i)}
      <line
        class={tk.h === 0 ? 'mid' : 'grid'}
        x1={x(tk.i)}
        x2={x(tk.i)}
        y1={PAD.t}
        y2={H - PAD.b}
      />
      <text class="ax" x={x(tk.i)} y={H - 6} text-anchor="middle"
        >{tk.h === 0 ? dayFmt.format(hours[tk.i]) : `${tk.h}`}</text
      >
    {/each}
    <text class="ax" x={PAD.l} y={H - 6}>{labels.now}</text>
    {#each carKw as v, i (i)}
      {#if v > 0}
        <rect
          class="car"
          x={x(i) + 1}
          y={y(v)}
          width={Math.max(step - 2, 1)}
          height={y(0) - y(v)}
          rx="3"
        />
      {/if}
    {/each}
    <path class="band" d={area(pv.p10, pv.p90, y)} />
    <path class="pv" d={line(pv.p50, y)} />
    <path class="load" d={line(load, y)} />
    <text class="ax unit" x="2" y={PAD.t + 4}>kW</text>
  </svg>
  <svg class="soc" viewBox="0 0 {W} {SH}" role="img" aria-label={labels.battery}>
    <rect class="track" x={PAD.l} y="6" width={W - PAD.l - PAD.r} height={SH - 12} rx="6" />
    <path class="sband" d={area(soc.p10, soc.p90, ys)} />
    <path class="sline" d={line(soc.p50, ys)} />
    <text class="ax" x={PAD.l - 6} y={SH / 2 + 4} text-anchor="end">%</text>
  </svg>
  <figcaption>
    <span><i class="k pv"></i>{labels.pv}</span>
    <span><i class="k band"></i>{labels.band}</span>
    <span><i class="k load"></i>{labels.load}</span>
    <span><i class="k car"></i>{labels.car}</span>
    <span><i class="k soc"></i>{labels.battery}</span>
  </figcaption>
</figure>

<style>
  .plan {
    margin: 0;
    display: grid;
    gap: 6px;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .mid {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .ax {
    fill: var(--muted);
    font-size: 14px;
  }
  .band {
    fill: var(--sun);
    opacity: 0.18;
  }
  .pv {
    fill: none;
    stroke: var(--sun);
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
    stroke-linecap: round;
  }
  .load {
    fill: none;
    stroke: var(--home);
    stroke-width: 2;
    stroke-dasharray: 3 4;
    stroke-linecap: round;
  }
  .car {
    fill: var(--battery);
    opacity: 0.55;
  }
  .track {
    fill: var(--surface-2);
  }
  .sband {
    fill: var(--battery);
    opacity: 0.18;
  }
  .sline {
    fill: none;
    stroke: var(--battery);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    color: var(--muted);
    font-size: 14px;
  }
  figcaption span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .k {
    display: inline-block;
    width: 16px;
    height: 0;
    border-top: 2.5px dashed var(--sun);
  }
  .k.band {
    height: 10px;
    border: 0;
    border-radius: 3px;
    background: var(--sun);
    opacity: 0.25;
  }
  .k.load {
    border-top: 2px dotted var(--home);
  }
  .k.car {
    height: 10px;
    border: 0;
    border-radius: 3px;
    background: var(--battery);
    opacity: 0.6;
  }
  .k.soc {
    border-top: 2px dashed var(--battery);
  }
</style>
