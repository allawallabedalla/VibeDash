/**
 * The small trigger of the chart lens: the lens itself (Lens.svelte with its logic) is
 * loaded only on the first hover, touch or focus of a chart – the charts stay light.
 */
type LensComponent = (typeof import('./Lens.svelte'))['default'];

export function lensHost() {
  let comp = $state<LensComponent | null>(null);
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
      void import('./Lens.svelte').then((m) => (comp = m.default));
    },
  };
}
