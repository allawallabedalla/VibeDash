<script lang="ts">
  /**
   * "How well does the sun forecast hit – day by day?" (Audit05 I-6). Per day a
   * pale bar = the hit window of the accuracy card (forecast ± tolerance), a thin
   * line = the forecast's own span P10–P90, a tick = the forecast, and the
   * meter's actual as a dot: green inside the window, coral outside. Days
   * without a forecast stay empty; today has no dot yet. Tap or drag picks a day.
   */
  import { hitCounts, type HitDay } from '../app/forecast-hits';
  import { num, t } from '../i18n/index.svelte';

  interface Props {
    days: HitDay[];
    /** ± share of the forecast that still counts as correct (the card's rule) */
    tolerance: number;
    timeZone: string;
    locale: string;
    height?: number;
  }
  let { days, tolerance, timeZone, locale, height = 190 }: Props = $props();

  let width = $state(0);
  const AXIS = 34;
  const TOP = 8;
  const BOTTOM = 26;

  const counts = $derived(hitCounts(days));
  const pct = $derived(Math.round(tolerance * 100));

  /** a round top of the scale: 1-2-5 steps */
  const top = $derived.by(() => {
    let hi = 0;
    for (const d of days) {
      if (d.forecast !== null) hi = Math.max(hi, d.forecast * (1 + tolerance), d.high ?? 0);
      if (d.actual !== null) hi = Math.max(hi, d.actual);
    }
    if (hi <= 0) return { max: 10, step: 5 };
    const raw = hi / 3;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
    return { max: Math.ceil(hi / step) * step, step };
  });
  const ticks = $derived(
    Array.from({ length: Math.round(top.max / top.step) + 1 }, (_, i) => i * top.step),
  );

  const plotW = $derived(Math.max(0, width - AXIS));
  const plotH = $derived(height - TOP - BOTTOM);
  const slot = $derived(days.length ? plotW / days.length : 0);
  const cx = (i: number) => AXIS + slot * (i + 0.5);
  const y = (v: number) => TOP + plotH * (1 - Math.min(1, Math.max(0, v / top.max)));
  const barW = $derived(Math.max(4, Math.min(16, slot * 0.6)));

  const wd = $derived(new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }));
  const dm = $derived(
    new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'numeric' }),
  );
  const long = $derived(
    new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
    }),
  );
  const noon = (d: HitDay) => d.start + 12 * 3_600_000;
  /** a week shows every weekday, a month every 7th day counted back from today */
  const xLabel = (i: number) => {
    const d = days[i]!;
    // today is the bold one (a wider word did not fit at the right edge)
    if (days.length <= 10) return wd.format(noon(d)).replace(/\.$/, '');
    return (days.length - 1 - i) % 7 === 0 ? dm.format(noon(d)) : '';
  };

  // the newest judged day is picked first
  let picked = $state<number | null>(null);
  const lastJudged = $derived(days.reduce((last, d, i) => (d.correct !== null ? i : last), -1));
  const sel = $derived(picked !== null && picked < days.length ? picked : lastJudged);
  const selDay = $derived(sel >= 0 ? days[sel] : undefined);

  const kwh = (v: number) => num(v, v < 10 ? 1 : 0);
  const dayText = (d: HitDay) => {
    const head = long.format(noon(d));
    if (d.forecast === null) return `${head}: ${t('state.noData')}`;
    const span = d.low !== null && d.high !== null ? ` (${kwh(d.low)}–${kwh(d.high)})` : '';
    const fc = t('hits.dayForecast', { v: kwh(d.forecast), span });
    const act =
      d.actual === null
        ? d.today
          ? t('days.today')
          : t('hits.noActual')
        : t('hits.dayActual', {
            v: kwh(d.actual),
            verdict: d.correct ? t('hits.hit') : t('hits.miss'),
          });
    return `${head}: ${fc} · ${act}`;
  };

  let plotEl = $state<HTMLDivElement>();
  function pickAt(clientX: number) {
    if (!plotEl || !slot) return;
    const x = clientX - plotEl.getBoundingClientRect().left - AXIS;
    picked = Math.max(0, Math.min(days.length - 1, Math.floor(x / slot)));
  }
  function onkey(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    picked = Math.max(0, Math.min(days.length - 1, (sel < 0 ? days.length : sel) + step));
  }
</script>

