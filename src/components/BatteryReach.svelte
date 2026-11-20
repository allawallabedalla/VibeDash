<script lang="ts">
  /**
   * The battery tile, enlarged (Audit05 I-4): at night the course now → sunrise – the
   * mean of past nights as a dashed line, mean ± sd as a band, the discharge limit, where
   * it is empty and how much then comes from the grid. By day the last night as it was
   * (measured), and when the estimate starts. Loaded with the enlarged tile only.
   */
  import { num, t, time } from '../i18n/index.svelte';
  import { emptyRange } from '../app/tiles';
  import { socFloor, type Reach } from '../model/reach';
  import type { Sample } from '../model/types';

  interface Props {
    reach: Reach;
    tz: string;
    now: number;
    soc: readonly Sample[];
    grid: readonly Sample[];
  }
  let { reach, tz, now, soc, grid }: Props = $props();

  let width = $state(600);
  const W = $derived(Math.max(width, 280));
  const H = 180;
  const P = { l: 40, r: 10, t: 22, b: 24 };
  const Q = 15 * 60_000;

  /** the stretch drawn: tonight (estimate) or last night (measured) */
  const span = $derived(
    reach.kind === 'night'
      ? { from: reach.from, to: reach.sunAt }
      : { from: reach.eveningAt - 86_400_000, to: reach.morningAt },
  );
  const x = (tm: number) =>
    P.l + ((tm - span.from) / Math.max(1, span.to - span.from)) * (W - P.l - P.r);
  const y = (pct: number) => P.t + (1 - Math.max(0, Math.min(100, pct)) / 100) * (H - P.t - P.b);
  const floorPct = $derived(reach.kind === 'night' ? reach.floor.pct : socFloor(soc, now).pct);

  /** charge (%) along the night for a total need (kWh), from the mean course */
  const path = (need: number) => {
    if (reach.kind !== 'night') return [];
    const r = reach;
    const f = r.need.mean > 0 ? need / r.need.mean : 0;
    const start = Math.min(r.soc, floorPct);
    return [
      [r.from, r.soc],
      ...r.cum.map((c, k) => [
        Math.min(r.from + (k + 1) * Q, r.sunAt),
        Math.max(start, r.soc - ((c * f) / r.cap) * 100),
      ]),
    ] as [number, number][];
  };
  const line = (pts: [number, number][]) =>
    pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
  const band = $derived.by(() => {
    if (reach.kind !== 'night') return '';
    const hi = path(reach.need.low);
    const lo = path(reach.need.high);
    return `${line(hi)}${lo
      .reverse()
      .map(([a, b]) => `L${x(a).toFixed(1)},${y(b).toFixed(1)}`)
      .join('')}Z`;
  });
  const mean = $derived(reach.kind === 'night' ? line(path(reach.need.mean)) : '');

  /** last night, measured: quarter-hour means of the charge, gaps stay gaps */
  const last = $derived.by(() => {
    if (reach.kind !== 'day') return null;
    const { from, to } = span;
    const n = Math.ceil((to - from) / Q);
    const q = (list: readonly Sample[]) => {
      const sum = new Float64Array(n);
      const cnt = new Uint16Array(n);
      for (const p of list) {
        const i = Math.floor((p.t - from) / Q);
        if (i >= 0 && i < n) {
          sum[i]! += p.v;
          cnt[i]!++;
        }
      }
      return Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i]! : null));
    };
    const s = q(soc);
    const g = q(grid);
    if (s.filter((v) => v !== null).length < n / 2) return null;
    let d = '';
    let gap = true;
    s.forEach((v, i) => {
      if (v === null) return void (gap = true);
      d += `${gap ? 'M' : 'L'}${x(from + (i + 0.5) * Q).toFixed(1)},${y(v).toFixed(1)}`;
      gap = false;
    });
    const k = s.findIndex((v) => v !== null && v <= floorPct + 0.5);
    // import is negative grid power (W) – a sum of quarter-hour means (≈)
    const kwh = g.reduce<number>((a, v) => a + (v !== null && v < 0 ? -v / 4000 : 0), 0);
    const min = Math.min(...s.filter((v): v is number => v !== null));
    return { d, emptyAt: k < 0 ? null : from + k * Q, kwh, min };
  });

  // hour ticks: every 2 h (phone 4 h), never crowding the two ends
  const ticks = $derived.by(() => {
    const every = (W < 480 ? 4 : 2) * 3_600_000;
    const out: number[] = [];
    for (let tm = Math.ceil(span.from / 3_600_000) * 3_600_000; tm < span.to; tm += 3_600_000) {
      const h = Number(time(tm, tz).slice(0, 2));
      // the end labels ("now", "sun 08:00") keep their room
      if (h % (every / 3_600_000) === 0 && x(tm) - P.l > 52 && W - P.r - x(tm) > 104) out.push(tm);
    }
    return out;
  });
  const fmt = (v: number) => num(v, v < 10 ? 1 : 0);
</script>

