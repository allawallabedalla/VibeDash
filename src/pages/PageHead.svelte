<script lang="ts">
  import { demo } from '../app/data';
  import { i18n, t, time } from '../i18n/index.svelte';

  let { title }: { title: string } = $props();

  const date = $derived(
    new Intl.DateTimeFormat(i18n.locale === 'de' ? 'de-DE' : 'en-GB', {
      timeZone: demo.timeZone,
      day: 'numeric',
      month: 'long',
    }).format(demo.now),
  );
</script>

<h1>{title}</h1>
<p class="lead">{t('page.asOf', { date, time: time(demo.now, demo.timeZone) })}</p>
