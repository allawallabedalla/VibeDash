<script lang="ts">
  /**
   * Pull to refresh on touch screens (iPhone home-screen app has none of its
   * own): at the top of the page, pull down past the mark and let go – the
   * page reloads (fresh data, newest release). Listeners are passive, so
   * normal scrolling is never held up; sideways swipes (tabs) and pulls while
   * typing or with a dialog open are ignored.
   */
  import { onMount } from 'svelte';
  import { busyTyping } from '../app/data.svelte';
  import { t } from '../i18n/index.svelte';

  const MARK = 64; // px of (damped) pull that triggers
  const MAX = 96;
  let dist = $state(0);
  let busy = $state(false);

  onMount(() => {
    let x0 = 0;
    let y0 = 0;
    let mode: 'idle' | 'maybe' | 'pull' = 'idle';
    const start = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || window.scrollY > 0 || busyTyping()) {
        mode = 'idle';
        return;
      }
      x0 = e.touches[0]!.clientX;
      y0 = e.touches[0]!.clientY;
      mode = 'maybe';
    };
    const move = (e: TouchEvent) => {
      if (mode === 'idle') return;
      const dx = e.touches[0]!.clientX - x0;
      const dy = e.touches[0]!.clientY - y0;
      if (mode === 'maybe') {
        if (Math.abs(dx) > 10 || dy < -4) mode = 'idle';
        else if (dy > 10 && dy > Math.abs(dx) * 1.5 && window.scrollY <= 0) mode = 'pull';
        else return;
      }
      if (mode === 'pull') dist = Math.min(MAX, Math.max(0, dy * 0.5));
    };
    const end = () => {
      if (mode === 'pull' && dist >= MARK) {
        busy = true;
        dist = MARK;
        location.reload();
      } else if (!busy) dist = 0;
      mode = 'idle';
    };
    const opt = { passive: true };
    window.addEventListener('touchstart', start, opt);
    window.addEventListener('touchmove', move, opt);
    window.addEventListener('touchend', end, opt);
    window.addEventListener('touchcancel', end, opt);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  });
</script>

{#if dist > 0}
  <div
    class="pull"
    class:ready={dist >= MARK}
    class:busy
    style:transform="translate(-50%, {dist - 44}px)"
    style:opacity={Math.min(1, dist / MARK)}
    role="status"
    aria-label={t('pull.refresh')}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true" style:transform="rotate({busy ? 0 : dist * 4}deg)">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  </div>
{/if}

<style>
  .pull {
    position: fixed;
    top: env(safe-area-inset-top, 0px);
    left: 50%;
    z-index: 50;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.12);
    pointer-events: none;
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--text-2);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ready svg {
    stroke: var(--text);
  }
  .busy svg {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy svg {
      animation: none;
    }
  }
</style>
