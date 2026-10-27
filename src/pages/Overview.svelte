<script lang="ts">
  /** M2: first real page. First level tiles, then today, then look-back table, then questions. */
  import { onMount, tick, untrack } from 'svelte';
  import { currentData, currentSource, store } from '../app/data.svelte';
  import { groupQuestions, questions } from '../app/questions';
  import { reviewNote, reviewRows } from '../app/review';
  import {
    autarkyTile,
    batteryTile,
    gridTile,
    loadTile,
    sunTile,
    tempTile,
    presenceTile,
    tomorrowTile,
    yieldTodayTile,
    demoSunForecast,
    type SunForecast,
  } from '../app/tiles';
  import Card from '../components/Card.svelte';
  import Icon from '../components/Icon.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatusBar, { type StatusItem } from '../components/StatusBar.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { hourlyPvForecast, pvTimeSeries, type Period } from '../demo';
  import { notesIn } from '../model/notes';
  import { localMidnight } from '../model/time';
  import { i18n, t } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';
  import WeatherDaysCard from './WeatherDaysCard.svelte';

  const house = $derived(currentData());

  const tz = $derived(house.timeZone);
  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');

  const allQs = $derived(questions(house, currentSource()));
  // yes/no answers, kept on the server for the whole house (Mac and phone the same)
  let answers = $state<Record<string, { a: 'yes' | 'no' }>>({});
  let canAnswer = $state(false);
  onMount(() => {
    fetch('/api/answers')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { answers: typeof answers; writable: boolean } | null) => {
        if (j) [answers, canAnswer] = [j.answers, j.writable];
      })
      .catch(() => {});
  });
  const answer = async (id: string, a: 'yes' | 'no' | null) => {
    const before = answers;
    const next = { ...answers };
    if (a) next[id] = { a };
    else delete next[id];
    answers = next;
    try {
      const r = await fetch('/api/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, answer: a }),
      });
      if (!r.ok) throw new Error(String(r.status));
      answers = ((await r.json()) as { answers: typeof answers }).answers;
    } catch {
      answers = before;
    }
  };
  const qs = $derived(allQs.filter((q) => !answers[q.id]));
  const answered = $derived(allQs.filter((q) => answers[q.id]));
  const qGroups = $derived(groupQuestions(qs));
  // Open on wide screens, folded on the phone (tap to open).
  let wide = $state(true);
  onMount(() => {
    wide = !window.matchMedia('(max-width: 600px)').matches;
  });
  // a pill with questions jumps to them and opens the groups of its area
  let focusArea = $state<'energy' | 'climate' | null>(null);
  const showQuestions = async (area: 'energy' | 'climate') => {
    focusArea = area;
    await tick();
    document.getElementById('fragen')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const status = $derived.by<StatusItem[]>(() => {
    const item = (area: 'energy' | 'battery' | 'climate'): StatusItem => {
      const n = qs.filter((q) => q.area === area).length;
      const name = t(`area.${area}`);
      return n === 0
        ? { label: t('area.ok', { area: name }), state: 'ok' }
        : {
            label: t('area.question', {
              area: name,
              count: n === 1 ? t('q.one') : t('q.count', { n }),
            }),
            state: 'look',
            ...(area !== 'battery' ? { onclick: () => showQuestions(area) } : {}),
          };
    };
    return [item('energy'), item('battery'), item('climate')];
  });

  // Forecast line in the sun tile (M9): the demo's own model, or live the hourly PV
  // forecast of the forecasting service. Live without it: no forecast, no made-up line.
  // the forecast line is set up once per page (the service may replace it); fresh series do not change it
  // svelte-ignore state_referenced_locally
  let sunFc = $state<SunForecast | null>(
    currentSource() === 'demo' ? demoSunForecast(house) : null,
  );
  // the house's own hourly forecast, if mapped (pv_forecast, _low, _high in kW or W)
  {
    // read once per page: the forecast line does not follow every fresh series
    const start = untrack(() => localMidnight(house.now, house.timeZone));
    const x = Array.from({ length: 24 }, (_, h) => start + h * 3_600_000 + 1_800_000);
    const own = untrack(() => hourlyPvForecast(house, x));
    if (own && currentSource() !== 'demo') {
      // kW like the measured line (Audit02 DE2-01: W here made the measured line look flat)
      sunFc = {
        at: x.map((t) => t - 1_800_000),
        stepMs: 3_600_000,
        p10: own.low.some((v) => v !== null) ? own.low : own.value,
        p50: own.value,
        p90: own.high.some((v) => v !== null) ? own.high : own.value,
      };
    }
  }
  onMount(async () => {
    if (currentSource() === 'demo' || !store.pv || sunFc) return;
    try {
      const res = await fetch('/api/pv/prognose', { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const body = (await res.json()) as {
        prognosen?: { stunden: string[]; p10: number[]; p50: number[]; p90: number[] }[];
      };
      const today = body.prognosen?.find((d) =>
        d.stunden.some((h) => {
          const t = Date.parse(h);
          return t <= house.now && house.now < t + 3_600_000;
        }),
      );
      if (today) {
        sunFc = {
          at: today.stunden.map((h) => Date.parse(h)),
          stepMs: 3_600_000,
          p10: today.p10,
          p50: today.p50,
          p90: today.p90,
        };
      }
    } catch {
      // no forecast line – the tile still shows the measured values
    }
  });
  // the period switch sits at the curve it filters; the autarky tile above is
  // always today, the autarky of the chosen period stands under the curve
  let period = $state<Period>('day');
  const row1 = $derived([
    sunTile(house, sunFc),
    loadTile(house),
    batteryTile(house),
    gridTile(house),
  ]);
  const row2 = $derived(
    [
      yieldTodayTile(house),
      tomorrowTile(house),
      autarkyTile(house, 'day'),
      tempTile(house),
      presenceTile(house),
    ].filter((x): x is NonNullable<typeof x> => x !== null),
  );

  const tsData = $derived(pvTimeSeries(house, period));
  // known events (mapping notes): named under the chart they show up in, and listed
  const span = (n: { from: number; to: number }) => {
    const f = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const tf = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${f.format(n.from)}–${tf.format(n.to)}`;
  };
  const periodAutarky = $derived.by(() => {
    if (period === 'day') return '';
    const a = autarkyTile(house, period);
    return a.value === '–' ? '' : t('ts.autarky', { pct: a.value, sub: a.sub ?? '' });
  });
  const chartNote = $derived(
    [
      periodAutarky,
      ...notesIn(house.notes, tsData.x[0] ?? 0, (tsData.x.at(-1) ?? 0) + 86_400_000).map((n) =>
        t('notes.gap', { when: span(n), text: n.text }),
      ),
    ]
      .filter(Boolean)
      .join(' · ') || undefined,
  );
  const known = $derived(
    notesIn(house.notes, house.now - 14 * 86_400_000, house.now).map((n) => ({
      from: n.from,
      label: t('notes.item', { when: span(n), text: n.text }),
    })),
  );

  let reviewCount = $state<'7' | '30'>('7');
  const rows = $derived(reviewRows(house, Number(reviewCount)));
  const columns = $derived([
    { key: 'day', label: t('review.day') },
    { key: 'sun', label: t('review.sun'), align: 'right' as const },
    { key: 'load', label: t('review.load'), align: 'right' as const },
    { key: 'feed', label: t('review.feed'), align: 'right' as const, phone: false },
    { key: 'import', label: t('review.import'), align: 'right' as const, phone: false },
    { key: 'autarky', label: t('review.autarky'), align: 'right' as const },
  ]);
</script>

<div class="page">
  <PageHead title={t('page.overview')} />

  <div class="status"><StatusBar label={t('status.label')} items={status} /></div>

  <WeatherDaysCard {house} />
  <div class="row-gap"></div>

  <TileRow count={4}>
    {#each row1 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>
  <div class="row-gap"></div>
  <TileRow count={row2.length}>
    {#each row2 as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <div class="period-head">
    <h2>{period === 'day' ? t('page.today') : t('page.period')}</h2>
    <div class="period">
      <Segmented
        options={[
          { id: 'day', label: t('ts.day') },
          { id: 'week', label: t('ts.week') },
          { id: 'month', label: t('ts.month') },
          { id: 'span1', label: t('ts.span1') },
          { id: 'span', label: t('ts.span') },
        ]}
        bind:value={() => period, (v) => (period = v as Period)}
        label={t('page.period')}
      />
    </div>
  </div>
  <div class="cards wide-left">
    <Card title={t('ts.title')} icon="sun" color="var(--sun)" note={chartNote}>
      <!-- the chart library loads after the first paint (first page < 200 KB JS) -->
      {#await import('../components/SoftTimeSeries.svelte') then { default: SoftTimeSeries }}
        <SoftTimeSeries
          data={tsData}
          periods={[{ id: period, label: '' }]}
          {period}
          labels={{
            actual: t('ts.actual'),
            forecast: t(`ts.fc.${tsData.kind}`),
            recomputed: t('ts.fc.recomputed'),
            band: t('ts.band'),
            periods: t('ts.periods'),
            empty: t('state.noData'),
          }}
          unit={tsData.unit === 'kW' ? 'kW' : t('ts.perDay')}
          timeZone={tz}
          {locale}
        />
      {/await}
    </Card>
    <!-- the drawing follows right after the first paint (first-page budget) -->
    {#await import('./EnergyFlowCard.svelte') then { default: EnergyFlowCard }}
      <EnergyFlowCard {house} />
    {/await}
  </div>

  <!-- loaded on demand: keeps the first page under its JS budget -->
  {#await import('./YearSection.svelte') then { default: YearSection }}<YearSection
      {house}
    />{/await}

  <h2>{t('page.review')}</h2>
  <Card title={t('review.title')} icon="clock" color="var(--muted)" note={reviewNote(house)}>
    {#snippet actions()}
      <Segmented
        options={[
          { id: '7', label: t('ts.week') },
          { id: '30', label: t('ts.month') },
        ]}
        bind:value={reviewCount}
        label={t('ts.periods')}
      />
    {/snippet}
    <!-- below the fold: loaded after the first paint (first-page budget) -->
    {#await import('../components/DataTable.svelte') then { default: DataTable }}
      <DataTable {columns} {rows} caption={t('review.title')} />
    {/await}
  </Card>

  {#if known.length > 0}
    <h2>{t('notes.title')}</h2>
    <Card title={t('notes.title')} icon="clock" color="var(--muted)">
      <ul class="questions">
        {#each known as n (n.from)}
          <li><span class="qicon"><Icon name="okCircle" size={18} /></span>{n.label}</li>
        {/each}
      </ul>
    </Card>
  {/if}

  {#if allQs.length > 0}
    <h2 id="fragen">{t('q.title')}</h2>
    <!-- below the fold: loaded after the first paint (first-page budget) -->
    {#await import('./QuestionsCard.svelte') then { default: QuestionsCard }}
      <QuestionsCard
        open={qs}
        groups={qGroups}
        {answered}
        {answers}
        {canAnswer}
        openAll={wide && qGroups.length <= 4}
        {focusArea}
        onanswer={answer}
      />
    {/await}
  {/if}
</div>

<style>
  .status {
    margin: 16px 0 16px;
  }
  #fragen {
    scroll-margin-top: 16px;
  }
  /* heading, then the switch on the left, right above the curve it filters */
  .period-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 12px;
  }
  .period-head h2 {
    margin: 0;
  }
  .questions {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .questions li {
    display: flex;
    gap: 10px;
    line-height: 1.45;
  }
  .qicon {
    flex: none;
    color: var(--fair-text);
    padding-top: 1px;
  }
</style>
