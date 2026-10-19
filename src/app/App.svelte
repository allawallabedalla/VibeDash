<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Tabs from '../components/Tabs.svelte';
  import { i18n, t } from '../i18n/index.svelte';
  import Overview from '../pages/Overview.svelte';
  import { onMount } from 'svelte';
  import { currentSource, load, store } from './data.svelte';
  import { boardOf, router, type Route } from './router.svelte';
  import { iconOf } from '../components/Icon.svelte';

  /** Pull to refresh: only on touch screens, loaded only there (not part of the first page). */
  let touch = $state(false);
  onMount(() => {
    void load();
    touch = matchMedia('(pointer: coarse)').matches;
  });

  const reasonText = (r: string) =>
    t(`reason.${r as 'timeout' | 'upstream' | 'network' | 'not_mapped'}`);

  /** a board shown on the charging page names the charging tab */
  const cb = $derived(store.boards.find((b) => b.onPage));
  const tabs = $derived([
    { id: 'overview', label: t('page.overview'), icon: 'overview' as const },
    { id: 'week', label: t('page.week'), icon: 'calendar' as const },
    { id: 'now', label: t('page.now'), icon: 'bolt' as const },
    { id: 'forecasts', label: t('page.forecasts'), icon: 'forecast' as const },
    ...(store.evcc ||
    store.plan ||
    store.charging ||
    cb ||
    (store.state.status === 'ready' && currentSource() === 'demo')
      ? [
          {
            id: 'charging',
            label: cb?.title ?? t('page.charging'),
            icon: iconOf(cb?.icon ?? 'plugCar'),
          },
        ]
      : []),
    ...store.boards
      .filter((b) => !b.onPage)
      .map((b) => ({ id: `b/${b.id}`, label: b.title, icon: iconOf(b.icon) })),
  ]);

  function toggleTheme() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
  }
  const demoOnly = $derived(store.state.status === 'ready' && currentSource() === 'demo');
  /** Feedback dialog: loaded only when opened (not part of the first page). */
  let feedbackOpen = $state(false);
</script>

