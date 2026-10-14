<script lang="ts">
  /** A battery that fills with the charge; a soft sheen runs up while charging, down while discharging. */
  let { soc, flow = 0 }: { soc: number; flow?: number } = $props();

  const f = $derived(Math.max(0, Math.min(100, soc || 0)));
  const color = $derived(f < 20 ? '#ff6b5e' : f < 50 ? '#ffc24b' : '#34c77b');
  const dir = $derived(flow >= 100 ? 'up' : flow <= -100 ? 'down' : '');
</script>

<div class="battery {dir}" aria-hidden="true">
  <div class="fill" style:width="{f}%" style:--fa={color}><span class="sheen"></span></div>
  <span class="pole"></span>
</div>

<style>
  .battery {
    position: relative;
    height: 22px;
    border-radius: 8px;
    border: 2px solid var(--line);
    padding: 2px;
    margin-right: 6px;
  }
  .pole {
    position: absolute;
    right: -6px;
    top: 6px;
    width: 4px;
    height: 6px;
    border-radius: 0 2px 2px 0;
    background: var(--line);
  }
  .fill {
    position: relative;
    height: 100%;
    border-radius: 5px;
    overflow: hidden;
    background: linear-gradient(90deg, color-mix(in srgb, var(--fa) 65%, #fff), var(--fa));
    transition: width 0.8s ease;
  }
  .sheen {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
    transform: translateX(-100%);
  }
  .up .sheen {
    animation: up 2.4s ease-in-out infinite;
  }
  .down .sheen {
    animation: down 2.4s ease-in-out infinite;
  }
  @keyframes up {
    to {
      transform: translateX(100%);
    }
  }
  @keyframes down {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(-100%);
    }
  }
</style>
