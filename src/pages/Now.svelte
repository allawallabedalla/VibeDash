<script lang="ts">
  /** "Now": current values first, where the power comes from, last 24 hours. */
  import { currentData } from '../app/data.svelte';
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
  import SourceArc from '../components/SourceArc.svelte';
  import Sparkline from '../components/Sparkline.svelte';
  import Tile from '../components/Tile.svelte';
  import TileRow from '../components/TileRow.svelte';
  import { last24h, sourcesAt, typicalProfile } from '../demo';
  import { num, t, time } from '../i18n/index.svelte';
  import PageHead from './PageHead.svelte';

  const house = currentData();

  const kw = (w: number | null) => (w === null ? null : w / 1000);
  const energy = $derived([
    sunNowTile(house),
    loadNowTile(house),
    batteryNowTile(house),
    gridNowTile(house),
  ]);
  const climate = $derived([tempTile(house), humidityTile(house)]);
  const roomTemps = $derived(roomsNow(house, 'temperature'));
  const roomHumidity = $derived(roomsNow(house, 'humidity'));

  const src = sourcesAt(house, house.now - 60_000);
  const band = typicalProfile(house, 'load_power');
  const bandKw = { low: band.low.map(kw), high: band.high.map(kw) };
  const sensorGap = house.issues.find(
    (i) => i.kind === 'gap' && i.entityIds.includes('living_temp'),
  );
</script>

<div class="page">
  <PageHead title={t('page.now')} />
  <div class="row-gap"></div>

  <TileRow count={4}>
    {#each energy as tile (tile.label)}<Tile {...tile} />{/each}
  </TileRow>

  <h2>{t('page.house')}</h2>
  <div class="cards wide-left">
    <Card
      title={t('spark.home')}
      icon="home"
      color="var(--home)"
      note={t('spark.homeBand', { n: band.n })}
    >
      <Sparkline
        values={last24h(house, 'load_power').map(kw)}
        band={bandKw}
        color="var(--home)"
        min={0}
        height={96}
        label={t('spark.home')}
      />
    </Card>
    <Card title={t('page.sources')} icon="home" color="var(--home)">
      {#if src}
        <SourceArc
          parts={[
            { label: t('sources.sun'), value: src.sun, color: 'var(--sun)' },
            { label: t('sources.battery'), value: src.battery, color: 'var(--battery)' },
            { label: t('sources.grid'), value: src.grid, color: 'var(--import)' },
          ]}
          total={num(src.total / 1000, 1)}
          caption={t('tile.home')}
        />
      {:else}
        <p class="muted-note">{t('sources.gap')}</p>
      {/if}
    </Card>
  </div>

  <h2>{t('page.trends')}</h2>
  <div class="cards">
    <Card title={t('spark.sun')} icon="sun" color="var(--sun)">
      <Sparkline
        values={last24h(house, 'pv_power').map(kw)}
        color="var(--sun)"
        min={0}
        height={72}
        label={t('spark.sun')}
      />
    </Card>
    <Card title={t('spark.grid')} icon="grid" color="var(--feed)" note={t('spark.gridNote')}>
      <Sparkline
        values={last24h(house, 'grid_power').map(kw)}
        signed
        color="var(--feed)"
        height={72}
        label={t('spark.grid')}
      />
    </Card>
  </div>

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
