/**
 * Minimal hash router: #/ , #/week, #/now, #/forecasts, #/charging, #/gallery
 * and #/b/<id> for a board (a page a house service supplies). No dependency needed.
 */
type Fixed = 'overview' | 'week' | 'now' | 'forecasts' | 'charging' | 'gallery' | 'einrichten';
export type Route = Fixed | `b/${string}`;
const routes: Fixed[] = [
  'overview',
  'week',
  'now',
  'forecasts',
  'charging',
  'gallery',
  'einrichten',
];

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  if (/^b\/[a-z][a-z0-9_-]{0,31}$/.test(name)) return name as Route;
  return (routes as string[]).includes(name) ? (name as Route) : 'overview';
}

/** The board id of a route, or null. */
export const boardOf = (r: Route): string | null => (r.startsWith('b/') ? r.slice(2) : null);

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
