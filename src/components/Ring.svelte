<script lang="ts">
  /** Soft ring for a share 0–1. */
  let {
    value,
    color = 'var(--text)',
    size = 56,
  }: { value: number; color?: string; size?: number } = $props();

  const stroke = 7;
  const r = $derived((size - stroke) / 2);
  const c = $derived(2 * Math.PI * r);
  const share = $derived(Math.min(1, Math.max(0, value)));
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
  <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--line)" stroke-width={stroke} />
  <circle
    cx={size / 2}
    cy={size / 2}
    {r}
    fill="none"
    stroke={color}
    stroke-width={stroke}
    stroke-linecap="round"
    stroke-dasharray="{c * share} {c}"
    transform="rotate(-90 {size / 2} {size / 2})"
  />
</svg>
