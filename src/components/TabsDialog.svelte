<script lang="ts">
  /**
   * Arrange the tabs (BL-272): switch each one on or off and move it up or down. One list for
   * the whole house (local/settings.json on the server), saved on every tap. Off only hides a
   * tab – its contents stay. Below: modules that ship with VibeDash but are not set up here
   * yet; setting one up needs its contents (a plan, rooms …), so the agent does it.
   * Loaded only when the button is pressed (not part of the first page).
   */
  import { onMount } from 'svelte';
  import { i18n } from '../i18n/index.svelte';
  import { store } from '../app/data.svelte';
  import { MODULES, move, ordered, type TabPrefs } from '../app/tabs';
  import Icon, { iconOf, type IconName } from './Icon.svelte';

  let {
    tabs,
    onclose,
  }: { tabs: { id: string; label: string; icon: IconName }[]; onclose: () => void } = $props();

  const TEXT = {
    de: {
      title: 'Reiter einstellen',
      close: 'Schließen',
      hint: 'Aus blendet nur aus – nichts wird gelöscht. Gilt für alle Geräte.',
      readonly: 'Auf diesem Server fest eingestellt (TABS_WRITE=off).',
      up: 'Nach oben',
      down: 'Nach unten',
      saved: 'Gespeichert',
      failed: 'Nicht gespeichert – bitte noch einmal tippen.',
      always: 'immer da',
      more: 'Noch nicht eingerichtet',
      moreHint: 'Einrichten: Claude Code fragen „Richte das Modul {name} ein“.',
    },
    en: {
      title: 'Arrange tabs',
      close: 'Close',
      hint: 'Off only hides – nothing is deleted. Applies to every device.',
      readonly: 'Fixed on this server (TABS_WRITE=off).',
      up: 'Move up',
      down: 'Move down',
      saved: 'Saved',
      failed: 'Not saved – please tap again.',
      always: 'always on',
      more: 'Not set up yet',
      moreHint: 'To set up: ask Claude Code "Set up the {name} module".',
    },
  };
  const tx = $derived(TEXT[i18n.locale === 'de' ? 'de' : 'en']);

  let dialog: HTMLDialogElement;
  let said = $state<'' | 'saved' | 'failed'>('');
  let busy = $state(false);

  const list = $derived(ordered(tabs, store.tabPrefs));
  const hidden = $derived(new Set(store.tabPrefs.hidden));
  const can = $derived(store.tabsWritable && !busy);
  const missing = $derived(
    Object.entries(MODULES).filter(([id]) => !store.boards.some((b) => b.module === id)),
  );

  async function save(next: TabPrefs) {
    const before = store.tabPrefs;
    store.tabPrefs = next; // at once; back if the server refuses
    busy = true;
    said = '';
    try {
      const r = await fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      said = 'saved';
    } catch {
      store.tabPrefs = before;
      said = 'failed';
    } finally {
      busy = false;
    }
  }
  function toggle(id: string) {
    const was = store.tabPrefs.hidden;
    const hiddenNext = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
    void save({ hidden: hiddenNext, order: list.map((t) => t.id) });
  }
  function step(id: string, d: -1 | 1) {
    void save({
      hidden: store.tabPrefs.hidden,
      order: move(
        list.map((t) => t.id),
        id,
        d,
      ),
    });
  }

  onMount(() => dialog.showModal());
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="tabs-title">
  <form method="dialog" class="head">
    <h2 id="tabs-title">{tx.title}</h2>
    <button class="x" aria-label={tx.close}><Icon name="close" /></button>
  </form>
  <p class="hint">{store.tabsWritable ? tx.hint : tx.readonly}</p>
  <ul>
    {#each list as tab, i (tab.id)}
      {@const fixed = tab.id === 'overview'}
      {@const on = fixed || !hidden.has(tab.id)}
      <li class:off={!on}>
        <span class="name"><Icon name={tab.icon} />{tab.label}</span>
        {#if fixed}
          <span class="always">{tx.always}</span>
        {:else}
          <span class="row">
            <button
              type="button"
              class="b move"
              aria-label="{tx.up}: {tab.label}"
              disabled={!can || i <= 1}
              onclick={() => step(tab.id, -1)}
              ><span class="up"><Icon name="chevron" /></span></button
            >
            <button
              type="button"
              class="b move"
              aria-label="{tx.down}: {tab.label}"
              disabled={!can || i === list.length - 1}
              onclick={() => step(tab.id, 1)}
              ><span class="down"><Icon name="chevron" /></span></button
            >
            <button
              type="button"
              role="switch"
              class="switch"
              aria-checked={on}
              aria-label={tab.label}
              disabled={!can}
              onclick={() => toggle(tab.id)}
              ><span class="track"><span class="knob"></span></span></button
            >
          </span>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="status" role="status">
    {said === 'saved' ? tx.saved : said === 'failed' ? tx.failed : ''}
  </p>
  {#if missing.length}
    <h3>{tx.more}</h3>
    <ul class="more">
      {#each missing as [id, m] (id)}
        <li>
          <span class="name"
            ><Icon name={iconOf(m.icon)} />{i18n.locale === 'de' ? m.de : m.en}</span
          >
        </li>
      {/each}
    </ul>
    <p class="hint">
      {tx.moreHint.replace('{name}', i18n.locale === 'de' ? missing[0]![1].de : missing[0]![1].en)}
    </p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    border: 0;
    border-radius: 18px;
    padding: 18px 20px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: color-mix(in srgb, #000 35%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 4px;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  h3 {
    margin: 18px 0 6px;
    font-size: 0.95rem;
    color: var(--muted);
    font-weight: 600;
  }
  .x {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .hint,
  .status {
    margin: 4px 0 10px;
    font-size: 0.88rem;
    color: var(--muted);
  }
  .status {
    min-height: 1.2em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 52px;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: 0;
  }
  li.off .name {
    color: var(--muted);
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    min-width: 0;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .more li {
    min-height: 0;
    padding: 6px 12px 6px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .more .name {
    gap: 6px;
    font-weight: 500;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .always {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .b {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .b:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .up,
  .down {
    display: grid;
  }
  .up {
    transform: rotate(-90deg);
  }
  .down {
    transform: rotate(90deg);
  }
  .switch {
    display: grid;
    place-items: center;
    width: 56px;
    height: 44px;
    margin-left: 2px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .track {
    position: relative;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background: var(--line);
    transition: background 0.2s;
  }
  .switch[aria-checked='true'] .track {
    background: var(--battery);
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    transition: transform 0.2s;
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(20px);
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
