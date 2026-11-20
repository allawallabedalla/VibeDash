<script lang="ts">
  /**
   * The next 48 hours on one time line (Audit05 I-5): the sun forecast as its own dashed
   * line with the 10–90 % fan, the house load (forecast, dotted), the planned charge
   * windows as blocks, and below – on its own strip, no second axis – the house battery.
   * Everything here is a forecast; nothing is switched. Drawn at the real pixel width, so
   * text keeps its real size on the phone.
   */
  import { tc } from '../i18n/charge';
  import { num, t, time } from '../i18n/index.svelte';
  import { daySums, type TimeBlock } from '../model/charge-outlook';
  import { localMidnight } from '../model/time';

  type Vals = (number | null)[];
  interface Props {
    /** hourly slot starts */
    hours: number[];
    /** kW per hour */
    pv: { p10: Vals; p50: Vals; p90: Vals };
    load: Vals;
    blocks: TimeBlock[];
    /** planned car power per hour (kW), for the day sums */
    car: number[];
    /** battery %, point i at hours[0] + i h (the first at now); null = no strip */
    soc: { p10: Vals; p50: Vals; p90: Vals } | null;
    floorPct?: number;
    now: number;
    timeZone: string;
    locale: string;
    /** extra words per local day (e.g. the planner's own numbers), by day index */
    dayNotes?: (string | null)[];
  }
  let {
    hours,
    pv,
    load,
    blocks,
    car,
    soc,
    floorPct,
    now,
    timeZone,
    locale,
    dayNotes = [],
  }: Props = $props();

  const HOUR = 3_600_000;
  let width = $state(640);
  const W = $derived(Math.max(width, 280));
  const phone = $derived(W < 520);
  const H = 200;
  const SH = 58;
  const P = $derived({ l: phone ? 34 : 40, r: 8, t: 26, b: 24 });
  const t0 = $derived(hours[0] ?? now);
  const t1 = $derived((hours.at(-1) ?? now) + HOUR);
  const x = (tm: number) => P.l + ((tm - t0) / (t1 - t0)) * (W - P.l - P.r);
  const top = $derived(
    Math.max(
      1,
      ...[...pv.p90, ...pv.p50, ...load].map((v) => v ?? 0),
      ...blocks.map((b) => b.kw ?? 0),
    ) * 1.1,
  );
  const y = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);
  const ys = (pct: number) => 6 + (1 - Math.max(0, Math.min(100, pct)) / 100) * (SH - 12);
  const mid = (i: number) => hours[i]! + HOUR / 2;

  /** a line through the hour middles; a missing hour breaks it (gaps stay gaps) */
  const line = (vals: Vals, f: (v: number) => number, at: (i: number) => number = mid) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(at(i)).toFixed(1)},${f(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  /** a band between two lines, one closed piece per stretch without gaps */
  const area = (lo: Vals, hi: Vals, f: (v: number) => number, at: (i: number) => number = mid) => {
    let d = '';
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        d +=
          run
            .map((i, k) => `${k ? 'L' : 'M'}${x(at(i)).toFixed(1)},${f(hi[i]!).toFixed(1)}`)
            .join('') +
          [...run]
            .reverse()
            .map((i) => `L${x(at(i)).toFixed(1)},${f(lo[i]!).toFixed(1)}`)
            .join('') +
          'Z';
      }
      run = [];
    };
    hi.forEach((v, i) => {
      if (v === null || v === undefined || lo[i] === null || lo[i] === undefined) flush();
      else run.push(i);
    });
    flush();
    return d;
  };

  const hourOf = (tm: number) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(tm),
    );
  const dayFmt = $derived(
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone }),
  );
  /** local midnights inside the window, with the day name right of them */
  const midnights = $derived(hours.filter((h) => h > t0 && hourOf(h) === 0));
  const ticks = $derived(
    hours.filter((h) => {
      const hr = hourOf(h);
      return hr !== 0 && hr % (phone ? 12 : 6) === 0 && x(h) - P.l > 26;
    }),
  );
  /** round marks 1-2-5 (Audit05 G5-01): 0, one step, two steps */
  const yStep = $derived.by(() => {
    const raw = top / 2.2;
    const p = 10 ** Math.floor(Math.log10(raw));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  });
  const yTicks = $derived([0, yStep, 2 * yStep].filter((v) => v <= top));
  const socAt = (i: number) => (i === 0 ? Math.max(now, t0) : t0 + i * HOUR);
  const socEnd = $derived.by(() => {
    if (!soc) return null;
    for (let i = soc.p50.length - 1; i >= 0; i--) {
      const v = soc.p50[i];
      if (v !== null && v !== undefined) return { i, v };
    }
    return null;
  });

  const days = $derived(daySums(hours, pv, car, (tm) => localMidnight(tm, timeZone)));
  const today = $derived(localMidnight(now, timeZone));
  const kwh = (v: number) => num(v, v > 0 && v < 10 ? 1 : 0);
  const dayName = (d: number, i: number) =>
    d === today
      ? i === 0 && hours[0]! > d
        ? tc('out.restToday')
        : t('days.today')
      : dayFmt.format(d + 12 * HOUR);
  const hasBand = $derived(pv.p10.some((v, i) => v !== null && pv.p90[i] !== null));
