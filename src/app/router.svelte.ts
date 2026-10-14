/** Minimal hash router: #/ , #/now, #/forecasts, #/charging, #/gallery. No dependency needed. */
export type Route = 'overview' | 'now' | 'forecasts' | 'charging' | 'gallery';
const routes: Route[] = ['overview', 'now', 'forecasts', 'charging', 'gallery'];

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return (routes as string[]).includes(name) ? (name as Route) : 'overview';
}

let current = $state<Route>(
  typeof window === 'undefined' ? 'overview' : parse(window.location.hash),
);

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(window.location.hash);
    window.scrollTo(0, 0);
  });
}

export const router = {
  get route(): Route {
    return current;
  },
  go(route: Route) {
    window.location.hash = route === 'overview' ? '/' : `/${route}`;
  },
};
