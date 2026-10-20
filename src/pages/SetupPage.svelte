<script lang="ts">
  /**
   * Setup assistant (ERSTEINRICHTUNG.md, path B): code from the installer →
   * four yes/no safety questions → "may I look?" → for solar, battery, grid:
   * "do you have one?" → manufacturer from a list → test → "does your app show
   * roughly that?" → save. Only yes/no, a look at the app, a pick from a list.
   * The server (server/setup.ts) talks to evcc and only creates meters.
   */
  import { onMount } from 'svelte';
  import { num, t } from '../i18n/index.svelte';

  type Usage = 'pv' | 'battery' | 'grid';
  interface Param {
    name: string;
    label: string;
    help: string;
    type: 'text' | 'number' | 'choice';
    choices?: string[];
    required: boolean;
    value?: string;
    unit?: string;
    advanced: boolean;
  }
  interface Template {
    template: string;
    brands: string[];
    products: string[];
    note?: string;
    params: Param[];
  }
  type Reading = Record<string, { value: number | boolean | null; error: string }>;

  const QUESTIONS = ['own_home', 'read_only', 'no_opening', 'ask_if_unsure'] as const;
  const ROLES: Usage[] = ['pv', 'battery', 'grid'];

  let phase = $state<
    'load' | 'code' | 'questions' | 'stop' | 'scan' | 'role' | 'finish' | 'done' | 'closed'
  >('load');
  let code = $state('');
  /** general stick: nobody has claimed the assistant yet – the first visitor gets the code */
  let claimable = $state(false);
  let claimedCode = $state('');
  let message = $state('');
  let busy = $state(false);
  let q = $state(0);
  let scanOn = $state(false);
  let found = $state<{ host: string; ports: number[] }[] | null>(null);
  let roleIdx = $state(0);
  let roleStep = $state<'ask' | 'pick' | 'form' | 'check' | 'direction' | 'saved'>('ask');
  let templates = $state<Template[]>([]);
  let search = $state('');
  let chosen = $state<Template | null>(null);
  let values = $state<Record<string, string>>({});
  let reading = $state<Reading | null>(null);
  let last = $state<{ template: string; brand: string; values: Record<string, string> } | null>(
    null,
  );

  const role = $derived(ROLES[roleIdx]!);
  const shown = $derived(
    templates
      .filter((x) =>
        search.trim()
          ? (x.brands.join(' ') + ' ' + x.products.join(' '))
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          : true,
      )
      .slice(0, 40),
  );
  const totalSteps = 4;
  const stepNo = $derived(
    phase === 'code' ? 1 : phase === 'questions' ? 2 : phase === 'scan' ? 3 : 4,
  );

  async function post(path: string, body: object = {}) {
    const r = await fetch(`/api/setup/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...body }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data };
  }
  function fail(e?: unknown) {
    message = t('setup.error');
    if (e) console.warn(e);
  }

  onMount(async () => {
    try {
      const r = await fetch('/api/setup');
      if (!r.ok) return void (phase = 'closed');
      const s = (await r.json()) as { open: boolean; scan: boolean; claimable?: boolean };
      scanOn = s.scan;
      claimable = s.claimable === true;
      // without a network to search, skip the question: the step only says where the address is
      if (!scanOn) found = [];
      phase = s.open ? 'code' : 'closed';
    } catch {
      phase = 'closed';
    }
  });

  async function claim() {
    busy = true;
    message = '';
    try {
      const r = await fetch('/api/setup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const b = (await r.json().catch(() => null)) as { code?: string } | null;
      if (r.ok && b?.code) {
        code = b.code;
        claimedCode = b.code;
        claimable = false;
      } else {
        claimable = false;
        message = t('setup.claimTaken');
      }
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  async function unlock() {
    busy = true;
    message = '';
    try {
      const r = await post('unlock');
      if (r.ok) phase = 'questions';
      else message = r.status === 429 ? t('setup.codeLocked') : t('setup.codeWrong');
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  async function answer(yes: boolean) {
    if (!yes) return void (phase = 'stop');
    if (q < QUESTIONS.length - 1) return void q++;
    busy = true;
    try {
      const r = await post('answers', {
        answers: Object.fromEntries(QUESTIONS.map((x) => [x, true])),
      });
      if (r.ok) phase = 'scan';
      else fail();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  async function doScan(yes: boolean) {
    if (!yes || !scanOn) return startRoles();
    busy = true;
    try {
      const r = await post('scan', { allowed: true });
      found = r.ok ? ((r.data.found as typeof found) ?? []) : [];
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  function startRoles() {
    phase = 'role';
    roleIdx = 0;
    roleStep = 'ask';
  }
  async function hasRole(yes: boolean) {
    message = '';
    if (!yes) return nextRole();
    busy = true;
    try {
      const r = await post('templates', { usage: role });
      templates = r.ok ? ((r.data.templates as Template[]) ?? []) : [];
      search = '';
      chosen = null;
      reading = null;
      roleStep = 'pick';
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  function pick(x: Template, preset?: Record<string, string>) {
    chosen = x;
    const v: Record<string, string> = {};
    for (const p of x.params) v[p.name] = preset?.[p.name] ?? p.value ?? '';
    const mb = (found ?? []).filter((f) => f.ports.some((p) => p !== 80));
    if (!v.host && mb.length === 1) v.host = mb[0]!.host;
    values = v;
    reading = null;
    roleStep = 'form';
  }
  async function test() {
    if (!chosen) return;
    busy = true;
    message = '';
    reading = null;
    try {
      const r = await post('test', { usage: role, template: chosen.template, values });
      if (!r.ok)
        return void (message =
          r.data.error === 'host_not_private' ? t('setup.noAnswer') : t('setup.error'));
      reading = (r.data.result as Reading) ?? null;
      roleStep = 'check';
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  /** "3,2 kW" / "64 %" from evcc's test answer; null when the device did not answer */
  const readText = (rd: Reading | null): string | null => {
    if (!rd) return null;
    const soc = rd.soc;
    if (role === 'battery' && soc && !soc.error && typeof soc.value === 'number')
      return `${num(soc.value)} %`;
    const p = rd.power;
    if (p && !p.error && typeof p.value === 'number') return `${num(p.value / 1000, 1)} kW`;
    return null;
  };
  /** evcc's sign: grid + = buying, battery + = giving power, pv + = producing */
  const powerW = (rd: Reading | null): number | null => {
    const p = rd?.power;
    return p && !p.error && typeof p.value === 'number' ? p.value : null;
  };
  async function confirm(yes: boolean) {
    if (!yes || !chosen) return void (message = t('setup.mismatch'));
    // the amount alone proves little: grid and battery also need the direction (Fremdtest 8)
    const w = powerW(reading);
    if ((role === 'grid' || role === 'battery') && w !== null && Math.abs(w) >= 100) {
      roleStep = 'direction';
      return;
    }
    await save();
  }
  function direction(positive: boolean) {
    const w = powerW(reading);
    if (w === null || w > 0 !== positive) {
      message = t('setup.signWrong');
      roleStep = 'check';
      return;
    }
    void save();
  }
  async function save() {
    if (!chosen) return;
    busy = true;
    try {
      const r = await post('save', { usage: role, template: chosen.template, values });
      if (!r.ok) return fail();
      last = {
        template: chosen.template,
        brand: chosen.brands[0] ?? chosen.template,
        values: { ...values },
      };
      roleStep = 'saved';
      message = t('setup.saved');
      setTimeout(nextRole, 900);
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  function nextRole() {
    message = '';
    if (roleIdx < ROLES.length - 1) {
      roleIdx++;
      roleStep = 'ask';
    } else phase = 'finish';
  }
  async function finish() {
    busy = true;
    try {
      const r = await post('finish');
      if (r.ok) phase = 'done';
      else fail();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  const sameAvailable = $derived(
    !!last && roleStep === 'pick' && templates.some((x) => x.template === last!.template),
  );
</script>

<div class="page">
  <h1 class="title">{t('setup.title')}</h1>

  {#if phase === 'load'}
    <p class="muted-note" role="status">{t('state.loading')}</p>
  {:else if phase === 'closed'}
    <section class="card">
      <p>{t('setup.closed')}</p>
      <a class="b main" href="#/">{t('setup.toDash')}</a>
    </section>
  {:else}
    {#if phase !== 'done' && phase !== 'stop'}
      <p class="step">{t('setup.step', { n: stepNo, of: totalSteps })}</p>
    {/if}
    <section class="card" aria-live="polite">
      {#if phase === 'code' && claimable}
        <p>{t('setup.claimIntro')}</p>
        <div class="row">
          <button class="b main" disabled={busy} onclick={() => claim()}>{t('setup.claim')}</button>
        </div>
      {:else if phase === 'code' && claimedCode}
        <p>{t('setup.claimed')}</p>
        <p class="bigcode">{claimedCode}</p>
        <div class="row">
          <button class="b main" disabled={busy} onclick={() => unlock()}>{t('setup.next')}</button>
        </div>
      {:else if phase === 'code'}
        <p>{t('setup.intro')}</p>
        <form
          class="row"
          onsubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <label class="field"
            ><span>{t('setup.code')}</span><input
              bind:value={code}
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="12"
              required
            /></label
          >
          <button class="b main" disabled={busy || !code.trim()}>{t('setup.next')}</button>
        </form>
        <p class="hint">{t('setup.codeHelp')}</p>
      {:else if phase === 'questions'}
        <p class="q">{t(`setup.q.${QUESTIONS[q]!}`)}</p>
        <div class="row">
          <button class="b main" disabled={busy} onclick={() => answer(true)}
            >{t('setup.yes')}</button
          >
          <button class="b" disabled={busy} onclick={() => answer(false)}>{t('setup.no')}</button>
        </div>
      {:else if phase === 'stop'}
        <p>{t('setup.stopNo')}</p>
      {:else if phase === 'scan'}
        {#if found === null}
          <p class="q">{t('setup.scanQ')}</p>
          <div class="row">
            <button class="b main" disabled={busy} onclick={() => doScan(true)}
              >{t('setup.yes')}</button
            >
            <button class="b" disabled={busy} onclick={() => doScan(false)}>{t('setup.no')}</button>
          </div>
          {#if busy}<p class="hint" role="status">{t('setup.scanning')}</p>{/if}
        {:else}
          <p>
            {scanOn
              ? found.length
                ? t('setup.scanFound', { n: found.length })
                : t('setup.scanNone')
              : t('setup.scanOff')}
          </p>
          {#if found.length}<ul class="found">
              {#each found as f (f.host)}<li>{f.host}</li>{/each}
            </ul>{/if}
          <button class="b main" onclick={startRoles}>{t('setup.next')}</button>
        {/if}
      {:else if phase === 'role'}
        <h2>{t(`setup.role.${role}`)}</h2>
        {#if roleStep === 'ask'}
          <p class="q">{t(`setup.roleQ.${role}`)}</p>
          <div class="row">
            <button class="b main" disabled={busy} onclick={() => hasRole(true)}
              >{t('setup.yes')}</button
            >
            <button class="b" disabled={busy} onclick={() => hasRole(false)}>{t('setup.no')}</button
            >
          </div>
        {:else if roleStep === 'pick'}
          {#if sameAvailable && last}
            <p class="q">{t('setup.same', { brand: last.brand })}</p>
            <div class="row">
              <button
                class="b main"
                onclick={() =>
                  pick(
                    templates.find((x) => x.template === last!.template)!,
                    last!.values,
                  )}>{t('setup.yes')}</button
              >
              <button class="b" onclick={() => (last = null)}>{t('setup.no')}</button>
            </div>
          {:else}
            <label class="field"
              ><span>{t('setup.brand')}</span><input
                bind:value={search}
                placeholder={t('setup.brandSearch')}
                autocomplete="off"
              /></label
            >
            <ul class="pick">
              {#each shown as x (x.template)}
                <li>
                  <button class="item" onclick={() => pick(x)}
                    ><strong>{x.brands.join(', ') || x.template}</strong>
                    <span>{x.products.slice(0, 3).join(' · ')}</span></button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        {:else if (roleStep === 'form' || roleStep === 'check' || roleStep === 'direction') && chosen}
          <p>
            <strong
              >{[chosen.brands.join(', '), chosen.products[0]].filter(Boolean).join(' · ')}</strong
            >
          </p>
          {#if chosen.note}<p class="hint">{chosen.note}</p>{/if}
          {#each chosen.params.filter((p) => !p.advanced) as p (p.name)}
            <label class="field"
              ><span
                >{p.name === 'host' ? t('setup.address') : p.label}{p.unit
                  ? ` (${p.unit})`
                  : ''}</span
              >
              {#if p.name === 'host' && found?.length}
                <!-- free to type; the devices found are only suggestions (Fremdtest 6) -->
                <input
                  bind:value={values[p.name]}
                  list="setup-hosts"
                  inputmode="decimal"
                  autocomplete="off"
                />
                <datalist id="setup-hosts">
                  {#each found as f (f.host)}<option value={f.host}
                      >{f.ports.some((x) => x !== 80) ? 'Modbus' : 'Web'}</option
                    >{/each}
                </datalist>
              {:else if p.type === 'choice'}
                <select bind:value={values[p.name]}>
                  {#each p.choices ?? [] as c (c)}<option value={c}>{c}</option>{/each}
                </select>
              {:else}
                <input
                  bind:value={values[p.name]}
                  inputmode={p.type === 'number' ? 'decimal' : 'text'}
                />
              {/if}
              {#if p.help}<small>{p.help}</small>{/if}
            </label>
          {/each}
          {#if chosen.params.some((p) => p.advanced)}
            <details>
              <summary>{t('setup.more')}</summary>
              {#each chosen.params.filter((p) => p.advanced) as p (p.name)}
                <label class="field"
                  ><span>{p.label}{p.unit ? ` (${p.unit})` : ''}</span><input
                    bind:value={values[p.name]}
                  />{#if p.help}<small>{p.help}</small>{/if}</label
                >
              {/each}
            </details>
          {/if}
          {#if roleStep === 'form'}
            <div class="row">
              <button class="b main" disabled={busy} onclick={test}>{t('setup.test')}</button>
              <button class="b" onclick={() => (roleStep = 'pick')}>{t('setup.back')}</button>
            </div>
            {#if busy}<p class="hint" role="status">{t('setup.testing')}</p>{/if}
          {:else}
            {@const r = readText(reading)}
            {#if roleStep === 'direction'}
              <p class="q">{t(role === 'grid' ? 'setup.dirGrid' : 'setup.dirBattery')}</p>
              <div class="row">
                <button class="b main" disabled={busy} onclick={() => direction(true)}
                  >{t(role === 'grid' ? 'setup.buy' : 'setup.discharging')}</button
                >
                <button class="b main" disabled={busy} onclick={() => direction(false)}
                  >{t(role === 'grid' ? 'setup.sell' : 'setup.charging')}</button
                >
              </div>
            {:else if r}
              <p class="q">{t('setup.read', { value: r })} {t('setup.check')}</p>
              {#if role === 'pv' && (powerW(reading) ?? 0) < 50}
                <p class="hint">{t('setup.pvNight')}</p>
              {/if}
              <div class="row">
                <button class="b main" disabled={busy} onclick={() => confirm(true)}
                  >{t('setup.yes')}</button
                >
                <button class="b" disabled={busy} onclick={() => confirm(false)}
                  >{t('setup.no')}</button
                >
              </div>
            {:else}
              <p class="warn">{t('setup.noAnswer')}</p>
              <button class="b" onclick={() => (roleStep = 'form')}>{t('setup.back')}</button>
            {/if}
          {/if}
        {:else if roleStep === 'saved'}
          <p>{t('setup.saved')}</p>
        {/if}
      {:else if phase === 'finish'}
        <p class="q">{t('setup.doneQ')}</p>
        <div class="row">
          <button class="b main" disabled={busy} onclick={finish}>{t('setup.finish')}</button>
          <button class="b" onclick={startRoles}>{t('setup.back')}</button>
        </div>
      {:else if phase === 'done'}
        <p>{t('setup.finished')}</p>
        <a class="b main" href="#/">{t('setup.toDash')}</a>
      {/if}
      {#if message}<p class="msg" role="alert">{message}</p>{/if}
    </section>
  {/if}
</div>

<style>
  .title {
    font-size: 26px;
    margin: 8px 0 4px;
  }
  .card {
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow);
    padding: 20px;
    display: grid;
    gap: 14px;
    max-width: 640px;
  }
  .step {
    color: var(--muted);
    font-size: 14px;
    margin: 0 0 8px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .q {
    font-size: 18px;
    line-height: 1.4;
    margin: 0;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
  }
  .b {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 96px;
    padding: 0 20px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: var(--surface);
    color: var(--text);
    font-size: 17px;
    cursor: pointer;
    text-decoration: none;
  }
  .b.main {
    background: var(--home);
    border-color: var(--home);
    color: #fff;
  }
  .b:disabled {
    opacity: 0.5;
  }
  .field {
    display: grid;
    gap: 6px;
    font-size: 15px;
  }
  .field small {
    color: var(--muted);
    font-size: 14px;
  }
  input,
  select {
    min-height: 48px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 17px;
    padding: 0 12px;
  }
  .hint {
    color: var(--muted);
    font-size: 15px;
  }
  .warn,
  .msg {
    color: var(--poor-text);
  }
  .pick {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 50vh;
    overflow: auto;
  }
  .item {
    width: 100%;
    text-align: left;
    display: grid;
    gap: 2px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .item span {
    color: var(--muted);
    font-size: 14px;
  }
  .found {
    margin: 0;
    padding-left: 18px;
  }
  details summary {
    cursor: pointer;
    color: var(--muted);
    min-height: 40px;
  }
  .bigcode {
    margin: 4px 0 12px;
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    font-variant-numeric: tabular-nums;
  }
</style>
