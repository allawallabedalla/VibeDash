<script lang="ts">
  import { onMount } from 'svelte';
  /**
   * "Weather and yield" from the house's own weather series; in the demo from
   * the made-up outlook. Renders nothing when neither exists.
   */
  import { currentSource } from '../app/data.svelte';
  import { hasWeatherDays, weatherDays } from '../app/weather-days';
  import Card from '../components/Card.svelte';
  import WeatherDays, { type WeatherCardDay } from '../components/WeatherDays.svelte';
  import { mulberry32, outlook, type DemoData } from '../demo';
  import { i18n, t } from '../i18n/index.svelte';

  let { house }: { house: DemoData } = $props();

  const locale = $derived(i18n.locale === 'de' ? 'de-DE' : 'en-GB');
  const label = (offset: number, start: number) =>
    offset === 0
      ? t('days.today')
      : new Intl.DateTimeFormat(locale, {
          timeZone: house.timeZone,
          weekday: 'short',
          day: 'numeric',
        })
          .format(start + 12 * 3_600_000)
          .replace(',', '');

  const own = $derived(hasWeatherDays(house));
  // the location (for the sun position in the sky reading), if the house has one
  let where = $state<{ lat: number; lon: number } | null>(null);
  onMount(async () => {
    if (currentSource() === 'demo') return;
    try {
      const r = await fetch('/api/location', { signal: AbortSignal.timeout(10_000) });
      const b = (await r.json()) as { location?: { lat: number; lon: number } | null };
      if (b.location) where = { lat: b.location.lat, lon: b.location.lon };
    } catch {
      // without it the sky reading uses the best days as they are
    }
  });
  const demo = currentSource() === 'demo';
  const days = $derived<WeatherCardDay[]>(
    own
      ? weatherDays(house, 3, 3, where).map((d) => ({
          label: label(d.offset, d.start),
          when: d.offset < 0 ? 'past' : d.offset === 0 ? 'today' : 'ahead',
          tempHigh: d.tempHigh,
          tempLow: d.tempLow,
          rainMm: d.rainMm,
          sunHours: d.sunHours,
          pv: d.pv,
          pvSoFar: d.pvSoFar,
          ...(d.source ? { source: d.source } : {}),
          ...(d.sky ? { sky: d.sky } : {}),
        }))
      : demo
        ? outlook(house, mulberry32(7)).map((d) => ({
            label: label(d.offset, d.start),
            when: d.offset < 0 ? 'past' : d.offset === 0 ? 'today' : 'ahead',
            tempHigh: d.tempHigh,
            tempLow: d.tempLow,
            rainMm: d.rainMm,
            sunHours: d.sunHours,
            pv: d.energy
              ? { value: d.energy.value, low: d.energy.low, high: d.energy.high, approx: true }
              : null,
          }))
        : [],
  );
</script>

{#if days.length}
  <Card
    title={t('wd.title')}
    icon="cloudSun"
    color="var(--sun)"
    note={house.series.outdoor_temp?.samples.length ? t('wd.noteOwn') : t('wd.note')}
  >
    <WeatherDays {days} />
  </Card>
{/if}
