<script lang="ts" module>
  export interface Flow {
    label: string;
    value: number | null;
    /** bar colour */
    color: string;
    /** the same hue dark enough for the number (WCAG AA) */
    textColor?: string;
    approx?: boolean;
  }
</script>

<script lang="ts">
  /**
   * A few named amounts on one scale (where the energy went / came from): the
   * name above its bar, a soft pastel bar with a firm end, the amount in the
   * bar's colour on the right.
   */
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
          style:width="{f.value === null ? 0 : Math.max(1.5, (100 * f.value) / max)}%"
          style:--c={f.color}
        ></span></span
      >
      <span class="value" style:color={f.textColor ?? 'var(--text)'}
        >{#if f.value === null}–{:else}{f.approx ? '≈ ' : ''}{num(
            f.value,
            f.value < 10 ? 1 : 0,
          )}<span class="unit">{unit}</span>{/if}</span
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
    gap: 12px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'name name'
      'track value';
    align-items: center;
    column-gap: 14px;
    row-gap: 4px;
  }
  .name {
    grid-area: name;
    font-size: 15px;
    color: var(--text);
  }
  .track {
    grid-area: track;
    height: 22px;
    border-radius: 6px;
    background: var(--track);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 6px;
    /* pastel body, firm end */
    background: color-mix(in srgb, var(--c) 32%, var(--surface));
    box-shadow: inset -3px 0 0 var(--c);
  }
  .value {
    grid-area: value;
    min-width: 80px;
    text-align: right;
    font-size: 20px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: 15px;
    margin-left: 4px;
  }
</style>
