<script lang="ts">
  /** One soft bar per day with its value on top; the running day lighter, a gap a grey dash. */
  import { num } from '../i18n/index.svelte';

  interface Props {
    values: (number | null)[];
    labels: string[];
    color: string;
    unit: string;
    /** Index of the running day, drawn lighter. */
    partial?: number;
    label: string;
  }
  let { values, labels, color, unit, partial, label }: Props = $props();

  const max = $derived(Math.max(1e-9, ...values.map((v) => v ?? 0)));
</script>

<div class="days" class:many={values.length > 8} role="img" aria-label={label}>
  {#each values as v, i (i)}
    <div
      class="day"
      class:now={i === partial}
      title="{labels[i]}: {v === null ? '–' : `${num(v, 1)} ${unit}`}"
    >
      <div class="col">
        {#if v}
          <span class="v">{num(v, Number.isInteger(v) || v >= 10 ? 0 : 1)}</span>
          <span class="bar" style:height="{(100 * v) / max}%" style:background={color}></span>
        {:else}
          <span class="dash"></span>
        {/if}
      </div>
      <span class="d">{labels[i]}</span>
    </div>
  {/each}
</div>

<style>
  .days {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 6px;
    height: 150px;
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  .col {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-top: 18px;
    border-bottom: 1px solid var(--line);
  }
  .bar {
    width: min(22px, 60%);
    border-radius: 5px 5px 0 0;
    min-height: 2px;
  }
  .now .bar {
    opacity: 0.55;
  }
  .dash {
    width: min(22px, 60%);
    height: 2px;
    border-radius: 1px;
    background: var(--faint);
  }
  .v {
    font-size: var(--small);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    margin-bottom: 3px;
    white-space: nowrap;
  }
  .d {
    margin-top: 5px;
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
    /* a long label (from a board) is cut, never widens the page */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now .d {
    color: var(--text);
    font-weight: 600;
  }
  /* many days on a phone: every third label (counted from today) */
  @media (max-width: 600px) {
    .many .day:not(:nth-last-child(3n + 1)) .d {
      visibility: hidden;
    }
    /* the shown label may use its hidden neighbours' room instead of „Mi.,…“ (Audit04 UX-09) */
    .many .d {
      max-width: none;
      overflow: visible;
    }
  }
</style>
