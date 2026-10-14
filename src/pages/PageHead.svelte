<script lang="ts">
  import { currentData, currentSource } from '../app/data.svelte';
  import { i18n, t, time } from '../i18n/index.svelte';

  const house = currentData();

  let { title }: { title: string } = $props();

  const date = $derived(
    new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      timeZone: house.timeZone,
      day: 'numeric',
      month: 'long',
    }).format(house.now),
  );
</script>

<h1>{title}</h1>
<p class="lead">
  {t('page.asOf', {
    date,
    time: time(house.now, house.timeZone),
    source: t(currentSource() === 'influx' ? 'source.influx' : 'source.demo'),
  })}
</p>
