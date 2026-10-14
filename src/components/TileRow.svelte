<script lang="ts">
  /**
   * 2–6 tiles in a row. Phone: two per row; an odd last tile spans the full
   * width instead of leaving a hole.
   */
  import type { Snippet } from 'svelte';

  let { count, children }: { count: number; children: Snippet } = $props();
</script>

<div class="row" class:odd={count % 2 === 1} style:--cols={Math.min(Math.max(count, 2), 6)}>
  {@render children()}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 1000px) {
    .row {
      grid-template-columns: repeat(min(var(--cols), 3), minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .row.odd > :global(:last-child) {
      grid-column: 1 / -1;
    }
  }
</style>
