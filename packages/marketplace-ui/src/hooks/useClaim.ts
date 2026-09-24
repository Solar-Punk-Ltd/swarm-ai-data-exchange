import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '../config/env';
import {
  Claim,
  ClaimItem,
  DevconError,
  createClaim,
  getClaim,
  parseVoucher,
  releaseClaim,
} from '../lib/devcon';

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

/** States that mean this claim's agent got as far as paying for something. */
const PURCHASED: ReadonlySet<Claim['state']> = new Set(['settled', 'downloading', 'delivered']);

/**
 * Whether this claim ever completed a purchase — read from `history`, not just `state`, so it
 * stays true after the claim has since expired or been released.
 *
 * Once it is true the page must never ask for another agent. `find_by_token` on the server only
 * reattaches an *unreleased* claim, so a second POST after teardown does not return the finished
 * claim — it deploys a second funded buyer and replaces the purchase on screen with a fresh
 * `provisioning`. The visitor watching their settled purchase would see it vanish.
 */
function purchased(claim: Claim): boolean {
  if (claim.txHash) return true;
  if (PURCHASED.has(claim.state)) return true;
  return claim.history.some(([state]) => PURCHASED.has(state));
}

/**
 * Whether this item is the richest form of itself the page will ever be handed.
 *
 * For a voucher that means the private key is present. The API holds the key in memory only and
 * drops it when the claim is released — roughly 30s after delivery, once the collector's linger
 * expires — after which every poll returns the same claim with a *redacted* voucher. Overwriting
 * a complete item with that redacted one is what made the QR code vanish while the visitor was
 * still looking at it.
 *
 * A non-voucher item is complete as soon as its content is present: there is no second, richer
 * form of it to wait for.
 */
function isCompleteItem(item: ClaimItem | null | undefined): boolean {
  if (!item || item.content === null) return false;
  const voucher = parseVoucher(item.content);
  return voucher ? Boolean(voucher.privateKey) : true;
}

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

  // Latches once this page's agent has bought something, and is never cleared. Guards every path
  // that would ask for a new agent, so a completed purchase stays on screen for as long as the
  // tab is open.
  const purchasedRef = useRef(false);

  // The delivered item in its complete form, held for as long as the tab is open. The server
  // deliberately forgets the voucher's private key when the claim is released, so this tab is the
  // only place it still exists — losing it to a later poll would mean losing the wallet.
  //
  // Memory only, never localStorage: "shown once, in this browser, stored nowhere" is the
  // guarantee the page makes, and writing the key to disk would break it. A reload therefore
  // still shows the redacted voucher, which is the intended trade.
  const deliveredItemRef = useRef<ClaimItem>();

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

    // Keeps the delivered item at its high-water mark. Every other field on the claim is taken
    // from the response as usual — only the item is held back from regressing, so the page still
    // shows `released` and the closing message while the item above it stays intact.
    const keepItem = (next: Claim): Claim => {
      if (isCompleteItem(next.item)) {
        deliveredItemRef.current = next.item ?? undefined;
        return next;
      }
      const held = deliveredItemRef.current;
      return held ? { ...next, item: held } : next;
    };

    const poll = async (claimId: string) => {
      if (stopped) return;
      try {
        const next = await getClaim(base, claimId, token, controller.signal);
        if (stopped) return;
        if (purchased(next)) purchasedRef.current = true;
        setClaim(keepItem(next));
        setLoading(false);
        // Keep polling a settled-but-unreleased claim: `delivered` still lingers server-side, and
        // seeing it flip to released is how the page knows the agent has actually gone.
        if (next.released && SETTLED.has(next.state)) return;
        const wait = SETTLED.has(next.state) ? POLL_SETTLED_MS : POLL_ACTIVE_MS;
        timer = setTimeout(() => void poll(claimId), wait);
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        if (err instanceof DevconError && err.status === 404) {
          // The claim was cleared and forgotten. Asking again is the right move, not an error —
          // unless this page already showed a purchase, in which case the last known claim stays
          // rendered and nothing further is deployed behind it.
          if (purchasedRef.current) return;
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
      // A finished purchase is the end of this page's life. Never ask for a second agent.
      if (purchasedRef.current) return;
      try {
        // Safe to call twice: the server is idempotent per session token, which is what makes
        // React 18 StrictMode's double mount in dev harmless here.
        const first = await createClaim(base, token, controller.signal);
        if (stopped) return;
        if (purchased(first)) purchasedRef.current = true;
        setClaim(keepItem(first));
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
    // have lapsed and the agent may already be cleared. Poll at once — that either revives the
    // heartbeat or 404s into a fresh claim.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      // Returning to a tab that already holds a purchase: there is nothing to revive and nothing
      // to claim. Leaving this unguarded is the likeliest way to deploy a second agent, because
      // the claim is released moments after delivery and `start()` below would not reattach.
      if (purchasedRef.current) return;
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
  // An in-app navigation instead stops the heartbeat and lets the server clear it.
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
