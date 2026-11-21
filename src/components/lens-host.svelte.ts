/**
 * The small trigger of a chart lens: the lens itself (Lens.svelte or BarLens.svelte with
 * its logic) is loaded only on the first hover, touch or focus of a chart – the charts
 * stay light.
 */
type LensComponent = (typeof import('./Lens.svelte'))['default'];
type BarLensComponent = (typeof import('./BarLens.svelte'))['default'];

function host<C>(load: () => Promise<{ default: C }>) {
  let comp = $state<C | null>(null);
  let first = $state<Event | null>(null);
  return {
    get Lens() {
      return comp;
    },
    get first() {
      return first;
    },
    wake(e: Event) {
      if (first) return;
      first = e;
      void load().then((m) => (comp = m.default));
    },
  };
}

/** the lens of a line chart */
export const lensHost = () => host<LensComponent>(() => import('./Lens.svelte'));
/** the lens of a bar chart (DayBars, StackDayBars, DayRanges) */
export const barLensHost = () => host<BarLensComponent>(() => import('./BarLens.svelte'));
