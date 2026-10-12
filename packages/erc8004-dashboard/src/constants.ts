export const AGENT_DISPLAY_LIMIT = 25;
export const CATALOGUE_FEED_BROWSER_URL = 'http://localhost:3001/';

/**
 * Chains the dashboard can read, keyed by numeric chain id. `adapterChain` is the
 * erc8004-adapter's chain key (its CHAIN_DEFAULTS carries the registry address per chain).
 *
 * Default RPCs are publicnode for Base Sepolia — `sepolia.base.org` rate-limits eth_getLogs
 * hard — and Celo's own Forno for Celo Sepolia.
 */
export interface ChainEntry {
  id: number;
  adapterChain: 'base-sepolia' | 'base' | 'celo-sepolia' | 'celo';
  name: string;
  defaultRpc: string;
}

export const CHAINS: Record<number, ChainEntry> = {
  84532: {
    id: 84532,
    adapterChain: 'base-sepolia',
    name: 'Base Sepolia',
    defaultRpc: 'https://base-sepolia-rpc.publicnode.com',
  },
  11142220: {
    id: 11142220,
    adapterChain: 'celo-sepolia',
    name: 'Celo Sepolia',
    defaultRpc: 'https://forno.celo-sepolia.celo-testnet.org',
  },
};

const DEFAULT_CHAIN_ID = 84532;

/** URL parameter and localStorage key carrying the viewer's chain choice. */
export const CHAIN_QUERY_PARAM = 'chain';
export const CHAIN_STORAGE_KEY = 'erc8004-dashboard.chainId';

type Env = Record<string, string | undefined>;

/**
 * `VITE_CHAIN_IDS` as a comma list of supported ids, else just the default chain. Unknown ids
 * are dropped with a console warning — this dashboard has no config-error screen, and an empty
 * list falls back to the default rather than rendering nothing.
 */
function parseChainIds(env: Env, defaultChainId: number): number[] {
  const raw = env.VITE_CHAIN_IDS;
  if (!raw) return [defaultChainId];
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const id = Number(part.trim());
    if (!part.trim()) continue;
    if (!CHAINS[id]) {
      console.warn(`VITE_CHAIN_IDS entry "${part.trim()}" is not supported; ignoring it.`);
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : [defaultChainId];
}

/**
 * The viewer's chain: `?chain=` in the URL, then the remembered choice, then the default. Anything
 * unknown falls back — a stale link must not blank the dashboard.
 */
export function selectChainId(offered: number[], defaultChainId: number): number {
  if (typeof window === 'undefined') return defaultChainId;
  const candidates: (string | null | undefined)[] = [];
  try {
    candidates.push(new URL(window.location.href).searchParams.get(CHAIN_QUERY_PARAM));
  } catch {
    // An unparsable location is not worth more than the default.
  }
  try {
    candidates.push(window.localStorage.getItem(CHAIN_STORAGE_KEY));
  } catch {
    // Private windows and blocked storage throw on access; the default is the right answer.
  }
  for (const raw of candidates) {
    if (!raw) continue;
    const id = Number(raw);
    if (offered.includes(id)) return id;
  }
  return defaultChainId;
}

const env = import.meta.env as unknown as Env;
const configuredDefault = env.VITE_CHAIN_ID ? Number(env.VITE_CHAIN_ID) : DEFAULT_CHAIN_ID;
const defaultChainId = CHAINS[configuredDefault] ? configuredDefault : DEFAULT_CHAIN_ID;

/** The chains offered in the header dropdown. */
export const OFFERED_CHAINS: ChainEntry[] = parseChainIds(env, defaultChainId).map(
  (id) => CHAINS[id],
);

const effectiveDefault = OFFERED_CHAINS.some((c) => c.id === defaultChainId)
  ? defaultChainId
  : OFFERED_CHAINS[0].id;

/** The chain this page load reads. Changing it reloads the page (see ChainSelect). */
export const CHAIN: ChainEntry =
  CHAINS[
    selectChainId(
      OFFERED_CHAINS.map((c) => c.id),
      effectiveDefault,
    )
  ];

/**
 * RPC for the selected chain: `VITE_RPC_URL_<id>`, then — for the default chain only — the
 * unsuffixed `VITE_RPC_URL`, then the chain's default endpoint. The unsuffixed fallback is what
 * keeps an existing single-chain `.env` working.
 */
export const RPC_URL: string =
  env[`VITE_RPC_URL_${CHAIN.id}`] ||
  (CHAIN.id === effectiveDefault ? env.VITE_RPC_URL : undefined) ||
  CHAIN.defaultRpc;
