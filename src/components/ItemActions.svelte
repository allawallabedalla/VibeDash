<script lang="ts">
  /**
   * Buttons under a board list item: done (with date, default today), seen,
   * note, hide, undo. Each click goes to this server (POST /api/board/<id>/action),
   * which passes it to the house service that made the board; afterwards the
   * page reloads the board. Nothing here switches a device.
   */
  import type { BoardListItem, ItemAction } from '../model/board';
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let { board, item, onchanged }: { board: string; item: BoardListItem; onchanged: () => void } =
    $props();

  type Mode = 'idle' | 'done' | 'comment';
  let mode = $state<Mode>('idle');
  let busy = $state(false);
  let failed = $state(false);
  let note = $state('');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let day = $state(today());

  const has = (a: ItemAction) => item.actions?.includes(a) ?? false;
  const short = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

  async function send(action: ItemAction, extra: { text?: string; date?: string } = {}) {
    busy = true;
    failed = false;
    try {
      const r = await fetch(`/api/board/${board}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: item.id, action, ...extra }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      mode = 'idle';
      note = '';
      onchanged();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<div class="acts">
  {#if item.done}<span class="stamp">{t('item.doneOn', { date: short(item.done) })}</span>{/if}
  {#if item.acked}<span class="stamp">{t('item.ackedOn', { date: short(item.acked) })}</span>{/if}
  {#each item.comments ?? [] as c, i (i)}
    <p class="note"><Icon name="comment" size={14} /> {c.text} <span class="at">{c.at}</span></p>
  {/each}

  {#if mode === 'done'}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        void send('done', { date: day });
      }}
    >
      <label class="date"
        ><span>{t('item.date')}</span>
        <input type="date" bind:value={day} max={today()} required /></label
      >
      <button type="submit" class="b main" disabled={busy}
        ><Icon name="check" size={16} />{t('item.save')}</button
      >
      <button type="button" class="b" onclick={() => (mode = 'idle')}>{t('item.cancel')}</button>
    </form>
  {:else if mode === 'comment'}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        if (note.trim()) void send('comment', { text: note.trim() });
      }}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="text"
        type="text"
        maxlength="500"
        bind:value={note}
        placeholder={t('item.notePlaceholder')}
        aria-label={t('item.notePlaceholder')}
        autofocus
      />
      <button type="submit" class="b main" disabled={busy || !note.trim()}>{t('item.save')}</button>
      <button type="button" class="b" onclick={() => (mode = 'idle')}>{t('item.cancel')}</button>
    </form>
  {:else}
    <div class="row">
      {#if has('done')}
        <button
          type="button"
          class="b"
          disabled={busy}
          onclick={() => ((day = today()), (mode = 'done'))}
          ><Icon name="check" size={16} />{t('item.done')}</button
        >
      {/if}
      {#if has('ack') && !item.acked}
        <button type="button" class="b" disabled={busy} onclick={() => send('ack')}
          ><Icon name="eye" size={16} />{t('item.ack')}</button
        >
      {/if}
      {#if has('comment')}
        <button type="button" class="b" disabled={busy} onclick={() => (mode = 'comment')}
          ><Icon name="comment" size={16} />{t('item.comment')}</button
        >
      {/if}
      {#if has('delete')}
        <button type="button" class="b" disabled={busy} onclick={() => send('delete')}
          ><Icon name="close" size={16} />{t('item.delete')}</button
        >
      {/if}
      {#if item.done || item.acked}
        <button type="button" class="b" disabled={busy} onclick={() => send('undo')}
          ><Icon name="undo" size={16} />{t('item.undo')}</button
        >
      {/if}
    </div>
  {/if}
  {#if busy}<span class="stamp" role="status">{t('item.busy')}</span>{/if}
  {#if failed}<span class="stamp fail" role="alert">{t('item.failed')}</span>{/if}
</div>

<style>
  .acts {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-top: 4px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .b {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .b:hover:not(:disabled) {
    color: var(--text);
  }
  .b.main {
    color: var(--text);
    background: var(--surface-2);
  }
  .b:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stamp {
    font-size: 14px;
    color: var(--good-text);
  }
  .stamp.fail {
    color: var(--poor-text);
  }
  .note {
    flex-basis: 100%;
    margin: 0;
    font-size: 14px;
    color: var(--text);
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .at {
    color: var(--muted);
    margin-left: auto;
    white-space: nowrap;
  }
  .date {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
  }
  input {
    min-height: 36px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
    padding: 0 10px;
  }
  .text {
    flex: 1 1 220px;
  }
</style>
