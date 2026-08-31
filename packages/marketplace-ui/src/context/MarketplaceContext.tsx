/**
 * The single fetch owner.
 *
 * Every balance on screen comes from here. Rows must never poll independently — that is how
 * `3N` requests per tick becomes `3N` uncoordinated timers against a rate-limited node.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPublicClient, http } from 'viem';
import type { Address, PublicClient } from 'viem';
import { config } from '../config/env';
import { usePolling } from '../hooks/usePolling';
import { isFunded, loadRegistry, readBalances } from '../lib/reads';
import { errorMessage } from '../lib/rpcError';
import { EMPTY_LINK_INDEX, enrichWithCards, loadAgentLinks } from '../lib/agents';
import type { AgentLinkIndex } from '../lib/agents';
import type { BalanceSnapshot, Registry } from '../lib/reads';

/** Re-read the registry every Nth tick; it changes far less often than balances do. */
const REGISTRY_RELOAD_EVERY = 12;

export interface MarketplaceState {
  client: PublicClient;
  registry?: Registry;
  balances?: BalanceSnapshot;
  /** True until the first successful load. Drives skeletons, so a real 0 never looks like "no data". */
  loading: boolean;
  /** Last tick failed: values on screen are the last known good ones. */
  stale: boolean;
  error?: string;
  lastUpdated?: number;
  /** Clones currently holding a non-zero ERC-20 balance — the batch sweep's input set. */
  fundedSplitters: Address[];
  /** splitter -> ERC-8004 agent, from registry metadata. Empty when no registry is configured. */
  agentLinks: AgentLinkIndex;
  /** Force an immediate refresh, e.g. right after a transaction confirms. */
  refresh: () => Promise<void>;
}

const MarketplaceContext = createContext<MarketplaceState | undefined>(undefined);

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () =>
      createPublicClient({
        chain: config.chain,
        // JSON-RPC batching collapses a whole tick into one HTTP round trip, and unlike
        // Multicall3 aggregation it covers eth_getBalance too.
        transport: http(config.rpcUrl, { batch: true }),
      }) as PublicClient,
    [],
  );

  const [registry, setRegistry] = useState<Registry>();
  const [agentLinks, setAgentLinks] = useState<AgentLinkIndex>(EMPTY_LINK_INDEX);
  const [balances, setBalances] = useState<BalanceSnapshot>();
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string>();
  const [lastUpdated, setLastUpdated] = useState<number>();

  const registryRef = useRef<Registry>();
  const tickRef = useRef(0);
  const inFlight = useRef(false);

  const refreshAgentLinks = useCallback(
    async (current: Registry) => {
      const registryConfig = config.identityRegistry;
      if (!registryConfig) return;

      const sellerBySplitter = new Map(
        current.sellers.map((seller) => [seller.splitter.toLowerCase(), seller.seller]),
      );

      try {
        const links = await loadAgentLinks(
          client,
          {
            registry: registryConfig.address,
            fromBlock: registryConfig.fromBlock,
            chunkBlocks: registryConfig.chunkBlocks,
            knownSplitters: current.sellers.map((seller) => seller.splitter),
          },
          (splitter) => sellerBySplitter.get(splitter.toLowerCase()),
        );
        // Render the on-chain half immediately; the card fetch hits a gateway we do not
        // control, and the badge must not wait on it.
        setAgentLinks(links);

        const enriched = await enrichWithCards(links, config.swarmGateway);
        if (enriched !== links) setAgentLinks(enriched);
      } catch {
        // Keep whatever labels we already had; a failed sweep is not worth a visible error.
      }
    },
    [client],
  );

  const tick = useCallback(
    async (forceRegistry: boolean) => {
      // Skip rather than queue: a slow node must not build a backlog of ticks.
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        const needsRegistry = forceRegistry || !registryRef.current;
        if (needsRegistry || tickRef.current % REGISTRY_RELOAD_EVERY === 0) {
          const next = await loadRegistry(client, config.factory);
          registryRef.current = next;
          setRegistry(next);
          // Agent labels are supplementary: a registry that is unset, unreachable, or slow must
          // never stop balances from rendering, so this is awaited separately and swallowed.
          void refreshAgentLinks(next);
        }

        const current = registryRef.current;
        if (current) {
          const snapshot = await readBalances(client, {
            treasury: config.treasury,
            sellers: current.sellers,
            currencies: config.currencies,
          });
          setBalances(snapshot);
        }

        setStale(false);
        setError(undefined);
        setLastUpdated(Date.now());
        setLoading(false);
      } catch (err) {
        // Keep the last good values on screen and mark them stale; blanking the table mid-demo
        // is worse than showing slightly old numbers.
        setError(errorMessage(err));
        setStale(true);
        setLoading(false);
      } finally {
        tickRef.current += 1;
        inFlight.current = false;
      }
    },
    [client],
  );

  usePolling(() => tick(false), config.refreshIntervalMs);

  const refresh = useCallback(() => tick(true), [tick]);

  const fundedSplitters = useMemo(() => {
    if (!registry || !balances) return [];
    return registry.sellers
      .map((s) => s.splitter)
      .filter((splitter) => isFunded(balances.splitters[splitter]));
  }, [registry, balances]);

  const value = useMemo<MarketplaceState>(
    () => ({
      client,
      registry,
      balances,
      loading,
      stale,
      error,
      lastUpdated,
      fundedSplitters,
      agentLinks,
      refresh,
    }),
    [
      client,
      registry,
      balances,
      loading,
      stale,
      error,
      lastUpdated,
      fundedSplitters,
      agentLinks,
      refresh,
    ],
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace(): MarketplaceState {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error('useMarketplace must be used inside <MarketplaceProvider>');
  return ctx;
}
