<script lang="ts">
  /** ⓘ toggle. Opens on tap/click (no hover-only), 44 px touch target. */
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let { open = $bindable(false), controls }: { open?: boolean; controls: string } = $props();
</script>

<button
  type="button"
  class="info"
  aria-expanded={open}
  aria-controls={controls}
  aria-label={open ? t('info.close') : t('info.open')}
  onclick={() => (open = !open)}
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
    color: var(--faint);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .info:hover,
  .info[aria-expanded='true'] {
    color: var(--muted);
  }
</style>
