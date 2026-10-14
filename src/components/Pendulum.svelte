<script lang="ts">
  /**
   * Grid as a pendulum from the middle: feed-in to the right (positive),
   * import to the left. Below 50 W a quiet dot (control noise around 0).
   */
  import { t } from '../i18n/index.svelte';

  /** Watts: > 0 feed-in, < 0 import; `range` is the full swing in watts. */
  let { watts, range = 10_000 }: { watts: number; range?: number } = $props();

  const a = $derived(Math.max(-1, Math.min(1, (watts || 0) / range)));
  const quiet = $derived(Math.abs(watts || 0) < 50);
</script>

<div class="pendulum" aria-hidden="true">
  <span class="middle"></span>
  {#if quiet}
    <span class="rest"></span>
  {:else}
    <span
      class="swing"
      style:left={a > 0 ? '50%' : undefined}
      style:right={a < 0 ? '50%' : undefined}
      style:width="{Math.abs(a) * 50}%"
      style:background={a < 0 ? 'var(--import)' : 'var(--feed)'}
    ></span>
  {/if}
</div>
<div class="legend"><span>{t('pendulum.import')}</span><span>{t('pendulum.feed')}</span></div>

<style>
  .pendulum {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: var(--track);
  }
  .middle {
    position: absolute;
    left: 50%;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--faint);
  }
  .swing {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 6px;
    transition: width 0.8s ease;
  }
  .rest {
    position: absolute;
    left: 50%;
    top: 2px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-radius: 50%;
    background: var(--faint);
  }
  .legend {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    margin-top: 5px;
    font-size: var(--small);
    color: var(--muted);
    white-space: nowrap;
  }
</style>