<div class="hits">
  <p class="head">
    {#if counts.n}
      <strong>{t('hits.head', { k: counts.k, n: counts.n })}</strong>
      <span class="goal">{t('hits.goal', { p: pct })}</span>
    {:else}
      <strong>{t('progress.open')} · n = 0</strong>
    {/if}
  </p>
  <div class="legend" aria-hidden="true">
    <span><i class="win"></i>{t('hits.window', { p: pct })}</span>
    <span><i class="span"></i>{t('hits.span')}</span>
    <span><i class="dot good"></i>{t('hits.hit')}</span>
    <span><i class="dot miss"></i>{t('hits.miss')}</span>
  </div>
  <div class="unit">kWh</div>
  <div
    class="plot"
    bind:this={plotEl}
    bind:clientWidth={width}
    style:height="{height}px"
    role="slider"
    tabindex="0"
    aria-label={t('hits.label')}
    aria-valuemin={0}
    aria-valuemax={Math.max(0, days.length - 1)}
    aria-valuenow={Math.max(0, sel)}
    aria-valuetext={selDay ? dayText(selDay) : t('state.noData')}
    onpointerdown={(e) => {
      plotEl?.setPointerCapture?.(e.pointerId);
      pickAt(e.clientX);
    }}
    onpointermove={(e) => {
      if (e.buttons) pickAt(e.clientX);
    }}
    onkeydown={onkey}
  >
    {#if width > 0}
      <svg {width} {height} aria-hidden="true">
        {#each ticks as v (v)}
          <line class="grid" x1={AXIS} x2={width} y1={y(v)} y2={y(v)} />
          <text class="ax" x={AXIS - 6} y={y(v) + 5} text-anchor="end">{num(v)}</text>
        {/each}
        {#if selDay}
          <rect
            class="sel"
            x={cx(sel) - slot / 2}
            width={slot}
            y={TOP - 4}
            height={plotH + 8}
            rx="6"
          />
        {/if}
        {#each days as d, i (d.day)}
          {#if d.forecast !== null}
            <g class:today={d.today}>
              {#if d.low !== null && d.high !== null}
                <line class="spanline" x1={cx(i)} x2={cx(i)} y1={y(d.high)} y2={y(d.low)} />
              {/if}
              <rect
                class="win"
                x={cx(i) - barW / 2}
                width={barW}
                y={y(d.forecast * (1 + tolerance))}
                height={Math.max(
                  2,
                  y(d.forecast * (1 - tolerance)) - y(d.forecast * (1 + tolerance)),
                )}
                rx={Math.min(4, barW / 2)}
              />
              <line
                class="fc"
                x1={cx(i) - barW / 2}
                x2={cx(i) + barW / 2}
                y1={y(d.forecast)}
                y2={y(d.forecast)}
              />
              {#if d.actual !== null}
                <circle
                  class="dot"
                  class:good={d.correct}
                  class:miss={!d.correct}
                  cx={cx(i)}
                  cy={y(d.actual)}
                  r={Math.max(3.5, Math.min(6, barW / 2))}
                />
              {/if}
            </g>
          {/if}
          {#if xLabel(i)}
            <text
              class="ax"
              class:now={d.today}
              x={Math.min(cx(i), width - 2)}
              y={height - 6}
              text-anchor={cx(i) + 22 > width ? 'end' : 'middle'}>{xLabel(i)}</text
            >
          {/if}
        {/each}
      </svg>
    {/if}
  </div>
  <p class="day" aria-live="polite">{selDay ? dayText(selDay) : t('state.noData')}</p>
  {#if counts.nSpan}
    <p class="spancount">
      {t('hits.spanCount', { k: counts.inSpan, n: counts.nSpan })}
    </p>
  {/if}
</div>

<style>
  .hits {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .head {
    margin: 0;
    font-size: 15px;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    align-items: baseline;
  }
  .head strong {
    font-size: 17px;
    font-variant-numeric: tabular-nums;
  }
  .goal {
    color: var(--muted);
    font-size: 14px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 14px;
    color: var(--muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend i {
    display: inline-block;
  }
  .legend .win {
    width: 10px;
    height: 16px;
    border-radius: 3px;
    background: var(--faint);
  }
  .legend .span {
    width: 2px;
    height: 16px;
    background: var(--muted);
  }
  .legend .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .legend .dot.good {
    background: var(--good);
  }
  .legend .dot.miss {
    background: var(--highlight);
  }
  .unit {
    color: var(--muted);
    font-size: var(--small);
    margin-bottom: -6px;
  }
  .plot {
    width: 100%;
    min-width: 0;
    touch-action: pan-y;
    cursor: pointer;
    border-radius: 8px;
  }
  .plot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .ax {
    fill: var(--muted);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .ax.now {
    fill: var(--text);
    font-weight: 600;
  }
  .sel {
    fill: var(--accent-bg);
    opacity: 0.7;
  }
  rect.win {
    fill: var(--faint);
  }
  .spanline {
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0.6;
  }
  .fc {
    stroke: var(--text-2);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .today rect.win,
  .today .fc,
  .today .spanline {
    opacity: 0.5;
  }
  circle.dot {
    stroke: var(--surface);
    stroke-width: 1.5;
  }
  circle.good {
    fill: var(--good);
  }
  circle.miss {
    fill: var(--highlight);
  }
  .day {
    margin: 0;
    font-size: 14px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    min-height: 1.4em;
  }
  .spancount {
    margin: 0;
    font-size: var(--small);
    color: var(--muted);
  }
  @media (max-width: 600px) {
    .spancount {
      font-size: 14px;
    }
  }
</style>
