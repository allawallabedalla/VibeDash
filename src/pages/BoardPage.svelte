<script lang="ts">
  /**
   * A board: a page whose content a house service supplies (mapping.boards),
   * already checked by the server (src/model/board.ts). Each section is drawn
   * with VibeDash's own blocks; all text is shown as text. Refreshed every
   * two minutes while the page is visible.
   */
  import { onMount } from 'svelte';
  import { store, currentData } from '../app/data.svelte';
  import type { Board } from '../model/board';
  import { boardCache } from '../app/loading';
  import { i18n, t, time } from '../i18n/index.svelte';
  import BoardSections from './BoardSections.svelte';
  import PageHead from './PageHead.svelte';

  let { id }: { id: string } = $props();

  const house = $derived(currentData());
  const tab = $derived(store.boards.find((b) => b.id === id));
  // svelte-ignore state_referenced_locally (one board per page instance: the parent keys on the id)
  const cache = boardCache<Board>(id);
  const last = cache.read();
  /** the last answer is shown at once (with its time) until the fresh one is in */
  let staleAt = $state<number | null>(last?.at ?? null);
  let view = $state<{ s: 'loading' } | { s: 'error'; reason: string } | { s: 'ready'; b: Board }>(
    last ? { s: 'ready', b: last.b } : { s: 'loading' },
  );

  async function load() {
    try {
      const r = await fetch(`/api/board/${id}`, { signal: AbortSignal.timeout(25_000) });
      const body = (await r.json().catch(() => ({}))) as Board & { error?: string };
      if (r.ok) {
        view = { s: 'ready', b: body };
        staleAt = null;
        cache.write(body);
      } else if (view.s !== 'ready') view = { s: 'error', reason: body.error ?? 'upstream' };
    } catch (e) {
      if (view.s !== 'ready') {
        view = { s: 'error', reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
      }
    }
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 120_000);
    return () => clearInterval(timer);
  });
</script>

<div class="page">
  <PageHead title={tab?.title ?? id} />

  {#if view.s === 'loading'}
    <p class="muted-note" role="status">{t('state.loading')}</p>
  {:else if view.s === 'error'}
    <p class="muted-note">
      {t('state.noData')} · {t(`reason.${view.reason === 'timeout' ? 'timeout' : 'upstream'}`)}
    </p>
  {:else}
    {#if view.b.updated}
      <p class="muted-note">
        {t('board.updated', { time: time(view.b.updated, house.timeZone) })}{#if staleAt}
          · {t('state.refreshing')}{/if}
      </p>
    {:else if staleAt}
      <p class="muted-note">{t('state.refreshing')}</p>
    {/if}
    <BoardSections {id} sections={view.b.sections} onchanged={() => void load()} />
    <p class="muted-note">{t('board.source', { lang: i18n.locale })}</p>
  {/if}
</div>
