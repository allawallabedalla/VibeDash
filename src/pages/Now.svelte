<script lang="ts">
  /** "Now": current values first, where the power comes from, last 24 hours. */
  import { currentData, currentSource } from '../app/data.svelte';
  import {
    batteryNowTile,
    gridNowTile,
    humidityTile,
    loadNowTile,
    roomsNow,
    sunNowTile,
    tempTile,
  } from '../app/tiles';
  import Card from '../components/Card.svelte';
  import RoomRanges from '../components/RoomRanges.svelte';
  import OriginDay from '../components/OriginDay.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { onMount } from 'svelte';
  import { originToday, ORIGIN_STEP_MS, stepLookup } from '../app/origin-day';
  import { demoSunForecast } from '../app/sun-forecast';
  import { hourlyPvForecast, last24h } from '../demo';
  import { localMidnight } from '../model/time';
  import { t, time } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';

  const house = $derived(currentData());

  const energy = $derived([
    sunNowTile(house),
    loadNowTile(house),
    batteryNowTile(house),
    gridNowTile(house),
  ]);
  const climate = $derived([tempTile(house), humidityTile(house)]);
  const roomTemps = $derived(roomsNow(house, 'temperature'));
  const roomHumidity = $derived(roomsNow(house, 'humidity'));

  // sun forecast for the faint part from "now" on: the demo's own model, live the house's
  // hourly forecast (pv_forecast) if mapped – without one only the usual consumption
  const sunFc = $derived.by(() => {
    if (currentSource() === 'demo') {
      const f = demoSunForecast(house);
      return f ? stepLookup(f.at, f.stepMs, f.p50) : null;
    }
    const from = localMidnight(house.now, house.timeZone);
    const starts = Array.from({ length: 100 }, (_, i) => from + i * ORIGIN_STEP_MS);
    const own = hourlyPvForecast(
      house,
      starts.map((s) => s + ORIGIN_STEP_MS / 2),
    );
    return own ? stepLookup(starts, ORIGIN_STEP_MS, own.value) : null;
  });
  const origin = $derived(originToday(house, sunFc));
  const originNote = $derived(
    origin?.forecast ? t('oday.note', { n: origin.forecast.days }) : undefined,
  );
  let phone = $state(false);
  onMount(() => {
    phone = window.matchMedia('(max-width: 600px)').matches;
  });
  const sensorGap = $derived(
    house.issues.find((i) => i.kind === 'gap' && i.entityIds.includes('living_temp')),
  );
</script>

<div class="page">
  <PageHead title={t('page.now')} />
  <div class="row-gap"></div>

  <TileRow count={4}>
    {#each energy as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('page.today')}</h2>
  {#if origin}
    <Card
      title={t('oday.title')}
      icon="home"
      color="var(--home)"
      note={originNote}
      info={{
        what: t('oday.info.what'),
        source: t('oday.info.source', { n: origin.forecast?.days ?? 0 }),
      }}
    >
      <OriginDay day={origin} timeZone={house.timeZone} height={phone ? 150 : 190} />
    </Card>
  {:else}
    <p class="muted-note">{t('sources.gap')}</p>
  {/if}

  <h2>{t('area.climate')}</h2>
  <div class="cards">
    <TileRow count={2}>
      {#each climate as tile (tile.label)}<Tile {...tile} />{/each}
    </TileRow>
    <Card
      title={t('spark.temp')}
      icon="thermometer"
      color="var(--climate)"
      note={sensorGap
        ? t('spark.gap', {
            from: time(sensorGap.from, house.timeZone),
            to: time(sensorGap.to, house.timeZone),
          })
        : undefined}
    >
      <Sparkline
        values={last24h(house, 'living_temp')}
        color="var(--climate)"
        height={72}
        label={t('spark.temp')}
      />
    </Card>
  </div>
  {#if roomTemps.length > 1 || roomHumidity.length > 1}
    <div class="cards">
      {#if roomTemps.length > 1}
        <Card
          title={t('now.roomsTemp')}
          icon="thermometer"
          color="var(--climate)"
          note={t('now.roomsNote')}
        >
          <RoomRanges rooms={roomTemps} label={t('now.roomsTemp')} />
        </Card>
      {/if}
      {#if roomHumidity.length > 1}
        <Card
          title={t('now.roomsHumidity')}
          icon="droplet"
          color="var(--climate)"
          note={t('now.roomsNote')}
        >
          <RoomRanges rooms={roomHumidity} unit="%" label={t('now.roomsHumidity')} />
        </Card>
      {/if}
    </div>
  {/if}
</div>
