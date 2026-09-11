import { useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';
import { config } from '../config/env';

export type Route = 'dashboard' | 'map' | 'devcon' | 'claim-wallet';

/** Reachable only while VITE_SHOW_DEMO_FLOW is on. */
const DEMO_ROUTES: string[] = ['devcon', 'claim-wallet'];

/**
 * Vite's configured base, always with a trailing slash — `/` unless the app is served from a
 * sub-path. Every path this module reads or writes goes through it, so a sub-path deploy needs
 * `base` in `vite.config.ts` and nothing else.
 */
const BASE = import.meta.env.BASE_URL;

/** The part of a pathname after the base, with surrounding slashes stripped. */
function slugOf(pathname: string): string {
  if (`${pathname}/` === BASE) return '';
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return rest.replace(/^\/+|\/+$/g, '');
}

/**
 * `/map` is the map, `/devcon` and `/claim-wallet` are the demo pages, and everything else —
 * including `/` and any unknown path — is the home route.
 *
 * A demo path that outlives the flag resolves to the dashboard rather than a page the build is
 * hiding: a scanned QR code long outlives the build that printed it.
 */
function parseRoute(pathname: string): Route {
  const slug = slugOf(pathname);
  if (slug === 'map') return 'map';
  if (DEMO_ROUTES.includes(slug)) return config.showDemoFlow ? (slug as Route) : 'dashboard';
  return 'dashboard';
}

/** The URL for a route. Use this for every in-app link rather than writing paths by hand. */
export function href(route: Route): string {
  return route === 'dashboard' ? BASE : `${BASE}${route}`;
}

/**
 * `pushState` fires no event, so the store notifies its own subscribers. Kept module-level rather
 * than in a context: routing has no provider and needs none, and a context would put the whole
 * tree's re-render under a value that changes on navigation only.
 */
const subscribers = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    subscribers.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

/** Navigate without a page load. No-ops on the current route so Back does not collect duplicates. */
export function navigate(route: Route): void {
  const next = href(route);
  if (next === window.location.pathname) return;
  window.history.pushState(null, '', next);
  subscribers.forEach((notify) => notify());
}

/**
 * Props for an in-app link. A real `href` is load-bearing — it is what makes the link
 * middle-clickable, copyable, and visible to the browser as a destination; the handler only
 * suppresses the page load for the plain-left-click case.
 */
export function linkTo(route: Route): {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
} {
  return {
    href: href(route),
    onClick: (event) => {
      // Anything that is not a plain left click stays the browser's: cmd/ctrl opens a new tab,
      // shift a new window, and a full navigation is the right outcome for all of them.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(route);
    },
  };
}

/**
 * The router.
 *
 * Real paths rather than a hash, so `/map` is a URL a person can read and a QR code can encode
 * without a `#` in it. The cost is that the server must serve `index.html` for every unknown path
 * — see "Hosting" in this package's CLAUDE.md. `vite dev` and `vite preview` already do.
 *
 * `useSyncExternalStore` rather than state plus an effect: `location` is exactly an external
 * store, and reading it in the effect would leave the first render showing a route the URL had
 * already moved past.
 *
 * Deliberately holds only the route. Filter state stays in component state: writing it to the URL
 * would push a history entry per click, so Back would step through filter changes instead of
 * returning to the previous page.
 */
export function useRoute(): Route {
  // Returns a string union, so an unchanged route is referentially equal and re-render is skipped.
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.pathname));
}
