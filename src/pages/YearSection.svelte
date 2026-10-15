<script lang="ts">
  /**
   * "Im Jahr": sun, grid import and feed-in per day over the year, this year
   * against earlier ones where data reaches back. Live from the meters' daily
   * values (/api/daily), in the demo from made-up years.
   */
  import { onMount } from 'svelte';
  import { currentSource } from '../app/data.svelte';
  import YearCard from '../components/YearCard.svelte';
  import { demoDaily, type DemoData, type YearKind } from '../demo';
  import { i18n, num, t } from '../i18n/index.svelte';
  import { localDateKey, localMidnight } from '../model/time';
  import { yearLines } from '../model/year';
  import type { IconName } from '../components/Icon.svelte';

  let { house }: { house: DemoData } = $props();

  interface Topic {
    kind: YearKind;
    id: string;
    title: string;
    icon: IconName;
    color: string;
    textColor: string;
    sentence: (v: string) => [string, string, string];
  }
  const topics = $derived<Topic[]>([
    {
      kind: 'pv',
      id: 'pv_energy',
      title: t('year.sun'),
      icon: 'sun',
      color: 'var(--sun)',
      textColor: 'var(--sun-text)',
      sentence: () => split(t('year.sun.sentence')),
    },
    {
      kind: 'import',
      id: 'import_energy',
      title: t('year.import'),
      icon: 'grid',
      color: 'var(--import)',
      textColor: 'var(--import-text)',
      sentence: () => split(t('year.import.sentence')),
    },
    {
      kind: 'feed',
      id: 'feed_in_energy',
      title: t('year.feed'),
      icon: 'grid',
      color: 'var(--feed)',
      textColor: 'var(--feed-text)',
      sentence: () => split(t('year.feed.sentence')),
    },
  ]);

  // "**bold** rest" -> [before, bold, after]
  const split = (s: string): [string, string, string] => {
    const m = /^(.*?)\*\*(.+?)\*\*(.*)$/.exec(s);
    return m ? [m[1]!.trim(), m[2]!, m[3]!.trim()] : [s, '', ''];
  };
  const tz = $derived(house.timeZone);
  const demo = currentSource() === 'demo';
  let rows = $state<Record<string, [number, number | null][]>>({});

  onMount(async () => {
    const out: Record<string, [number, number | null][]> = {};
    for (const k of ['pv', 'import', 'feed'] as const) {
      const id = { pv: 'pv_energy', import: 'import_energy', feed: 'feed_in_energy' }[k];
      if (demo) {
        out[id] = demoDaily(k, house.now, tz);
        continue;
      }
      try {
        const res = await fetch(`/api/daily/${id}?days=800`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) out[id] = ((await res.json()) as { days: [number, number | null][] }).days;
      } catch {
        // no card for this one
      }
    }
    rows = out;
  });

  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  const dm = (ms: number) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric', month: 'numeric' }).format(
      ms + 12 * 3_600_000,
    );
  const today = $derived(localDateKey(house.now, tz));

  const cards = $derived(
    topics
      .filter((tp) => rows[tp.id]?.length)
      .map((tp) => {
        const r = rows[tp.id]!.filter(([t0]) => localDateKey(t0 + 12 * 3_600_000, tz) !== today);
        const last = [...r].reverse().find(([, v]) => v !== null);
        const year = new Date(house.now).getUTCFullYear();
        // this year: only days with a value count, a missing day is not 0 (N-01)
        const thisYear = r.filter(([t0]) =>
          localDateKey(t0 + 12 * 3_600_000, tz).startsWith(String(year)),
        );
        const known = thisYear.filter(([, v]) => v !== null);
        const sum = known.reduce((s, [, v]) => s + v!, 0);
        const fromDay = known[0]?.[0];
        // calendar days from the first known day to yesterday without a value
        // (also days the server has no row for at all)
        const span = known.length
          ? Math.round((localMidnight(house.now, tz) - localMidnight(fromDay!, tz)) / 86_400_000)
          : 0;
        const missing = Math.max(0, span - known.length);
        const sums = known.length
          ? t('year.since', { from: dm(fromDay!), sum: num(sum), n: known.length }) +
            (missing ? ` · ${t('year.missing', { n: missing })}` : '')
          : '';
        return {
          ...tp,
          value: last ? num(last[1]!, last[1]! < 10 ? 1 : 0) : '–',
          lines: yearLines(r, tz),
          caption: [demo ? t('year.demo') : '', t('year.caption'), sums]
            .filter(Boolean)
            .join(' · '),
          endLabel: last ? dm(last[0]) : '',
        };
      }),
  );
</script>

{#if cards.length}
  <h2>{t('year.title')}</h2>
  <div class="year">
    {#each cards as c (c.id)}
      <YearCard
        title={c.title}
        icon={c.icon}
        color={c.color}
        textColor={c.textColor}
        value={c.value}
        unit="kWh"
        sentence={c.sentence(c.value)}
        lines={c.lines}
        caption={c.caption}
        startLabel={i18n.locale === 'de' ? '1.1.' : '1 Jan'}
        endLabel={c.endLabel}
        info={{
          what: t('year.info.what'),
          source: demo ? t('year.info.demo') : t('year.info.source'),
        }}
      />
    {/each}
  </div>
{/if}

<style>
  .year {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 1000px) {
    .year {
      grid-template-columns: 1fr;
      gap: 10px;
    }
  }
</style>
