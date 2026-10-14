<script lang="ts">
  /** Now against before as two thin bars: coloured = now, grey = before. */
  let {
    now,
    before,
    color = 'var(--text)',
  }: { now: number; before: number; color?: string } = $props();

  const hi = $derived(Math.max(now, before) || 1);
</script>

<div class="compare" aria-hidden="true">
  <span style:width="{(100 * Math.max(0, now)) / hi}%" style:background={color}></span>
  <span class="before" style:width="{(100 * Math.max(0, before)) / hi}%"></span>
</div>

<style>
  .compare {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  span {
    display: block;
    height: 5px;
    border-radius: 3px;
  }
  .before {
    background: var(--faint);
  }
</style>