{#if feedbackOpen}
  {#await import('../components/FeedbackDialog.svelte') then { default: FeedbackDialog }}
    <FeedbackDialog page={router.route} onclose={() => (feedbackOpen = false)} />
  {/await}
{/if}

{#if touch}
  {#await import('../components/PullRefresh.svelte') then { default: PullRefresh }}
    <PullRefresh />
  {/await}
{/if}

<header class="top">
  <a class="brand" href="#/">VibeDash</a>
  <div class="actions">
    <div class="seg" role="group" aria-label={t('toggle.lang')}>
      {#each ['de', 'en'] as const as l (l)}
        <button type="button" aria-pressed={i18n.locale === l} onclick={() => (i18n.locale = l)}
          >{l.toUpperCase()}</button
        >
      {/each}
    </div>
    {#if store.feedback}
      <button
        type="button"
        class="round"
        aria-label={t('fb.button')}
        title={t('fb.button')}
        onclick={() => (feedbackOpen = true)}
      >
        <Icon name="comment" />
      </button>
    {/if}
    <button type="button" class="round" aria-label={t('toggle.theme')} onclick={toggleTheme}>
      <Icon name="contrast" />
    </button>
  </div>
</header>

<div class="nav">
  <Tabs
    items={tabs}
    bind:active={() => router.route, (v) => router.go(v as Route)}
    label={t('tabs.label')}
  />
</div>

<main>
  <!-- The gallery shows made-up demo data: only without a house (demo mode), never next to real values. -->
  {#if router.route === 'gallery' && demoOnly}
    <!-- Loaded on demand: not part of the first page budget. -->
    {#await import('../gallery/Gallery.svelte') then { default: Gallery }}
      <Gallery />
    {/await}
  {:else if router.route === 'einrichten'}
    <!-- Setup assistant: works before any data exists; loaded only here. -->
    {#await import('../pages/SetupPage.svelte') then { default: SetupPage }}<SetupPage />{/await}
  {:else if store.state.status === 'loading'}
    <div class="page state" role="status" aria-live="polite">
      <p class="loading">{t('state.loading')}</p>
    </div>
  {:else if store.state.status === 'error'}
    <div class="page state">
      <section class="notice" role="alert">
        <h1>{t('state.errorTitle')}</h1>
        <p>{t('state.errorText', { reason: reasonText(store.state.reason) })}</p>
        <button type="button" class="retry" onclick={() => load()}>{t('state.retry')}</button>
      </section>
    </div>
  {:else}
    <!-- Only real trouble (timeouts, errors) earns a notice; a sensor the house
         simply does not have is not a need for action. -->
    {@const failed = store.state.missing.filter((m) => m.reason !== 'not_mapped')}
    {#if failed.length > 0}
      <div class="page">
        <section class="notice small" role="status">
          <p class="title">{t('state.missingTitle')}</p>
          <ul>
            {#each failed as m (m.id)}
              <li>
                {t('state.missingItem', {
                  name: store.state.data.entities.find((e) => e.id === m.id)?.name ?? m.id,
                  reason: reasonText(m.reason),
                })}
              </li>
            {/each}
          </ul>
          <button type="button" class="retry" onclick={() => load()}>{t('state.retry')}</button>
        </section>
      </div>
    {/if}
    {#if store.setupOpen}
      <div class="page">
        <section class="notice small" role="status">
          <p class="title">{t('setup.banner')}</p>
          <a class="retry" href="#/einrichten">{t('setup.bannerGo')}</a>
        </section>
      </div>
    {/if}
    {#key store.version}
      {#if router.route === 'week'}
        {#await import('../pages/Week.svelte') then { default: Week }}<Week />{/await}
      {:else if router.route === 'now'}
        {#await import('../pages/Now.svelte') then { default: Now }}<Now />{/await}
      {:else if router.route === 'forecasts'}
        <!-- Pages after the first are loaded on demand (first page < 200 KB JS). -->
        {#await import('../pages/Forecasts.svelte') then { default: Forecasts }}<Forecasts
          />{/await}
      {:else if boardOf(router.route)}
        {#await import('../pages/BoardPage.svelte') then { default: BoardPage }}
          <!-- a new board is a new page: load it afresh (Audit03 U-01) -->
          {#key boardOf(router.route)}
            <BoardPage id={boardOf(router.route)!} />
          {/key}
        {/await}
      {:else if router.route === 'charging'}
        <!-- Loaded on demand: only homes with evcc need it. -->
        {#if store.charging && !store.evcc && !store.plan}
          {#await import('../pages/HouseCharging.svelte') then { default: HouseCharging }}
            <HouseCharging />
          {/await}
        {:else}
          {#await import('../pages/Charging.svelte') then { default: Charging }}
            <Charging />
          {/await}
        {/if}
      {:else}
        <Overview />
      {/if}
    {/key}
  {/if}
</main>

{#if demoOnly}
  <footer>
    <a href="#/gallery">{t('nav.gallery')}</a>
  </footer>
{/if}

<style>
  .top,
  .nav,
  footer {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 32px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-top: 20px;
  }
  .brand {
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--text);
    text-decoration: none;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .seg {
    display: flex;
    background: var(--surface);
    border-radius: 22px;
    box-shadow: var(--shadow);
  }
  .seg button {
    min-width: 48px;
    height: 44px;
    border: 0;
    border-radius: 22px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .round {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--muted);
  }
  .nav {
    margin: 16px auto 8px;
  }
  .state {
    padding-top: 24px;
  }
  .loading {
    color: var(--muted);
    font-size: 15px;
    margin: 24px 0;
  }
  .notice {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .notice h1 {
    margin: 0;
  }
  .notice p,
  .notice ul {
    margin: 0;
    color: var(--muted);
  }
  .notice ul {
    padding-left: 18px;
  }
  .notice.small {
    margin-top: 12px;
  }
  .notice .title {
    color: var(--text);
    font-weight: 500;
  }
  .retry {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--text);
    cursor: pointer;
  }
  footer {
    padding-bottom: 32px;
    font-size: 14px;
  }
  footer a {
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  @media (max-width: 600px) {
    .top,
    .nav,
    footer {
      padding-left: 16px;
      padding-right: 16px;
    }
    .top {
      padding-top: 12px;
    }
    .nav {
      margin: 12px auto 4px;
    }
  }
</style>
