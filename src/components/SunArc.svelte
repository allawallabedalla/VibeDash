<script lang="ts">
  /** Half arc 0–max for the sun right now; a glowing dot at the tip, a moon when it is off. */
  let { share, off = false }: { share: number; off?: boolean } = $props();

  const r = 34;
  const cx = 44;
  const cy = 40;
  const len = Math.PI * r;
  const a = $derived(Math.max(0, Math.min(1, share || 0)));
  const uid = $props.id();
</script>

<svg class="arc" viewBox="0 0 88 46" aria-hidden="true">
  <defs>
    <linearGradient id="{uid}-g" x1="0" x2="1">
      <stop offset="0" stop-color="#ffd66b" />
      <stop offset="1" stop-color="#ff9f0a" />
    </linearGradient>
  </defs>
  <path d="M{cx - r},{cy} A{r},{r} 0 0 1 {cx + r},{cy}" class="track" />
  {#if a > 0.005}
    <path
      d="M{cx - r},{cy} A{r},{r} 0 0 1 {cx + r},{cy}"
      class="fill"
      stroke="url(#{uid}-g)"
      stroke-dasharray="{(a * len).toFixed(1)} {len.toFixed(1)}"
    />
  {/if}
  {#if off}
    <circle {cx} cy={cy - 6} r="5" class="moon" />
  {:else}
    <circle
      cx={(cx - r * Math.cos(Math.PI * a)).toFixed(1)}
      cy={(cy - r * Math.sin(Math.PI * a)).toFixed(1)}
      r="4.5"
      class="glow"
    />
  {/if}
</svg>

<style>
  .arc {
    width: 100%;
    max-width: 120px;
    height: auto;
    display: block;
    overflow: visible;
  }
  .track {
    fill: none;
    stroke: var(--track);
    stroke-width: 8;
    stroke-linecap: round;
  }
  .fill {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    transition: stroke-dasharray 0.8s ease;
  }
  .glow {
    fill: #ff9f0a;
    filter: drop-shadow(0 0 4px rgba(255, 159, 10, 0.7));
    animation: glimmer 3s ease-in-out infinite;
  }
  .moon {
    fill: var(--faint);
  }
  @keyframes glimmer {
    50% {
      opacity: 0.65;
    }
  }
  @media (max-width: 600px) {
    .arc {
      max-width: 90px;
    }
  }
</style>
