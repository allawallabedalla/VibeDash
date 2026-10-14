<script lang="ts" module>
  export interface Flow {
    label: string;
    value: number | null;
    color: string;
    approx?: boolean;
  }
</script>

<script lang="ts">
  /** A few named amounts as soft bars on one scale (where the energy went / came from). */
  import { num } from '../i18n/index.svelte';
  let { flows, unit = 'kWh' }: { flows: Flow[]; unit?: string } = $props();

  const max = $derived(Math.max(1e-9, ...flows.map((f) => f.value ?? 0)));
</script>

<ul class="flows">
  {#each flows as f (f.label)}
    <li>
      <span class="name">{f.label}</span>
      <span class="track"
        ><span
          class="fill"
          style:width="{f.value === null ? 0 : Math.max(2, (100 * f.value) / max)}%"
          style:background={f.color}
        ></span></span
      >
      <span class="value"
        >{#if f.value === null}–{:else}{f.approx ? '≈ ' : ''}{num(f.value, f.value < 10 ? 1 : 0)}
          {unit}{/if}</span
      >
    </li>
  {/each}
</ul>

<style>
  .flows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    display: grid;
    grid-template-columns: minmax(90px, 30%) 1fr auto;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .name {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    height: 12px;
    border-radius: 6px;
    background: var(--track);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 6px;
  }
  .value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    min-width: 64px;
    text-align: right;
  }
</style>
