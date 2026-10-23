<script lang="ts">
  /**
   * One number with its story, in the style of a news energy monitor: icon,
   * big value, a short sentence in the topic colour, and the year curve
   * below (this year against earlier ones, labelled on the lines).
   */
  import Icon, { type IconName } from './Icon.svelte';
  import InfoButton from './InfoButton.svelte';
  import { flip } from './flip';
  import Explanation from './Explanation.svelte';
  import YearChart from './YearChart.svelte';
  import type { YearLine } from '../model/year';

  interface Props {
    title: string;
    icon: IconName;
    /** line colour */
    color: string;
    /** the same hue dark enough for text (WCAG AA) */
    textColor: string;
    value: string;
    unit: string;
    /** sentence after the value: [plain, bold, plain] */
    sentence: [string, string, string];
    lines: YearLine[];
    caption: string;
    startLabel: string;
    endLabel: string;
    info?: { what: string; source: string };
  }
  let props: Props = $props();
  const uid = $props.id();
  let open = $state(false);
  let el = $state<HTMLElement>();
  const toggle = () => flip(el, !open, () => (open = !open));
</script>

<article class="card" bind:this={el}>
  <header>
    <span class="title">{props.title}</span>
    {#if props.info}<InfoButton {open} ontoggle={toggle} controls="{uid}-info" />{/if}
  </header>
  {#if open && props.info}
    <div id="{uid}-info" class="flip-back">
      <Explanation what={props.info.what} source={props.info.source} />
    </div>
  {:else}
    <div class="lead">
      <span class="chip" style:color={props.color}><Icon name={props.icon} size={18} /></span>
      <span class="value" style:color={props.textColor}
        >{props.value}<span class="unit">{props.unit}</span></span
      >
    </div>
    <p class="sentence" style:color={props.textColor}>
      {props.sentence[0]} <b>{props.sentence[1]}</b>
      {props.sentence[2]}
    </p>
    <p class="caption" style:color={props.textColor}>{props.caption}</p>
    <YearChart
      lines={props.lines}
      color={props.color}
      textColor={props.textColor}
      startLabel={props.startLabel}
      endLabel={props.endLabel}
      label={props.title}
    />
  {/if}
</article>

<style>
  .flip-back {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* a long explanation scrolls; the soft edge says there is more */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
    padding-bottom: 14px;
  }
  .card {
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow);
    border: 2px solid var(--border);
    padding: 12px 14px 12px;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    padding-right: 30px;
  }
  header > :global(.info) {
    position: absolute;
    top: 3px;
    right: 3px;
    margin: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
  }
  .lead {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .chip {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .value {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: 16px;
    font-weight: 600;
    margin-left: 3px;
  }
  .sentence {
    margin: 4px 0 0;
    font-size: 14px;
    line-height: 1.3;
  }
  .caption {
    margin: 12px 0 4px;
    font-size: var(--small);
  }
</style>
