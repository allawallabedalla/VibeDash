<script lang="ts">
  /**
   * The open part of an accordion item on a board: stamps (done, seen, put
   * off), notes with a field for a new one, and the buttons Done (now, or
   * another date), Later (a dialog: 1 week … 3 months or a date), Seen, Hide,
   * Undo. Each click goes to this server (POST /api/board/<id>/action), which
   * passes it to the house service that made the board; then the board reloads.
   * Nothing here switches a device.
   */
  import type { BoardListItem, ItemAction } from '../model/board';
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let { board, item, onchanged }: { board: string; item: BoardListItem; onchanged: () => void } =
    $props();

  let busy = $state(false);
  let failed = $state(false);
  let note = $state('');
  let otherDate = $state(false);
  let laterDialog = $state<HTMLDialogElement>();

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
  const inMonths = (n: number) => {
    const now = new Date();
    return iso(new Date(now.getFullYear(), now.getMonth() + n, now.getDate()));
  };
  let day = $state(today());
  let until = $state(inDays(7));

  const has = (a: ItemAction) => item.actions?.includes(a) ?? false;
  /** "2026-10-16 08:20" -> "16.10. 08:20", "2026-10-16" -> "16.10." */
  const short = (s: string) =>
    `${Number(s.slice(8, 10))}.${Number(s.slice(5, 7))}.${s.length > 10 ? ` ${s.slice(11)}` : ''}`;

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
      note = '';
      otherDate = false;
      laterDialog?.close();
      onchanged();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
  const later = (date: string) => void send('snooze', { date });
</script>

<div class="panel">
  {#if item.done || item.acked || item.snoozed}
    <p class="stamps">
      {#if item.done}<span>{t('item.doneOn', { date: short(item.done) })}</span>{/if}
      {#if item.acked}<span>{t('item.ackedOn', { date: short(item.acked) })}</span>{/if}
      {#if item.snoozed}<span>{t('item.snoozedUntil', { date: short(item.snoozed) })}</span>{/if}
    </p>
  {/if}

  {#each item.comments ?? [] as c, i (i)}
    <p class="note">
      <Icon name="comment" size={14} /><span>{c.text}</span><span class="at">{c.at}</span>
    </p>
  {/each}

  {#if has('comment')}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        if (note.trim()) void send('comment', { text: note.trim() });
      }}
    >
      <textarea
        bind:value={note}
        maxlength="500"
        rows="2"
        placeholder={t('item.notePlaceholder')}
        aria-label={t('item.notePlaceholder')}></textarea>
      {#if note.trim()}
        <button type="submit" class="b main" disabled={busy}
          ><Icon name="comment" size={16} />{t('item.saveNote')}</button
        >
      {/if}
    </form>
  {/if}

  {#if otherDate}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        void send('done', { date: day });
      }}
    >
      <label class="date"
        ><span>{t('item.date')}</span><input
          type="date"
          bind:value={day}
          max={today()}
          required
        /></label
      >
      <button type="submit" class="b main" disabled={busy}
        ><Icon name="check" size={16} />{t('item.save')}</button
      >
      <button type="button" class="b" onclick={() => (otherDate = false)}>{t('item.cancel')}</button
      >
    </form>
  {:else}
    <div class="row">
      {#if has('done')}
        <button type="button" class="b main" disabled={busy} onclick={() => send('done')}
          ><Icon name="check" size={16} />{t('item.done')}</button
        >
      {/if}
      {#if has('snooze')}
        <button
          type="button"
          class="b"
          disabled={busy}
          onclick={() => {
            until = inDays(7);
            laterDialog?.showModal();
          }}><Icon name="clock" size={16} />{t('item.later')}</button
        >
      {/if}
      {#if has('ack') && !item.acked}
        <button type="button" class="b" disabled={busy} onclick={() => send('ack')}
          ><Icon name="eye" size={16} />{t('item.ack')}</button
        >
      {/if}
      {#if has('delete')}
        <button type="button" class="b" disabled={busy} onclick={() => send('delete')}
          ><Icon name="close" size={16} />{t('item.delete')}</button
        >
      {/if}
      {#if item.done || item.acked || item.snoozed}
        <button type="button" class="b" disabled={busy} onclick={() => send('undo')}
          ><Icon name="undo" size={16} />{t('item.undo')}</button
        >
      {/if}
      {#if has('done')}
        <button type="button" class="link" onclick={() => ((day = today()), (otherDate = true))}
          >{t('item.otherDate')}</button
        >
      {/if}
    </div>
  {/if}
  {#if busy}<span class="hint" role="status">{t('item.busy')}</span>{/if}
  {#if failed}<span class="hint fail" role="alert">{t('item.failed')}</span>{/if}

  {#if has('snooze')}
    <dialog bind:this={laterDialog} aria-labelledby="later-title">
      <form method="dialog" class="head">
        <h3 id="later-title">{t('item.laterTitle')}</h3>
        <button class="x" aria-label={t('item.cancel')}><Icon name="close" /></button>
      </form>
      <p class="what">{item.text}</p>
      <div class="choices">
        <button type="button" class="b" disabled={busy} onclick={() => later(inDays(7))}
          >{t('item.week')}</button
        >
        <button type="button" class="b" disabled={busy} onclick={() => later(inDays(14))}
          >{t('item.twoWeeks')}</button
        >
        <button type="button" class="b" disabled={busy} onclick={() => later(inMonths(1))}
          >{t('item.month')}</button
        >
        <button type="button" class="b" disabled={busy} onclick={() => later(inMonths(3))}
          >{t('item.threeMonths')}</button
        >
      </div>
      <form
        class="row"
        onsubmit={(e) => {
          e.preventDefault();
          later(until);
        }}
      >
        <label class="date"
          ><span>{t('item.until')}</span><input
            type="date"
            bind:value={until}
            min={inDays(1)}
            required
          /></label
        >
        <button type="submit" class="b main" disabled={busy}
          ><Icon name="clock" size={16} />{t('item.later')}</button
        >
      </form>
      <p class="hint">{t('item.laterHint')}</p>
      {#if failed}<p class="hint fail" role="alert">{t('item.failed')}</p>{/if}
    </dialog>
  {/if}
</div>

<style>
  .panel {
    display: grid;
    gap: 10px;
    padding: 4px 0 6px;
  }
  .stamps {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 14px;
    color: var(--good-text);
  }
  .note {
    margin: 0;
    font-size: 14px;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .at {
    color: var(--muted);
    margin-left: auto;
    white-space: nowrap;
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
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    color: var(--muted);
    font-size: 15px;
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
  .link {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 14px;
    text-decoration: underline;
    cursor: pointer;
    min-height: 40px;
  }
  textarea,
  input {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  textarea {
    flex: 1 1 100%;
    padding: 8px 10px;
    resize: vertical;
  }
  input {
    min-height: 40px;
    padding: 0 10px;
  }
  .date {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
  }
  .hint {
    font-size: 14px;
    color: var(--muted);
    margin: 0;
  }
  .fail {
    color: var(--poor-text);
  }
  dialog {
    width: min(420px, calc(100vw - 32px));
    border: 2px solid var(--border);
    border-radius: 18px;
    padding: 16px 18px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog[open] {
    display: grid;
    gap: 12px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    margin: 0;
    font-size: 17px;
  }
  .what {
    margin: 0;
    font-size: 15px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .choices .b {
    justify-content: center;
  }
  .x {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
</style>
