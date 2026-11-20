<script lang="ts">
  /**
   * Calendar heat map (Audit05 I-3): one column per week, one row per weekday.
   * Green = a day without grid, lilac steps = kWh from the grid, grey hatched =
   * no value (never 0). Tap a day for its number. Drawn in CSS pixels, text 14 px.
   */
  import { i18n, num, t } from '../i18n/index.svelte';
  import {
    calendarCounts,
    calendarWeeks,
    FREE_BELOW_KWH,
    GRID_STEPS,
    type CalendarDay,
  } from '../model/calendar';

  let { days }: { days: CalendarDay[] } = $props();

  const uid = $props.id();
  let width = $state(600);
  const L = 30;
  const TOP = 22;
  const weeks = $derived(calendarWeeks(days));
  const counts = $derived(calendarCounts(days));
  const colW = $derived((width - L) / Math.max(weeks.length, 1));
  const gap = $derived(colW > 14 ? 3 : 1.5);
  const cellH = $derived(Math.min(22, Math.max(14, colW - gap)));
  const rowH = $derived(cellH + gap);
  const height = $derived(TOP + 7 * rowH);

  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(Date.UTC(2026, m - 1, 15))
      .replace(/\.$/, '');
  const weekday = (k: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
      .format(Date.UTC(2026, 0, 5 + k))
      .replace(/\.$/, '');
  // month labels: at the week a month starts, skipped when too close to the one before
  const months = $derived.by(() => {
    const out: { x: number; label: string }[] = [];
    weeks.forEach((w, i) => {
      if (w.month === null) return;
      const x = L + i * colW;
      if (out.length && x - out.at(-1)!.x < 34) return;
      out.push({ x, label: monthName(w.month) });
    });
    return out;
  });

  const OPACITY = [0.3, 0.5, 0.72, 0.95];
  const fill = (d: CalendarDay) =>
    d.state === 'free' ? 'var(--good)' : d.state === 'grid' ? 'var(--import)' : `url(#${uid}-gap)`;
  const opacity = (d: CalendarDay) =>
    d.state === 'free' ? (d.overGap ? 0.55 : 0.85) : d.state === 'grid' ? OPACITY[d.level - 1] : 1;

  let picked = $state<CalendarDay | null>(null);
  const dateText = (key: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      timeZone: 'UTC',
    }).format(Date.parse(`${key}T12:00:00Z`));
  const kwh = (v: number) => num(v, v < 10 ? 1 : 0);
  const readout = $derived.by(() => {
    const d = picked;
    if (!d) return '';
    const date = dateText(d.key);
    if (d.state === 'missing') return `${date} · ${t('cal.missing')}`;
    if (d.overGap) return t('cal.dayGap', { date });
    return `${date} · ${kwh(d.kwh!)} kWh${d.state === 'free' ? ` · ${t('cal.free')}` : ''}`;
  });
  // "27.3.–19.11.", with the year when the days reach into another year
  const span = $derived.by(() => {
    if (!days.length) return '';
    const a = days[0]!.key;
    const b = days.at(-1)!.key;
    const f = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'numeric',
      ...(a.slice(0, 4) !== b.slice(0, 4) ? { year: '2-digit' as const } : {}),
      timeZone: 'UTC',
    });
    return `${f.format(Date.parse(`${a}T12:00:00Z`))}–${f.format(Date.parse(`${b}T12:00:00Z`))}`;
  });
  const steps = $derived([
    { label: t('cal.free'), color: 'var(--good)', op: 0.85 },
    ...[FREE_BELOW_KWH, ...GRID_STEPS].map((lo, i, all) => ({
      label:
        i < all.length - 1 ? `${num(lo, lo < 1 ? 1 : 0)}–${num(all[i + 1]!)}` : `> ${num(lo)} kWh`,
      color: 'var(--import)',
      op: OPACITY[i]!,
    })),
    { label: t('cal.missing'), color: '', op: 1 },
  ]);
</script>

<div class="cal">
  <p class="lead">
    <span class="big">{counts.free}</span>
    <span class="of">{t('cal.of', { n: counts.known })}</span>
  </p>
  <p class="sub">
    {span}{counts.missing ? ` · ${t('cal.missingDays', { n: counts.missing })}` : ''}
  </p>
  <div class="grid" bind:clientWidth={width} style:height="{height}px">
    <svg {width} {height} role="img" aria-label="{counts.free} {t('cal.of', { n: counts.known })}">
      <defs>
        <pattern
          id="{uid}-gap"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" fill="var(--track)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--faint)" stroke-width="1.5" />
        </pattern>
      </defs>
      {#each months as m (m.x)}
        <text class="axis" x={m.x} y={15} text-anchor={m.x > width - 30 ? 'end' : 'start'}
          >{m.label}</text
        >
      {/each}
      {#each [0, 2, 4] as k (k)}
        <text class="axis" x={0} y={TOP + k * rowH + cellH / 2 + 5}>{weekday(k)}</text>
      {/each}
      {#each weeks as w, i (i)}
        {#each w.days as d, k (k)}
          {#if d}
            <rect
              role="button"
              tabindex="-1"
              aria-label={d.key}
              class="day"
              class:sel={picked?.key === d.key}
              x={L + i * colW}
              y={TOP + k * rowH}
              width={Math.max(colW - gap, 1)}
              height={cellH}
              rx={Math.min(4, (colW - gap) / 3)}
              fill={fill(d)}
              fill-opacity={opacity(d)}
              onpointerdown={() => (picked = picked?.key === d.key ? null : d)}
            />
          {/if}
        {/each}
      {/each}
    </svg>
  </div>
  {#if readout}
    <p class="readout" aria-live="polite">{readout}</p>
  {:else}
    <ul class="legend">
      {#each steps as s (s.label)}
        <li>
          <svg class="key" width="12" height="12" aria-hidden="true">
            {#if s.color}
              <rect width="12" height="12" rx="3" fill={s.color} fill-opacity={s.op} />
            {:else}
              <rect width="12" height="12" rx="3" fill="url(#{uid}-gap)" />
            {/if}
          </svg>{s.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cal {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lead {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .big {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    color: var(--good-text);
  }
  .of {
    font-size: 16px;
    font-weight: 600;
  }
  .sub {
    margin: -4px 0 4px;
    font-size: 14px;
    color: var(--muted);
  }
  .grid {
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .axis {
    font-size: 14px;
    fill: var(--muted);
  }
  .day {
    cursor: pointer;
  }
  .day.sel {
    stroke: var(--text);
    stroke-width: 2;
  }
  .day:focus {
    outline: none;
  }
  .readout {
    margin: 0;
    min-height: 1.4em;
    font-size: 14px;
    color: var(--text-2);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
    color: var(--text-2);
    min-height: 1.4em;
  }
  .key {
    display: inline-block;
    margin-right: 6px;
    vertical-align: -1px;
  }
</style>
