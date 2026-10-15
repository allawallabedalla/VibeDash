<script lang="ts">
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
  const demo = currentSource() === 'demo';
  const days = $derived<WeatherCardDay[]>(
    own
      ? weatherDays(house).map((d) => ({
          label: label(d.offset, d.start),
          when: d.offset < 0 ? 'past' : d.offset === 0 ? 'today' : 'ahead',
          tempHigh: d.tempHigh,
          tempLow: d.tempLow,
          rainMm: d.rainMm,
          sunHours: d.sunHours,
          pv: d.pv,
          pvSoFar: d.pvSoFar,
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
  <Card title={t('wd.title')} icon="cloudSun" color="var(--sun)" note={t('wd.note')}>
    <WeatherDays {days} />
  </Card>
{/if}
