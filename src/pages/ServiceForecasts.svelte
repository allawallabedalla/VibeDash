<script lang="ts">
  /**
   * Accuracy of the forecasting service per named forecast (live mode). The
   * browser asks the VibeDash server, never the service. Clear end states:
   * collecting / open / assessable / no data.
   */
  import { onMount } from 'svelte';
  import AccuracyCard from '../components/AccuracyCard.svelte';
  import { i18n, num, t } from '../i18n/index.svelte';

  interface Guete {
    zustand: 'offen' | 'bewertbar';
    n: number;
    quelle: 'rueckrechnung' | 'live';
    korrekt_pct?: number | null;
    verlauf?: (number | null)[];
    schlaegt_faustregel_pct?: number;
  }
  interface Status {
    zustand: 'sammelt' | 'offen' | 'bewertbar';
    tage?: number;
    benoetigt?: number;
    ab_ca?: string;
    n?: number;
  }
  interface Item {
    name: string;
    status?: Status;
    guete?: Guete;
    error?: string;
  }

  let { active = $bindable(false) }: { active?: boolean } = $props();
  let items = $state<Item[] | null>(null);

  async function get(url: string): Promise<{ status: number; body: unknown }> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
        return { status: 404, body: {} };
      }
      return { status: res.status, body: await res.json() };
    } catch (e) {
      return { status: (e as Error).name === 'TimeoutError' ? 504 : 0, body: {} };
    }
  }

  onMount(async () => {
    const list = await get('/api/forecasts');
    const names = (list.body as { names?: string[] }).names ?? [];
    items = await Promise.all(
      names.map(async (name): Promise<Item> => {
        const [s, g] = await Promise.all([
          get(`/api/forecast/${name}/status`),
          get(`/api/forecast/${name}/guete`),
        ]);
        if (s.status !== 200) return { name, error: s.status === 504 ? 'timeout' : 'upstream' };
        return {
          name,
          status: s.body as Status,
          guete: g.status === 200 ? (g.body as Guete) : undefined,
        };
      }),
    );
    active = items.length > 0;
  });

  const label = (name: string) =>
    name.startsWith('pv')
      ? t('model.sun')
      : name.includes('verbrauch') || name.startsWith('load')
        ? t('model.load')
        : name;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${iso}T12:00:00Z`));
  const note = (g?: Guete) => {
    if (!g || g.zustand !== 'bewertbar') return undefined;
    const parts = [t(g.quelle === 'live' ? 'acc.live' : 'acc.backtest')];
    if (g.schlaegt_faustregel_pct)
      parts.push(t('acc.beats', { pct: num(g.schlaegt_faustregel_pct) }));
    return parts.join(' · ');
  };
</script>

{#if items && items.length > 0}
  <h2>{t('acc.service')}</h2>
  <div class="cards">
    {#each items as it (it.name)}
      {#if it.error}
        <AccuracyCard
          label={label(it.name)}
          pct={null}
          n={0}
          history={[]}
          note={t(`reason.${it.error as 'timeout' | 'upstream'}`)}
        />
      {:else if it.status?.zustand === 'sammelt'}
        <AccuracyCard
          label={label(it.name)}
          pct={null}
          n={0}
          history={[]}
          collecting={{
            have: it.status.tage ?? 0,
            need: it.status.benoetigt ?? 30,
            from: date(it.status.ab_ca ?? ''),
          }}
        />
      {:else}
        <AccuracyCard
          label={label(it.name)}
          pct={it.guete?.zustand === 'bewertbar' ? (it.guete.korrekt_pct ?? null) : null}
          n={it.guete?.n ?? it.status?.n ?? 0}
          history={it.guete?.verlauf ?? []}
          note={note(it.guete)}
        />
      {/if}
    {/each}
  </div>
  <p class="muted-note">{t('acc.serviceNote')}</p>
{/if}
