<script lang="ts">
  /**
   * The course of the current charge (or the last 6 hours): the car's power
   * as steps, with feed-in and grid import of the house behind it. Shows at a
   * glance whether the charging follows the sun: when the car steps up, the
   * feed-in should fall towards a small rest, and grid import stay at zero.
   * Read-only, refreshed every minute.
   */
  import { onMount } from 'svelte';
  import { i18n, num, t, time } from '../i18n/index.svelte';
  import Card from '../components/Card.svelte';
  import Segmented from '../components/Segmented.svelte';

  interface Props {
    /** series id of the car's power (mapping.charging.power) */
    powerSeries: string;
    /** start of the running charge, or null */
    since: number | null;
    timeZone: string;
  }
  let { powerSeries, since, timeZone }: Props = $props();

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  // the period: the running charge, or the last 6, 24 or 72 hours
  type Period = 'charge' | '6h' | '24h' | '72h';
  const HOURS: Record<Exclude<Period, 'charge'>, number> = { '6h': 6, '24h': 24, '72h': 72 };
  let period = $state<Period>('6h');
  let picked = false;
  $effect.pre(() => {
    // follow the charge until the person picks a period themselves
    if (!picked) period = since !== null ? 'charge' : '6h';
  });
  const pick = (p: Period) => {
    picked = true;
    period = p;
    void load();
  };
  type Row = [number, number];
  let car = $state<Row[]>([]);
  let grid = $state<Row[]>([]);
  let now = $state(Date.now());
  let failed = $state(false);

  const get = async (id: string): Promise<Row[]> => {
    // 72 h come from the week (thinned to 5-min values beyond two days, plenty here)
    const range = period === '72h' ? '7d' : '24h';
    const r = await fetch(`/api/series/${id}?range=${range}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()) as { samples: Row[] }).samples;
  };
  async function load() {
    try {
      [car, grid] = await Promise.all([get(powerSeries), get('grid_power')]);
      now = Date.now();
      failed = false;
    } catch {
      failed = true;
    }
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, MIN);
    return () => clearInterval(timer);
  });

  const from = $derived(
    period === 'charge' && since !== null
      ? since - 15 * MIN
      : now - HOURS[period === 'charge' ? '6h' : period] * HOUR,
  );
  // 72 hours in 5-minute means, otherwise minute means
  const BIN = $derived(period === '72h' ? 5 * MIN : MIN);
  const to = $derived(now);

  /** means per BIN in kW; a slot without values stays a gap */
  const perMinute = (rows: Row[], f: (w: number) => number) => {
    const n = Math.max(1, Math.ceil((to - from) / BIN));
    const sum = new Array<number>(n).fill(0);
    const cnt = new Array<number>(n).fill(0);
    for (const [t0, v] of rows) {
      if (t0 < from || t0 >= to) continue;
      const i = Math.floor((t0 - from) / BIN);
      sum[i]! += f(v) / 1000;
      cnt[i]! += 1;
    }
    return sum.map((s, i) => (cnt[i] ? s / cnt[i]! : null));
  };
  // the car's power arrives about once a minute: hold it up to 3 minutes
  const carKw = $derived.by(() => {
    const m = perMinute(car, (w) => Math.max(0, w));
    let last: number | null = null;
    let age = 0;
    return m.map((v) => {
      if (v !== null) {
        last = v;
        age = 0;
        return v;
      }
      age++;
      return age * BIN <= 3 * MIN ? last : null;
    });
  });
  const feedKw = $derived(perMinute(grid, (w) => Math.max(0, w)));
  const importKw = $derived(perMinute(grid, (w) => Math.max(0, -w)));

  // ── drawing ────────────────────────────────────────────────────────────────
  // drawing width follows the card: narrow on the phone, so text keeps its size
  let cw = $state(640);
  const VW = $derived(cw < 520 ? 380 : cw > 900 ? 1000 : 640);
  const VH = $derived(cw < 520 ? 230 : cw > 900 ? 260 : 200);
  const PAD = { l: 34, r: 8, t: 10, b: 22 };
  const top = $derived(
    Math.max(
      4,
      Math.ceil(
        Math.max(
          ...carKw.map((v) => v ?? 0),
          ...feedKw.map((v) => v ?? 0),
          ...importKw.map((v) => v ?? 0),
        ) / 2,
      ) * 2,
    ),
  );
  const X = (i: number, n: number) => PAD.l + ((VW - PAD.l - PAD.r) * i) / Math.max(1, n - 1);
  const Y = (v: number) => PAD.t + (VH - PAD.t - PAD.b) * (1 - v / top);
  /** polyline through the values, broken at gaps; `steps` draws the car as stairs */
  const line = (vals: (number | null)[], steps = false) => {
    let d = '';
    let open = false;
    vals.forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      const x = X(i, vals.length);
      const y = Y(v);
      if (!open) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
      else if (steps) d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
      else d += `L${x.toFixed(1)},${y.toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const area = (vals: (number | null)[]) => {
    const l = line(vals);
    if (!l) return '';
    // close each run down to zero
    return l
      .split('M')
      .filter(Boolean)
      .map((seg) => {
        const pts = seg.split('L');
        const first = pts[0]!.split(',')[0];
        const last = pts.at(-1)!.split(',')[0];
        return `M${first},${Y(0)}L${seg}L${last},${Y(0)}Z`;
      })
      .join('');
  };
  const ticksY = $derived(
    Array.from({ length: top / 2 + 1 }, (_, i) => i * 2).filter((v) => v % (top > 8 ? 4 : 2) === 0),
  );
  const ticksX = $derived.by(() => {
    const span = to - from;
    const narrow = cw < 520;
    const step =
      span <= 4 * HOUR
        ? 30 * MIN
        : span <= 8 * HOUR
          ? HOUR
          : span <= 26 * HOUR
            ? (narrow ? 6 : 3) * HOUR
            : (narrow ? 24 : 12) * HOUR;
    const out: number[] = [];
    for (let t0 = Math.ceil(from / step) * step; t0 <= to; t0 += step) out.push(t0);
    return out;
  });
  const fmtTick = (t0: number) =>
    to - from > 26 * HOUR
      ? new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
          timeZone,
          weekday: 'short',
          hour: '2-digit',
        }).format(t0)
      : time(t0, timeZone);
  const xAt = (t0: number) => PAD.l + ((VW - PAD.l - PAD.r) * (t0 - from)) / Math.max(1, to - from);

  const lastOf = (vals: (number | null)[]): number | null => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return vals[i]!;
    return null;
  };
  const nowCar = $derived(lastOf(carKw));
  const nowFeed = $derived(lastOf(feedKw));
  const nowImport = $derived(lastOf(importKw));
