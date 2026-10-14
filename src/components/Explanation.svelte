<script lang="ts">
  /** Content behind ⓘ: "What does it mean?" and "Where does the number come from?" */
  import { t } from '../i18n/index.svelte';

  let { what, source }: { what: string; source: string } = $props();
</script>

<div class="explanation">
  <p class="q">{t('info.what')}</p>
  <p>{what}</p>
  <p class="q">{t('info.source')}</p>
  <p>{source}</p>
</div>

<style>
  .explanation {
    font-size: 14px;
    line-height: 1.45;
  }
  p {
    margin: 0 0 8px;
  }
  p:last-child {
    margin-bottom: 0;
  }
  .q {
    color: var(--muted);
    font-size: var(--small);
    margin-bottom: 2px;
  }
</style>