</script>

<figure class="outlook" bind:clientWidth={width}>
  <!-- legend above the graphic: line style + word -->
  <figcaption>
    <span><i class="k pv"></i>{t('plan.legend.pv')}</span>
    {#if hasBand}<span><i class="k band"></i>{t('plan.legend.band')}</span>{/if}
    <span><i class="k load"></i>{t('plan.legend.load')}</span>
    <span><i class="k car"></i>{t('plan.legend.car')}</span>
  </figcaption>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={t('plan.chart')}>
    {#each yTicks as v (v)}
      <line class="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} />
      <text class="ax" x={P.l - 6} y={y(v) + 5} text-anchor="end">{num(v, yStep < 1 ? 1 : 0)}</text>
    {/each}
    <text class="ax" x={P.l - 6} y={P.t - 10} text-anchor="end">kW</text>
    {#each blocks as b (b.start)}
      {@const a = x(Math.max(b.start, t0))}
      {@const w = Math.max(3, x(Math.min(b.end, t1)) - a)}
      <rect class="block" x={a} y={P.t} width={w} height={H - P.t - P.b} rx="4" />
      <rect class="blockbar" x={a} y={H - P.b - 6} width={w} height="6" rx="3" />
    {/each}
    {#each midnights as m (m)}
      <line class="mid" x1={x(m)} x2={x(m)} y1={P.t - 18} y2={H - P.b} />
      <text class="day" x={x(m) + 6} y={P.t - 8}>{dayFmt.format(m + 12 * HOUR)}</text>
    {/each}
    {#each ticks as h (h)}
      <text class="ax" x={x(h)} y={H - 5} text-anchor="middle">{hourOf(h)}</text>
    {/each}
    <path class="band" d={area(pv.p10, pv.p90, y)} />
    <path class="pv" d={line(pv.p50, y)} />
    <path class="load" d={line(load, y)} />
    <line class="now" x1={x(now)} x2={x(now)} y1={P.t - 18} y2={H - P.b} />
    <text class="ax" x={x(now)} y={H - 5}>{t('plan.now')}</text>
  </svg>
  {#if soc}
    <div class="strip">
      <span class="sname"
        >{t('plan.legend.battery')}{#if socEnd}<span class="send"
            >{` · ${dayName(localMidnight(socAt(socEnd.i), timeZone), 1)} ${time(socAt(socEnd.i), timeZone)} ≈ ${num(socEnd.v)} %`}</span
          >{/if}</span
      >
      <svg viewBox="0 0 {W} {SH}" role="img" aria-label={t('plan.legend.battery')}>
        <rect class="track" x={P.l} y="6" width={W - P.l - P.r} height={SH - 12} rx="8" />
        {#if floorPct !== undefined}
          <line class="floor" x1={P.l} x2={W - P.r} y1={ys(floorPct)} y2={ys(floorPct)} />
        {/if}
        {#each midnights as m (m)}
          <line class="mid" x1={x(m)} x2={x(m)} y1="6" y2={SH - 6} />
        {/each}
        <path class="sband" d={area(soc.p10, soc.p90, ys, socAt)} />
        <path class="sline" d={line(soc.p50, ys, socAt)} />
        <text class="ax" x={P.l - 6} y={ys(100) + 10} text-anchor="end">100</text>
        <text class="ax" x={P.l - 6} y={ys(0) + 2} text-anchor="end">0</text>
      </svg>
    </div>
  {/if}
  <ul class="days">
    {#each days as d, i (d.day)}
      <li>
        <strong>{dayName(d.day, i)}</strong>
        <span
          >{d.sun.p50 === null
            ? `${tc('co.sun')} –`
            : tc('out.daySun', {
                kwh: kwh(d.sun.p50),
                range:
                  d.sun.p10 !== null && d.sun.p90 !== null
                    ? ` (${kwh(d.sun.p10)}–${kwh(d.sun.p90)})`
                    : '',
              })}</span
        >
        <span>{dayNotes[i] ?? tc('out.dayCar', { kwh: kwh(d.car) })}</span>
      </li>
    {/each}
  </ul>
  {#if blocks.length}
    <ul class="blist">
      {#each blocks as b (b.start)}
        <li>
          {dayName(localMidnight(b.start, timeZone), 1)}
          {time(b.start, timeZone)}–{time(b.end, timeZone)}{b.kw ? ` · ≈ ${num(b.kw, 1)} kW` : ''}
        </li>
      {/each}
    </ul>
  {/if}
</figure>

<style>
  .outlook {
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
  }
  .mid {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .ax {
    fill: var(--muted);
    font-size: 14px;
  }
  .day {
    fill: var(--text-2);
    font-size: 14px;
    font-weight: 600;
  }
  .now {
    stroke: var(--text);
    stroke-width: 1.5;
  }
  .block {
    fill: var(--battery);
    opacity: 0.16;
  }
  .blockbar {
    fill: var(--battery);
  }
  .band {
    fill: var(--sun);
    opacity: 0.22;
  }
  .pv {
    fill: none;
    stroke: var(--sun);
    stroke-width: 2.5;
    stroke-dasharray: 7 4;
    stroke-linecap: round;
  }
  .load {
    fill: none;
    stroke: var(--home);
    stroke-width: 2.5;
    stroke-dasharray: 2 4;
    stroke-linecap: round;
  }
  .strip {
    position: relative;
  }
  .sname {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
    margin: 4px 0 0;
  }
  .send {
    font-weight: 400;
    color: var(--muted);
  }
  .track {
    fill: var(--track);
  }
  .floor {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .sband {
    fill: var(--battery);
    opacity: 0.22;
  }
  .sline {
    fill: none;
    stroke: var(--battery);
    stroke-width: 2.5;
    stroke-dasharray: 7 4;
    stroke-linecap: round;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
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
    width: 18px;
    height: 0;
    border-top: 2.5px dashed var(--sun);
  }
  .k.band {
    height: 10px;
    border: 0;
    border-radius: 3px;
    background: var(--sun);
    opacity: 0.3;
  }
  .k.load {
    border-top: 2.5px dotted var(--home);
  }
  .k.car {
    height: 10px;
    border: 0;
    border-radius: 3px;
    background: var(--battery);
  }
  .days {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
  }
  .days li {
    display: grid;
    gap: 2px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 14px;
    color: var(--text-2);
  }
  .days strong {
    color: var(--text);
  }
  .blist {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
    color: var(--text-2);
  }
</style>