</script>

<Card
  title={period === 'charge' ? t('hc.trace.title') : t('hc.trace.titleH', { h: HOURS[period] })}
  icon="bolt"
  color="var(--battery)"
  note={t('hc.trace.note', {
    time: time(now, timeZone),
    bin: period === '72h' ? t('hc.trace.bin5') : t('hc.trace.bin1'),
  })}
>
  <div class="period">
    <Segmented
      options={[
        ...(since !== null ? [{ id: 'charge', label: t('hc.trace.charge') }] : []),
        { id: '6h', label: '6 h' },
        { id: '24h', label: '24 h' },
        { id: '72h', label: '72 h' },
      ]}
      bind:value={() => period, (v) => pick(v as Period)}
      label={t('hc.trace.period')}
    />
  </div>
  {#if failed}
    <p class="muted-note">{t('state.noData')}</p>
  {:else if carKw.some((v) => v !== null) || feedKw.some((v) => v !== null)}
    <ul class="legend">
      <li>
        <span class="key car"></span>{t('hc.trace.car')}
        {nowCar !== null ? `${num(nowCar, 1)} kW` : ''}
      </li>
      <li>
        <span class="key feed"></span>{t('hc.trace.feed')}
        {nowFeed !== null ? `${num(nowFeed, 1)} kW` : ''}
      </li>
      <li>
        <span class="key imp"></span>{t('hc.trace.import')}
        {nowImport !== null ? `${num(nowImport, 1)} kW` : ''}
      </li>
    </ul>
    <svg
      bind:clientWidth={cw}
      viewBox="0 0 {VW} {VH}"
      role="img"
      aria-label={t('hc.trace.aria', {
        car: nowCar === null ? '–' : num(nowCar, 1),
        feed: nowFeed === null ? '–' : num(nowFeed, 1),
      })}
    >
      {#each ticksY as v (v)}
        <line class="grid" x1={PAD.l} x2={VW - PAD.r} y1={Y(v)} y2={Y(v)} />
        <text class="axis" x={PAD.l - 6} y={Y(v) + 4} text-anchor="end">{v}</text>
      {/each}
      {#each ticksX as t0 (t0)}
        <text class="axis" x={xAt(t0)} y={VH - 4} text-anchor={xAt(t0) > VW - 30 ? 'end' : 'middle'}
          >{fmtTick(t0)}</text
        >
      {/each}
      <path class="area feed" d={area(feedKw)} />
      <path class="area imp" d={area(importKw)} />
      <path class="ln feed" d={line(feedKw)} />
      <path class="ln imp" d={line(importKw)} />
      <path class="ln car" d={line(carKw, true)} />
    </svg>
  {:else}
    <p class="muted-note">{t('state.noData')}</p>
  {/if}
</Card>

<style>
  .period {
    margin-bottom: 8px;
    max-width: 100%;
    overflow-x: auto;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font-size: var(--small);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    width: 16px;
    height: 4px;
    border-radius: 2px;
  }
  .key.car {
    background: var(--battery);
  }
  .key.feed {
    background: var(--feed);
  }
  .key.imp {
    background: var(--import);
  }
  @media (max-width: 600px) {
    .axis {
      font-size: 14px;
    }
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .ln {
    fill: none;
    stroke-width: 2.4;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ln.car {
    stroke: var(--battery);
    stroke-width: 3;
  }
  .ln.feed {
    stroke: var(--feed);
    stroke-width: 1.8;
  }
  .ln.imp {
    stroke: var(--import);
    stroke-width: 1.8;
  }
  .area {
    stroke: none;
  }
  .area.feed {
    fill: color-mix(in srgb, var(--feed) 16%, transparent);
  }
  .area.imp {
    fill: color-mix(in srgb, var(--import) 22%, transparent);
  }
</style>
