<script lang="ts">
  /**
   * Real 7-day weather (via the VibeDash server, which asks Open-Meteo with a
   * rounded location). If the location is unknown, ask once: use the browser
   * location (with consent) or type a place. Never loads forever.
   */
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import DayList, { type DayRow } from '../components/DayList.svelte';
  import { i18n, t } from '../i18n/index.svelte';

  interface Day {
    tag: string;
    sonneH: number | null;
    tMin: number | null;
    tMax: number | null;
    regenMm: number | null;
  }

  let { timeZone }: { timeZone: string } = $props();

  type State =
    | { s: 'loading' }
    | { s: 'off' }
    | { s: 'ask' }
    | { s: 'error'; reason: string }
    | { s: 'ready'; days: Day[]; name?: string };
  let view = $state<State>({ s: 'loading' });
  let place = $state('');
  let busy = $state(false);
  let message = $state('');
  const canLocate =
    typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;

  async function request(url: string, init?: RequestInit) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    // No VibeDash server (static build): treat as "weather off".
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      return { status: 404, body: {} as Record<string, unknown> };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  }

  async function loadWeather() {
    view = { s: 'loading' };
    try {
      const loc = await request('/api/location');
      if (loc.status !== 200 || loc.body.enabled === false) return void (view = { s: 'off' });
      if (!loc.body.location) return void (view = { s: 'ask' });
      const w = await request('/api/weather');
      if (w.status !== 200) {
        view = { s: 'error', reason: String(w.body.error ?? 'network') };
        return;
      }
      const l = w.body.location as { name?: string };
      view = { s: 'ready', days: w.body.days as Day[], name: l.name };
    } catch (e) {
      view = { s: 'error', reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }

  async function save(body: unknown) {
    busy = true;
    message = '';
    try {
      const r = await request('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 200) await loadWeather();
      else message = r.body.error === 'place_not_found' ? t('weather.notFound') : t('state.noData');
    } catch {
      message = t('reason.network');
    } finally {
      busy = false;
    }
  }

  function useBrowserLocation() {
    busy = true;
    navigator.geolocation.getCurrentPosition(
      (p) => void save({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => {
        busy = false;
        message = t('weather.denied');
      },
      { timeout: 15_000, maximumAge: 86_400_000 },
    );
  }

  type Sky = 'sun' | 'cloudSun' | 'cloud' | 'rain';
  const sky = (d: Day): Sky =>
    (d.regenMm ?? 0) >= 1
      ? 'rain'
      : (d.sonneH ?? 0) >= 8
        ? 'sun'
        : (d.sonneH ?? 0) >= 4
          ? 'cloudSun'
          : 'cloud';

  const rows = $derived<DayRow[]>(
    view.s === 'ready'
      ? view.days
          .filter((d) => d.tMin !== null && d.tMax !== null)
          .map((d, i) => ({
            label:
              i === 0
                ? t('days.today')
                : new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
                    timeZone,
                    weekday: 'short',
                  }).format(new Date(`${d.tag}T12:00:00Z`)),
            sky: sky(d),
            skyLabel: t(`sky.${sky(d)}`),
            tempLow: Math.round(d.tMin!),
            tempHigh: Math.round(d.tMax!),
            rainMm: d.regenMm,
            sunHours: d.sonneH,
          }))
      : [],
  );

  onMount(() => {
    void loadWeather();
  });
</script>

{#if view.s !== 'off'}
  <h2>{t('days.title')}</h2>
  <Card
    title={t('days.title')}
    icon="cloudSun"
    color="var(--sun)"
    note={view.s === 'ready'
      ? t('weather.note', { place: view.name ?? t('weather.here') })
      : undefined}
  >
    {#if view.s === 'loading'}
      <p class="muted-note">{t('state.loading')}</p>
    {:else if view.s === 'error'}
      <p class="muted-note">
        {t('state.noData')} · {t(
          `reason.${view.reason === 'timeout' ? 'timeout' : view.reason === 'upstream' ? 'upstream' : 'network'}`,
        )}
      </p>
      <button type="button" class="action" onclick={loadWeather}>{t('state.retry')}</button>
    {:else if view.s === 'ask'}
      <p class="ask">{t('weather.ask')}</p>
      <div class="actions">
        {#if canLocate}
          <button type="button" class="action" disabled={busy} onclick={useBrowserLocation}>
            {t('weather.useLocation')}
          </button>
        {/if}
        <form
          class="place"
          onsubmit={(e) => {
            e.preventDefault();
            if (place.trim()) void save({ place, language: i18n.locale });
          }}
        >
          <input
            type="text"
            bind:value={place}
            maxlength="80"
            placeholder={t('weather.placeHint')}
            aria-label={t('weather.placeHint')}
            autocomplete="address-level2"
          />
          <button type="submit" class="action" disabled={busy || !place.trim()}
            >{t('weather.save')}</button
          >
        </form>
      </div>
      {#if message}<p class="muted-note">{message}</p>{/if}
      <p class="muted-note">{t('weather.privacy')}</p>
    {:else}
      <DayList days={rows} />
    {/if}
  </Card>
{/if}

<style>
  .ask {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .place {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    flex: 1 1 260px;
    min-width: 0;
  }
  input {
    flex: 1 1 160px;
    min-width: 0;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 22px;
    border: 0;
    box-shadow: inset 0 0 0 1px var(--line);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 16px; /* no zoom on iPhone */
  }
  .action {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    cursor: pointer;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
