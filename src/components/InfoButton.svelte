<script lang="ts">
  /** ⓘ toggle. Opens on tap/click (no hover-only), 44 px touch target. */
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    controls,
    ontoggle,
  }: { open?: boolean; controls: string; ontoggle?: () => void } = $props();
</script>

<!-- Escape closes an open explanation -->
<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape') {
      if (ontoggle) ontoggle();
      else open = false;
    }
  }}
/>

<button
  type="button"
  class="info"
  aria-expanded={open}
  aria-controls={controls}
  aria-label={open ? t('info.close') : t('info.open')}
  onclick={() => (ontoggle ? ontoggle() : (open = !open))}
>
  <Icon name={open ? 'close' : 'info'} size={18} />
</button>

<style>
  .info {
    flex: none;
    width: 44px;
    height: 44px;
    margin: -12px -12px -12px -8px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--icon-soft);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .info:hover,
  .info[aria-expanded='true'] {
    color: var(--muted);
  }
</style>
