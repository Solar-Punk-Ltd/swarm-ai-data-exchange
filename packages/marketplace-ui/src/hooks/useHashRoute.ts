import { useEffect, useState } from 'react';
import { config } from '../config/env';

export type Route = 'dashboard' | 'map' | 'devcon' | 'claim-wallet';

/** Reachable only while VITE_SHOW_DEMO_FLOW is on. */
const DEMO_ROUTES: string[] = ['devcon', 'claim-wallet'];

/**
 * `#/map` is the map, `#/devcon` and `#/claim-wallet` are the demo pages, and everything else —
 * including `''` and `#/` — is the home route.
 *
 * A demo hash that outlives the flag resolves to the dashboard rather than a page the build is
 * hiding: a scanned QR code long outlives the build that printed it.
 */
function parseRoute(hash: string): Route {
  const slug = hash.replace(/^#\/?/, '');
  if (slug === 'map') return 'map';
  if (DEMO_ROUTES.includes(slug)) return config.showDemoFlow ? (slug as Route) : 'dashboard';
  return 'dashboard';
}

/**
 * The router.
 *
 * Hash rather than the History API so a static `vite preview`, or any static host, serves every
 * page without rewrite rules. `hashchange` does not fire for the URL the page loaded with, so
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
