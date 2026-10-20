<script lang="ts">
  /** Prototype page (#/zeitstrahl): charge windows on a made-up day – to try the look and the speed. */
  import Card from '../components/Card.svelte';
  import ChargeTimeline from '../components/ChargeTimeline.svelte';
  import { DEMO_HOUSE, demoCases } from '../app/charge-timeline';
  import { i18n } from '../i18n/index.svelte';

  const cases = demoCases();
  const de = $derived(i18n.locale === 'de');
</script>

<div class="page">
  <h1>{de ? 'Ladefenster ausprobieren' : 'Try charge windows'}</h1>
  <p class="sub">
    {de
      ? 'Prototyp mit erfundenen Daten (31 Wetterfälle, Hausakku 20 kWh, Auto braucht 35 kWh). Schaltet nichts.'
      : 'Prototype with made-up data (31 weather cases, house battery 20 kWh, car needs 35 kWh). Switches nothing.'}
  </p>
  <Card title={de ? 'Heute' : 'Today'} icon="plugCar" color="var(--battery)">
    <ChargeTimeline {cases} house={DEMO_HOUSE} />
  </Card>
</div>

<style>
  .page {
    max-width: 1136px;
    margin: 0 auto;
  }
  h1 {
    margin: 8px 0 4px;
  }
  .sub {
    color: var(--muted);
    margin: 0 0 16px;
  }
</style>
