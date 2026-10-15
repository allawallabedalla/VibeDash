/**
 * ⓘ as a card flip: the card turns to its edge, the content swaps between the
 * front (values) and the back (explanation), then it turns back to face us.
 * The card keeps its height while the back is shown (a long explanation
 * scrolls inside), so nothing around it jumps. With "reduce motion" the
 * content simply swaps.
 */
import { tick } from 'svelte';

const busy = new WeakSet<HTMLElement>();
const PERSPECTIVE = 'perspective(1100px)';

export async function flip(el: HTMLElement | undefined, toBack: boolean, swap: () => void) {
  if (!el || busy.has(el)) return;
  const still =
    typeof window === 'undefined' ||
    typeof el.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // keep the size of the front while the back is shown
  if (toBack) el.style.height = `${el.offsetHeight}px`;
  if (still) {
    swap();
    await tick();
    if (!toBack) el.style.height = '';
    return;
  }
  busy.add(el);
  try {
    await el.animate(
      [
        { transform: `${PERSPECTIVE} rotateY(0deg)` },
        { transform: `${PERSPECTIVE} rotateY(90deg)` },
      ],
      { duration: 210, easing: 'cubic-bezier(.45,0,1,1)' },
    ).finished;
    swap();
    await tick();
    if (!toBack) el.style.height = '';
    await el.animate(
      [
        { transform: `${PERSPECTIVE} rotateY(-90deg)` },
        { transform: `${PERSPECTIVE} rotateY(0deg)` },
      ],
      { duration: 280, easing: 'cubic-bezier(0,0,.25,1)' },
    ).finished;
  } catch {
    // an interrupted animation (page left): the content is swapped anyway
  } finally {
    busy.delete(el);
  }
}
