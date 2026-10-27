<script lang="ts">
  /** The questions to the person, grouped by device, each answerable with yes or no. */
  import Card from '../components/Card.svelte';
  import Icon from '../components/Icon.svelte';
  import type { Question } from '../app/questions';
  import { t } from '../i18n/index.svelte';

  let {
    open: qs,
    groups: qGroups,
    answered,
    answers,
    canAnswer,
    openAll,
    focusArea,
    onanswer: answer,
  }: {
    open: Question[];
    groups: { name: string; items: Question[] }[];
    answered: Question[];
    answers: Record<string, { a: 'yes' | 'no' }>;
    canAnswer: boolean;
    /** groups start open (wide screen, few groups) */
    openAll: boolean;
    /** the status pill that was tapped opens the groups of its area */
    focusArea: Question['area'] | null;
    onanswer: (id: string, a: 'yes' | 'no' | null) => void;
  } = $props();
</script>

<Card
  title={qs.length === 0
    ? t('q.allAnswered')
    : t('q.open', { count: qs.length === 1 ? t('q.one') : t('q.count', { n: qs.length }) })}
  icon="info"
  color="var(--fair)"
>
  {#each qGroups as g (g.name)}
    <details class="qgroup" open={openAll || g.items.some((q) => q.area === focusArea)}>
      <summary>
        <span class="qname">{g.name}</span>
        <span class="qn"
          >{g.items.length === 1 ? t('q.one') : t('q.count', { n: g.items.length })}</span
        >
      </summary>
      <ul class="questions">
        {#each g.items as q (q.id)}
          <li>
            <span class="qicon"><Icon name="info" size={18} /></span>
            <span class="qtext">{q.text}</span>
            {#if canAnswer && q.answerable !== false}
              <span class="qans">
                <button type="button" onclick={() => answer(q.id, 'yes')}>{t('q.yes')}</button>
                <button type="button" onclick={() => answer(q.id, 'no')}>{t('q.no')}</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/each}
  {#if answered.length > 0}
    <details class="qgroup">
      <summary>
        <span class="qname">{t('q.answered')}</span>
        <span class="qn">{answered.length}</span>
      </summary>
      <ul class="questions">
        {#each answered as q (q.id)}
          <li>
            <span class="qicon done"><Icon name="okCircle" size={18} /></span>
            <span class="qtext"
              >{q.text}
              <strong>{answers[q.id]?.a === 'yes' ? t('q.yes') : t('q.no')}</strong></span
            >
            {#if canAnswer}
              <span class="qans">
                <button type="button" onclick={() => answer(q.id, null)}>{t('q.undo')}</button>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</Card>

<style>
  .qgroup + .qgroup {
    border-top: 1px solid var(--line);
  }
  .qgroup summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
    list-style: none;
  }
  .qgroup summary::-webkit-details-marker {
    display: none;
  }
  .qgroup summary::after {
    content: '';
    width: 8px;
    height: 8px;
    margin-left: 4px;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    transform: rotate(-45deg);
    transition: transform 0.15s;
  }
  .qgroup[open] summary::after {
    transform: rotate(45deg);
  }
  .qname {
    font-weight: 600;
  }
  .qn {
    margin-left: auto;
    color: var(--muted);
  }
  .questions {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .questions li {
    display: flex;
    gap: 10px;
    line-height: 1.45;
  }
  .qicon {
    flex: none;
    color: var(--fair-text);
    padding-top: 1px;
  }
  .qicon.done {
    color: var(--good-text);
  }
  .qtext {
    flex: 1;
  }
  .qans {
    flex: none;
    display: flex;
    gap: 8px;
    margin-top: -10px;
  }
  .qans button {
    min-width: 56px;
    height: 44px;
    padding: 0 14px;
    border: 2px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  /* phone: the answers go under the question, not beside it */
  @media (max-width: 600px) {
    .questions li {
      flex-wrap: wrap;
    }
    .qtext {
      flex-basis: calc(100% - 28px);
    }
    .qans {
      margin: 0 0 0 28px;
    }
  }
</style>
