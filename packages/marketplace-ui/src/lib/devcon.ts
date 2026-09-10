/**
 * Client for `agent-orchestration-api` (in the `swarm-agent-demo` repo), which leases a buyer
 * agent to a visitor of the Claim Wallet page.
 *
 * This is the only service this package talks to besides the chain and the Swarm gateway, and it
 * is the only one that is *ours* — so unlike the gateway it may legitimately be down, misconfigured
 * or unreachable from the phone's network, and every failure here has to be renderable rather than
 * swallowed.
 *
 * Plain async functions with an `AbortController`, matching `lib/agents.ts`. No client instance and
 * no caching: the page owns exactly one claim at a time.
 */

/** Mirrors the claim lifecycle in `agent-orchestration-api/app/claims.py`. */
export type ClaimState =
  | 'provisioning'
  | 'funding'
  | 'starting'
  | 'buying'
  | 'purchased'
  | 'expired'
  | 'failed';

export interface Claim {
  claimId: string;
  state: ClaimState;
  released: boolean;
  buyerAddress: string | null;
  expiresAt: string | null;
  secondsRemaining: number;
  itemId: string | null;
  txHash: string | null;
  error: string | null;
}

export interface DevconStatus {
  fleet: string;
  fleetReady: boolean;
  sellerAgentId: string | null;
  liveAgents: number;
  maxAgents: number;
  atCapacity: boolean;
  claimTtlSeconds: number;
  maxPurchases: number;
}

/** An API failure, carrying the structured `error` code the server sends where there is one. */
export class DevconError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DevconError';
  }
}

const TIMEOUT_MS = 10_000;

/**
 * FastAPI puts handler-raised detail under `detail`, which is an object for our structured errors
 * (`{error, message, ...}`) and an array for its own request-validation failures. Reduce both to
 * one readable line, the way `lib/rpcError.ts` does for wallet errors.
 */
async function toError(response: Response): Promise<DevconError> {
  let code: string | undefined;
  let message = `Request failed (${response.status})`;
  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown })?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const record = detail as { error?: string; message?: string };
      code = record.error;
      message = record.message ?? record.error ?? message;
    } else if (typeof detail === 'string') {
      message = detail;
    }
  } catch {
    // A non-JSON body (a proxy error page, say) leaves the status-derived message.
  }
  return new DevconError(message, code, response.status);
}

async function request<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  // Either the caller unmounting or our own timeout should cancel the request.
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof DevconError) throw err;
    if (signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
    // A network-level failure is the common misconfiguration: the phone cannot reach the API's
    // host, or CORS rejected the call. Say so, rather than reporting "Failed to fetch".
    throw new DevconError(
      'Could not reach the agent orchestration API. Check VITE_DEVCON_API_URL and that the ' +
        'API allows this origin.',
      'unreachable',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Ask for a buyer agent. Returns immediately with a claim in `provisioning` — the server does the
 * work in the background, so poll `getClaim` for progress.
 *
 * Idempotent per `sessionToken`: a refresh or a re-scan reattaches to the existing claim instead of
 * deploying a second funded agent.
 */
export function createClaim(base: string, sessionToken: string, signal?: AbortSignal) {
  return request<Claim>(
    `${base}/devcon/agents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken }),
    },
    signal,
  );
}

/** Progress for a claim. This call is also the heartbeat that keeps the agent alive. */
export function getClaim(base: string, claimId: string, signal?: AbortSignal) {
  return request<Claim>(`${base}/devcon/agents/${claimId}`, { method: 'GET' }, signal);
}

/** Capacity and configuration, so the page can distinguish "full" from "broken". */
export function getStatus(base: string, signal?: AbortSignal) {
  return request<DevconStatus>(`${base}/devcon/status`, { method: 'GET' }, signal);
}

/**
 * Hand the agent back as the page closes. Fire-and-forget by construction — the document is going
 * away, so there is nobody left to report a failure to.
 *
 * Uses `sendBeacon`, the only request that reliably survives `pagehide` on mobile. It can *only*
 * issue POST, which is why the API exposes `POST .../release` next to its `DELETE`. `keepalive`
 * fetch is the fallback where `sendBeacon` is missing or refuses to queue.
 *
 * This is best-effort, not the guarantee: a phone that locks its screen or loses wifi fires nothing
 * at all, and the server's heartbeat timeout is what actually reclaims the agent.
 */
export function releaseClaim(base: string, claimId: string): void {
  const url = `${base}/devcon/agents/${claimId}/release`;
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url)) return;
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}
