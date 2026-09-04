import { useEffect, useState } from 'react';

export type Route = 'dashboard' | 'map';

/** `#/map` is the map; everything else — including `''` and `#/` — is the home route. */
function parseRoute(hash: string): Route {
  return hash.replace(/^#\/?/, '') === 'map' ? 'map' : 'dashboard';
}

/**
 * The two-page router.
 *
 * Hash rather than the History API so a static `vite preview`, or any static host, serves both
 * pages without rewrite rules. `hashchange` does not fire for the URL the page loaded with, so
 * the initial route is read from `location.hash` directly rather than waited for.
 *
 * Deliberately holds only the route. Filter state stays in component state: writing it to the
 * hash would push a history entry per click, so Back would step through filter changes instead
 * of returning to the previous page.
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', sync);
    // The hash may have changed between the first render and this effect running.
    sync();
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return route;
}
