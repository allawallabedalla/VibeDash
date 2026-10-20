<script lang="ts">
  import { currentBackends, currentData, currentSource, store } from '../app/data.svelte';
  import { i18n, t, time } from '../i18n/index.svelte';

  const house = $derived(currentData());

  let { title }: { title: string } = $props();

  const date = $derived(
    new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      timeZone: house.timeZone,
      day: 'numeric',
      month: 'long',
    }).format(store.stale ?? house.now),
  );
</script>

<h1>{title}</h1>
<p class="lead">
  {t('page.asOf', {
    date,
    time: time(store.stale ?? house.now, house.timeZone),
    source:
      currentSource() === 'demo'
        ? t('source.demo')
        : currentBackends()
            .map((b) => t(b === 'influx' ? 'source.influx' : 'source.homeassistant'))
            .join(' + '),
  })}
  {#if store.stale}<span class="refresh"> · {t('state.refreshing')}</span>{/if}
</p>

<style>
  .refresh {
    color: var(--accent);
  }
</style>
