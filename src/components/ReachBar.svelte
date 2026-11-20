<script lang="ts">
  /**
   * The night as a bar, now → sunrise (Audit05 I-4): green while the battery carries the
   * house, lighter over the spread of "empty", purple once the grid takes over.
   * Shares 0–1 of the stretch; `empty` null = it lasts.
   */
  let {
    empty,
    early,
    late,
    ends,
  }: { empty: number | null; early: number | null; late: number | null; ends: string[] } = $props();

  const pc = (v: number | null) => `${100 * Math.min(1, Math.max(0, v ?? 1))}%`;
</script>

<div class="bar" aria-hidden="true">
  <span class="grid" style:left={pc(empty)}></span>
  <span class="spread" style:left={pc(early)} style:right="calc(100% - {pc(late)})"></span>
</div>
<div class="ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>

<style>
  .bar {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: var(--battery);
    overflow: hidden;
  }
  .grid {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    background: var(--import);
  }
  /* "empty" somewhere in here: a soft veil, no hard edge */
  .spread {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      color-mix(in srgb, var(--surface) 55%, transparent) 3px 6px
    );
  }
  .ends {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: var(--small);
    color: var(--muted);
  }
</style>
