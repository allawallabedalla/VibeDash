<script lang="ts">
  /**
   * Feedback on the page you are on: idea, bug or question, kept in a local
   * backlog on the server (local/feedback.json, never in the repo). Below the
   * form the open points of this page, each can be marked done or dropped.
   * Loaded only when the button is pressed (not part of the first page).
   */
  import { onMount } from 'svelte';
  import { t } from '../i18n/index.svelte';
  import Icon from './Icon.svelte';

  let { page, onclose }: { page: string; onclose: () => void } = $props();

  type Kind = 'idea' | 'bug' | 'question';
  interface Entry {
    id: string;
    at: number;
    page: string;
    kind: Kind;
    text: string;
    status: 'open' | 'done' | 'dropped';
  }
  let dialog: HTMLDialogElement;
  let kind = $state<Kind>('idea');
  let text = $state('');
  let entries = $state<Entry[]>([]);
  let busy = $state(false);
  let said = $state<'' | 'sent' | 'failed'>('');

  const open = $derived(entries.filter((e) => e.status === 'open'));
  const here = $derived(open.filter((e) => e.page === page));

  async function refresh() {
    try {
      const r = await fetch('/api/feedback', { signal: AbortSignal.timeout(10_000) });
      if (r.ok) entries = ((await r.json()) as { entries: Entry[] }).entries ?? [];
    } catch {
      /* the list is a bonus; the form still works */
    }
  }
  async function post(body: object) {
    busy = true;
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  }
  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await post({ page, kind, text: text.trim() });
    said = ok ? 'sent' : 'failed';
    if (ok) {
      text = '';
      await refresh();
    }
  }
  async function mark(id: string, status: 'done' | 'dropped') {
    if (await post({ id, status })) await refresh();
  }
  const date = (ms: number) => {
    const d = new Date(ms);
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  };

  onMount(() => {
    dialog.showModal();
    void refresh();
  });
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="fb-title">
  <form method="dialog" class="head">
    <h2 id="fb-title">{t('fb.title')}</h2>
    <button class="x" aria-label={t('fb.close')}><Icon name="close" /></button>
  </form>
  <form class="new" onsubmit={send}>
    <div class="kinds" role="radiogroup" aria-label={t('fb.title')}>
      {#each ['idea', 'bug', 'question'] as const as k (k)}
        <button type="button" role="radio" aria-checked={kind === k} onclick={() => (kind = k)}
          >{t(`fb.${k}`)}</button
        >
      {/each}
    </div>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:value={text}
      maxlength="1000"
      rows="3"
      placeholder={t('fb.placeholder')}
      aria-label={t('fb.placeholder')}
      autofocus></textarea>
    <div class="send">
      <span class="hint" role="status"
        >{said === 'sent'
          ? t('fb.sent')
          : said === 'failed'
            ? t('item.failed')
            : t('fb.hint')}</span
      >
      <button type="submit" class="b main" disabled={busy || !text.trim()}
        ><Icon name="check" size={16} />{t('fb.send')}</button
      >
    </div>
  </form>
  <h3>{t('fb.open')}</h3>
  {#if here.length}
    <ul>
      {#each here as e (e.id)}
        <li>
          <span class="k">{t(`fb.${e.kind}`)} · {date(e.at)}</span>
          <span class="t">{e.text}</span>
          <span class="row">
            <button type="button" class="b" disabled={busy} onclick={() => mark(e.id, 'done')}
              ><Icon name="check" size={16} />{t('fb.done')}</button
            >
            <button type="button" class="b" disabled={busy} onclick={() => mark(e.id, 'dropped')}
              ><Icon name="close" size={16} />{t('fb.drop')}</button
            >
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">{t('fb.none')}</p>
  {/if}
  <p class="hint">{t('fb.all', { n: open.length })}</p>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    border: 0;
    border-radius: 18px;
    padding: 18px 20px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  h3 {
    margin: 18px 0 6px;
    font-size: 15px;
    color: var(--muted);
    font-weight: 600;
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
  .new {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }
  .kinds {
    display: flex;
    gap: 6px;
  }
  .kinds button {
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .kinds button[aria-checked='true'] {
    background: var(--surface-2);
    color: var(--text);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg, var(--surface));
    color: var(--text);
    font: inherit;
    font-size: 16px;
    padding: 10px 12px;
    resize: vertical;
  }
  .send {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .hint {
    font-size: 14px;
    color: var(--muted);
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    gap: 4px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .k {
    font-size: 14px;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
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
  .b.main {
    color: var(--text);
    background: var(--surface-2);
  }
  .b:disabled {
    opacity: 0.5;
  }
</style>
