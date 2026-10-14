<script lang="ts">
  /** Count as dots: `value` of `max` filled (e.g. 5 of 7 dry days, 3 manual switches). */
  let {
    value,
    max,
    color = 'var(--text)',
  }: { value: number; max: number; color?: string } = $props();

  const n = $derived(Math.max(0, Math.round(value)));
  const m = $derived(Math.max(max, n));
</script>

<div class="dots" aria-hidden="true">
  {#each Array.from({ length: m }, (_x, i) => i) as i (i)}
    <i style:background={i < n ? color : undefined} style:border-color={i < n ? color : undefined}
    ></i>
  {/each}
</div>

<style>
  .dots {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
  }
</style>
