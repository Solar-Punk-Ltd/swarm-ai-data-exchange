import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '../config/env';
import { Claim, DevconError, createClaim, getClaim, releaseClaim } from '../lib/devcon';

/**
 * Owns the Claim Wallet page's buyer agent: asks for one on arrival, polls its progress, and hands
 * it back when the page closes.
 *
 * This does not relax the single-fetch-owner rule. That rule governs the registry and balance reads
 * in `MarketplaceContext`; this polls a different service for state no other view renders, and
 * folding it into the context would couple a demo page to the dashboard's tick.
 */

const TOKEN_KEY = 'devcon.sessionToken';

/**
 * Polled faster while the agent is still working. Nine states arrive over roughly a minute, four of
 * them inside a single purchase, and the server only folds in the buyer's emitted steps when it is
 * polled — so the cadence here *is* the resolution of the progress display. Once the item has
 * landed there is nothing left to watch, and the slower rate is enough to keep the heartbeat alive.
 */
const POLL_ACTIVE_MS = 2_000;
const POLL_SETTLED_MS = 5_000;

/** Terminal states — nothing further will happen. */
const SETTLED: ReadonlySet<Claim['state']> = new Set(['delivered', 'expired', 'failed']);

/**
 * A stable per-browser token, so a refresh or a re-scan reattaches to the same agent rather than
 * deploying a second funded one. Kept in `localStorage` because `sessionStorage` is per-tab and a
 * QR scan may well open a new tab.
 */
function sessionToken(): string {
  try {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing && existing.length >= 8) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // Private browsing can throw on both read and write. A per-load token still works; it just
    // cannot reattach after a refresh.
    return `ephemeral-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export interface ClaimResult {
  claim?: Claim;
  /** This browser's session token. The page needs it to prove ownership of a delivered item. */
  sessionToken: string;
  /** Readable failure. Set when the API is unreachable, at capacity, or the fleet is missing. */
  error?: string;
  /** Structured code where the server sent one, e.g. `at_capacity`, `fleet_missing`. */
  errorCode?: string;
  /** True until the first response of any kind arrives. */
  loading: boolean;
  /** Unset when `VITE_DEVCON_API_URL` is not configured — nothing can be claimed. */
  configured: boolean;
  retry: () => void;
}

export default function useClaim(): ClaimResult {
  const base = config.devconApiUrl;
  // Resolved once per mount, not per render: sessionToken() writes to localStorage on first use.
  const [token] = useState(sessionToken);
  const [claim, setClaim] = useState<Claim>();
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<string>();
  const [loading, setLoading] = useState(Boolean(base));
  const [attempt, setAttempt] = useState(0);

  // Read by the pagehide listener, which must see the current claim without re-subscribing on
  // every poll — re-registering an unload handler five times a minute is its own hazard.
  const claimRef = useRef<Claim>();
  claimRef.current = claim;

  const retry = useCallback(() => {
    setError(undefined);
    setErrorCode(undefined);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const fail = (err: unknown) => {
      if (stopped || controller.signal.aborted) return;
      const devcon = err instanceof DevconError ? err : undefined;
      setError(devcon?.message ?? (err as Error)?.message ?? 'Something went wrong.');
      setErrorCode(devcon?.code);
      setLoading(false);
    };

    const poll = async (claimId: string) => {
      if (stopped) return;
      try {
        const next = await getClaim(base, claimId, token, controller.signal);
        if (stopped) return;
        setClaim(next);
        setLoading(false);
        // Keep polling a settled-but-unreleased claim: `delivered` still lingers server-side, and
        // seeing it flip to released is how the page knows the agent has actually gone.
        if (next.released && SETTLED.has(next.state)) return;
        const wait = SETTLED.has(next.state) ? POLL_SETTLED_MS : POLL_ACTIVE_MS;
        timer = setTimeout(() => void poll(claimId), wait);
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        if (err instanceof DevconError && err.status === 404) {
          // The claim was reaped and forgotten. Asking again is the right move, not an error.
          void start();
          return;
        }
        // A single failed poll must not tear the page down — the agent is still running. Show it
        // and keep trying.
        setError(err instanceof DevconError ? err.message : 'Lost contact with the API.');
        setErrorCode(err instanceof DevconError ? err.code : undefined);
        timer = setTimeout(() => void poll(claimId), POLL_SETTLED_MS);
      }
    };

    const start = async () => {
      try {
        // Safe to call twice: the server is idempotent per session token, which is what makes
        // React 18 StrictMode's double mount in dev harmless here.
        const first = await createClaim(base, token, controller.signal);
        if (stopped) return;
        setClaim(first);
        setError(undefined);
        setErrorCode(undefined);
        setLoading(false);
        timer = setTimeout(() => void poll(first.claimId), POLL_ACTIVE_MS);
      } catch (err) {
        fail(err);
      }
    };

    void start();

    // Coming back to a backgrounded tab: mobile browsers suspend timers, so the heartbeat may
    // have lapsed and the agent may already be reaped. Poll at once — that either revives the
    // heartbeat or 404s into a fresh claim.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      const current = claimRef.current;
      if (timer) clearTimeout(timer);
      if (current && !current.released) void poll(current.claimId);
      else void start();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [base, attempt, token]);

  // Give the agent back on close. Registered once, and deliberately NOT in the effect above:
  // unmount also fires on an in-app route change and under StrictMode's double mount, and
  // releasing there would either kill an agent the visitor still wants or churn one per mount.
  // An in-app navigation instead stops the heartbeat and lets the server reap it.
  useEffect(() => {
    if (!base) return;
    const onPageHide = () => {
      const current = claimRef.current;
      if (current && !current.released) releaseClaim(base, current.claimId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [base]);

  return {
    claim,
    sessionToken: token,
    error,
    errorCode,
    loading,
    configured: Boolean(base),
    retry,
  };
}
