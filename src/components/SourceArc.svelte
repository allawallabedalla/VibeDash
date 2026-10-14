<script lang="ts">
  /** Where the power comes from right now (sun / battery / grid) as a soft arc. */
  import { num } from '../i18n/index.svelte';

  interface Part {
    label: string;
    value: number;
    color: string;
  }
  let {
    parts,
    total,
    unit = 'kW',
    caption,
  }: { parts: Part[]; total: string; unit?: string; caption: string } = $props();

  const size = 220;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const gap = 0.06; // radians between segments

  const sum = $derived(parts.reduce((a, p) => a + Math.max(p.value, 0), 0));
  const visible = $derived(parts.filter((p) => p.value > 0));

  const segments = $derived.by(() => {
    if (sum <= 0) return [];
    const totalGap = gap * Math.max(visible.length - 1, 0);
    let a = Math.PI;
    return visible.map((p) => {
      const span = ((Math.PI - totalGap) * p.value) / sum;
      const a0 = a;
      const a1 = a - span;
      a = a1 - gap;
      const pt = (t: number) =>
        `${(cx + r * Math.cos(t)).toFixed(1)},${(cy - r * Math.sin(t)).toFixed(1)}`;
      return { d: `M${pt(a0)}A${r},${r} 0 0 1 ${pt(a1)}`, color: p.color };
    });
  });

  const pct = (v: number) => (sum > 0 ? Math.round((Math.max(v, 0) / sum) * 100) : 0);
</script>

<figure class="arc">
  <div class="graphic">
    <svg viewBox="0 0 {size} {size / 2 + stroke / 2}" aria-hidden="true">
      <path
        d="M{cx - r},{cy}A{r},{r} 0 0 1 {cx + r},{cy}"
        fill="none"
        stroke="var(--line)"
        stroke-width={stroke}
        stroke-linecap="round"
        opacity="0.6"
      />
      {#each segments as s, i (i)}
        <path d={s.d} fill="none" stroke={s.color} stroke-width={stroke} stroke-linecap="round" />
      {/each}
    </svg>
    <div class="center">
      <div class="value">{total}<span class="unit">{unit}</span></div>
      <div class="caption">{caption}</div>
    </div>
  </div>
  <figcaption>
    {#each parts as p (p.label)}
      <span class="item" class:zero={p.value <= 0}>
        <span class="dot" style:background={p.color}></span>
        {p.label}
        <strong>{num(pct(p.value))} %</strong>
      </span>
    {/each}
  </figcaption>
</figure>

<style>
  .arc {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .graphic {
    position: relative;
    width: 100%;
    max-width: 240px;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .center {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    text-align: center;
  }
  .value {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    font-size: 15px;
    font-weight: 500;
    color: var(--muted);
    margin-left: 4px;
  }
  .caption {
    font-size: var(--small);
    color: var(--muted);
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 16px;
    font-size: 14px;
    color: var(--muted);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .item strong {
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .item.zero {
    opacity: 0.6;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
</style>