<section class="reach">
  {#if reach.kind === 'night'}
    {@const r = reach}
    <h3>
      {#if r.emptyAt !== null}
        {t('reach.emptyTitle', { at: time(r.emptyAt, tz), range: emptyRange(r, tz) })}
      {:else if r.emptyEarly !== null}
        {t('reach.tightTitle')}
      {:else}
        {t('reach.yes')}
      {/if}
    </h3>
    <p class="sub">
      {#if r.emptyAt !== null}
        {t('reach.emptySub', {
          kwh: fmt(r.grid.mean),
          lo: fmt(r.grid.low),
          hi: fmt(r.grid.high),
          sun: time(r.sunAt, tz),
        })}
      {:else if r.emptyEarly !== null}
        {t('reach.tightSub', { at: time(r.emptyEarly, tz), kwh: fmt(r.grid.high) })}
      {:else}
        {t('reach.yesSub', {
          at: time(r.sunAt, tz),
          kwh: fmt(r.usable - r.need.mean),
          lo: fmt(Math.max(0, r.usable - r.need.high)),
          hi: fmt(r.usable - r.need.low),
        })}
      {/if}
    </p>
  {:else}
    <h3>{t('reach.title')}</h3>
    <p class="sub">{t('reach.day', { at: time(reach.eveningAt, tz) })}</p>
    {#if last}
      <p class="sub strong">
        {t('reach.last')}:
        {last.emptyAt !== null
          ? t('reach.lastEmpty', { at: time(last.emptyAt, tz), kwh: fmt(last.kwh) })
          : t('reach.lastLasted', { min: num(last.min) })}
      </p>
    {/if}
  {/if}

  {#if reach.kind === 'night' || last}
    <div class="legend" aria-hidden="true">
      {#if reach.kind === 'night'}
        <span><i class="k mean"></i>{t('reach.mean')}</span>
        <span><i class="k band"></i>{t('reach.band')}</span>
        {#if reach.emptyAt !== null || reach.emptyEarly !== null}
          <span><i class="k grid"></i>{t('co.grid')}</span>
        {/if}
      {:else}
        <span><i class="k measured"></i>{t('plan.legend.battery')}</span>
      {/if}
      <span><i class="k floor"></i>{t('reach.floor', { pct: num(floorPct) })}</span>
    </div>
    <figure bind:clientWidth={width}>
      <svg
        viewBox="0 0 {W} {H}"
        role="img"
        aria-label={reach.kind === 'night' ? t('reach.title') : t('reach.last')}
      >
        {#each [0, 50, 100] as v (v)}
          <line class="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} />
          <text class="ax" x={P.l - 6} y={y(v) + 5} text-anchor="end">{v} %</text>
        {/each}
        {#if reach.kind === 'night'}
          {@const r = reach}
          {#if r.emptyEarly !== null}
            <!-- from where it may be empty on: the grid takes over (purple floor strip) -->
            <rect
              class="gridzone"
              x={x(r.emptyEarly)}
              y={y(floorPct) - 3}
              width={Math.max(0, x(r.sunAt) - x(r.emptyEarly))}
              height="6"
              rx="3"
            />
          {/if}
          <path class="band" d={band} />
          <path class="mean" d={mean} />
          {#if r.emptyAt !== null}
            <line class="mark" x1={x(r.emptyAt)} x2={x(r.emptyAt)} y1={P.t - 6} y2={H - P.b} />
            <text
              class="lbl"
              x={x(r.emptyAt)}
              y={P.t - 8}
              text-anchor={x(r.emptyAt) > W - 90
                ? 'end'
                : x(r.emptyAt) < P.l + 90
                  ? 'start'
                  : 'middle'}>{t('reach.mark', { at: time(r.emptyAt, tz) })}</text
            >
          {/if}
        {:else if last}
          <path class="measured" d={last.d} />
        {/if}
        <line class="floor" x1={P.l} x2={W - P.r} y1={y(floorPct)} y2={y(floorPct)} />
        {#each ticks as tm (tm)}
          <text class="ax" x={x(tm)} y={H - 4} text-anchor="middle">{time(tm, tz).slice(0, 2)}</text
          >
        {/each}
        <text class="ax" x={P.l} y={H - 4}
          >{reach.kind === 'night' ? t('reach.now') : time(span.from, tz)}</text
        >
        <text class="ax" x={W - P.r} y={H - 4} text-anchor="end"
          >{t('reach.sun', { at: time(span.to, tz) })}</text
        >
      </svg>
    </figure>
    {#if reach.kind === 'night'}
      <p class="sub">
        {t('reach.basis', {
          usable: fmt(reach.usable),
          floor: num(reach.floor.pct),
          need: fmt(reach.need.mean),
          sd: fmt(reach.need.high - reach.need.mean),
          n: reach.n,
        })}
      </p>
    {/if}
  {/if}
</section>

<style>
  .reach {
    display: grid;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }
  .sub {
    margin: 0;
    color: var(--text-2);
  }
  .sub.strong {
    color: var(--text);
    font-weight: 600;
  }
  figure {
    margin: 0;
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
  .ax {
    fill: var(--muted);
    font-size: 14px;
  }
  .lbl {
    fill: var(--text);
    font-size: 14px;
    font-weight: 600;
  }
  .band {
    fill: var(--battery);
    opacity: 0.2;
  }
  .mean {
    fill: none;
    stroke: var(--battery);
    stroke-width: 3;
    stroke-dasharray: 7 5;
    stroke-linecap: round;
  }
  .measured {
    fill: none;
    stroke: var(--battery);
    stroke-width: 3;
    stroke-linejoin: round;
  }
  .floor {
    stroke: var(--muted);
    stroke-dasharray: 2 4;
  }
  .gridzone {
    fill: var(--import);
  }
  .mark {
    stroke: var(--text);
    stroke-dasharray: 2 3;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    color: var(--muted);
    font-size: 14px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .k {
    display: inline-block;
    width: 16px;
    height: 0;
    border-top: 3px dashed var(--battery);
  }
  .k.band {
    height: 10px;
    border: 0;
    border-radius: 3px;
    background: var(--battery);
    opacity: 0.3;
  }
  .k.grid {
    height: 6px;
    border: 0;
    border-radius: 3px;
    background: var(--import);
  }
  .k.measured {
    border-top: 3px solid var(--battery);
  }
  .k.floor {
    border-top: 2px dotted var(--muted);
  }
</style>
