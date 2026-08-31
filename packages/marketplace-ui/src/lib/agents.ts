/**
 * Resolving which ERC-8004 agent owns each splitter clone.
 *
 * The binding lives in the Identity Registry as metadata under `agent_splitter`, written by
 * `link_split_contract`. `MetadataSet` indexes the key, so the whole splitter -> agent reverse
 * index is one log query rather than a crawl over every Agent Card.
 *
 * A claim is not proof. Any agent owner can write any address under that key, so every link here
 * is verified against two independent facts before the UI calls it confirmed:
 *   1. the claimed splitter is actually in the factory registry, and
 *   2. that clone's frozen `seller` is the agent's registered wallet or its NFT owner.
 *
 * The ABI below is a four-entry subset of the registry's, written for viem. The dashboard is
 * viem-only and deliberately does not depend on `@solarpunk/erc8004-adapter`, which is ethers and
 * pulls in bee-js.
 */
import { isAddress, getAddress, keccak256, parseAbiItem, toBytes } from 'viem';
import type { Address, PublicClient } from 'viem';
import { DEFAULT_LOG_CHUNK_BLOCKS, MAX_LOG_CHUNKS } from '../config/registry';

/** Must match AGENT_SPLITTER in erc8004-adapter/src/constants.ts. */
export const AGENT_SPLITTER_KEY = 'agent_splitter';

/** Agent Card services entry carrying the catalog feed owner (spec §4.1). */
const CATALOG_SERVICE_NAME = 'swarm-ai-catalog';

/**
 * Fixed protocol constant — `keccak256("swarm-ai-catalog.v1")`. Mirrors CATALOG_FEED_TOPIC in
 * swarm-catalog/src/feeds.ts. No chain, registry, or agent identity is encoded in it, so the
 * owner address alone locates a catalog.
 */
export const CATALOG_FEED_TOPIC = keccak256(toBytes('swarm-ai-catalog.v1'));

const METADATA_SET_EVENT = parseAbiItem(
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)',
);

const OWNER_OF = parseAbiItem('function ownerOf(uint256 tokenId) view returns (address)');
const AGENT_WALLET = parseAbiItem(
  'function getAgentWallet(uint256 agentId) view returns (address)',
);
const TOKEN_URI = parseAbiItem('function tokenURI(uint256 tokenId) view returns (string)');

export type LinkStatus =
  /** Clone's seller matches the agent's registered wallet or NFT owner. */
  | 'verified'
  /** Link points at a real clone, but its seller is neither the agent wallet nor the owner. */
  | 'unverified'
  /** More than one agent claims this clone — we refuse to pick a winner. */
  | 'disputed';

/** The subset of the ERC-8004 Agent Card this dashboard displays. */
export interface AgentCardInfo {
  name?: string;
  description?: string;
  /** Resolved http(s) URL the card was fetched from, for the "open card" affordance. */
  url: string;
  /**
   * Catalog feed owner from the card's `swarm-ai-catalog` service entry. Undefined when the
   * agent publishes no catalog — a seller can hold a splitter without listing anything.
   */
  catalogFeedOwner?: Address;
}

export interface AgentLink {
  agentId: bigint;
  splitter: Address;
  owner?: Address;
  /** The registry's EIP-712-verified wallet for this agent, when one is set. */
  agentWallet?: Address;
  /** On-chain tokenURI. May be an https gateway URL or a bzz:// reference. */
  agentURI?: string;
  /**
   * Populated by a second, best-effort pass. Undefined means the card has not been
   * fetched or could not be — never that the agent has no name.
   */
  card?: AgentCardInfo;
  status: LinkStatus;
}

export interface AgentLinkIndex {
  /** Keyed by lowercased clone address. */
  bySplitter: Map<string, AgentLink>;
  /** True when the log sweep was cut short, so absence of a link proves nothing. */
  partial: boolean;
}

export const EMPTY_LINK_INDEX: AgentLinkIndex = { bySplitter: new Map(), partial: false };

/** 20-byte metadata value -> address. Null for anything else; one bad claim must not break a sweep. */
function decodeAddress(value: `0x${string}`): Address | null {
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/**
 * Read every `agent_splitter` claim, newest wins per agent.
 *
 * Chunked because public nodes reject wide `eth_getLogs` ranges. A chunk that fails ends the
 * sweep and marks the result partial rather than throwing — a missing agent label is a much
 * smaller problem than a dashboard that will not load.
 */
async function readClaims(
  client: PublicClient,
  registry: Address,
  fromBlock: bigint,
  chunkBlocks: bigint,
): Promise<{ claims: Map<bigint, Address>; partial: boolean }> {
  const head = await client.getBlockNumber();
  // Latest claim per agent. Logs arrive in ascending block order, so later writes overwrite.
  const claims = new Map<bigint, Address>();

  let cursor = fromBlock;
  let chunks = 0;

  while (cursor <= head) {
    if (chunks >= MAX_LOG_CHUNKS) return { claims, partial: true };
    const to = cursor + chunkBlocks - 1n > head ? head : cursor + chunkBlocks - 1n;

    try {
      const logs = await client.getLogs({
        address: registry,
        event: METADATA_SET_EVENT,
        // viem hashes an indexed string arg to keccak256 for the topic filter.
        args: { indexedMetadataKey: AGENT_SPLITTER_KEY },
        fromBlock: cursor,
        toBlock: to,
      });

      for (const log of logs) {
        const agentId = log.args.agentId;
        const value = log.args.metadataValue;
        if (agentId === undefined || value === undefined) continue;
        const address = decodeAddress(value);
        // An agent can clear its link by writing garbage; drop the entry rather than keep a stale one.
        if (address) claims.set(agentId, address);
        else claims.delete(agentId);
      }
    } catch {
      return { claims, partial: true };
    }

    cursor = to + 1n;
    chunks += 1;
  }

  return { claims, partial: false };
}

/** `ownerOf` / `getAgentWallet` both revert for some agents; absence is normal, not an error. */
async function tryRead<T>(
  client: PublicClient,
  registry: Address,
  abi: typeof OWNER_OF | typeof AGENT_WALLET | typeof TOKEN_URI,
  agentId: bigint,
): Promise<T | undefined> {
  try {
    return (await client.readContract({
      address: registry,
      abi: [abi],
      functionName: abi.name,
      args: [agentId],
    })) as T;
  } catch {
    return undefined;
  }
}

export interface LoadAgentLinksParams {
  registry: Address;
  fromBlock: bigint;
  chunkBlocks?: bigint;
  /** Clone addresses the factory actually knows about. Claims outside this set are discarded. */
  knownSplitters: Address[];
}

/**
 * Build the splitter -> agent index, verified against the factory registry.
 *
 * `sellerOf` supplies each clone's frozen seller, which the caller already read via
 * `splitterTerms` — re-reading it here would be a wasted round trip.
 */
export async function loadAgentLinks(
  client: PublicClient,
  params: LoadAgentLinksParams,
  sellerOf: (splitter: Address) => Address | undefined,
): Promise<AgentLinkIndex> {
  const { registry, fromBlock, chunkBlocks = BigInt(DEFAULT_LOG_CHUNK_BLOCKS) } = params;

  const known = new Set(params.knownSplitters.map((s) => s.toLowerCase()));
  const { claims, partial } = await readClaims(client, registry, fromBlock, chunkBlocks);

  // Discard claims on clones this factory never created — an agent naming an arbitrary address
  // should not put a label on anything, and must not shadow a real link.
  const relevant = [...claims.entries()].filter(([, splitter]) =>
    known.has(splitter.toLowerCase()),
  );

  const resolved = await Promise.all(
    relevant.map(async ([agentId, splitter]) => {
      const [owner, agentWallet, agentURI] = await Promise.all([
        tryRead<Address>(client, registry, OWNER_OF, agentId),
        tryRead<Address>(client, registry, AGENT_WALLET, agentId),
        tryRead<string>(client, registry, TOKEN_URI, agentId),
      ]);
      return { agentId, splitter, owner, agentWallet, agentURI };
    }),
  );

  const bySplitter = new Map<string, AgentLink>();

  for (const entry of resolved) {
    const key = entry.splitter.toLowerCase();
    const seller = sellerOf(entry.splitter)?.toLowerCase();

    const matches =
      seller !== undefined &&
      (entry.agentWallet?.toLowerCase() === seller || entry.owner?.toLowerCase() === seller);

    const link: AgentLink = { ...entry, status: matches ? 'verified' : 'unverified' };

    const existing = bySplitter.get(key);
    if (existing && existing.agentId !== link.agentId) {
      // Two agents naming the same clone. Neither is trustworthy on its own, so say so rather
      // than silently showing whichever the log order happened to surface last.
      bySplitter.set(key, { ...link, status: 'disputed' });
      continue;
    }
    bySplitter.set(key, link);
  }

  return { bySplitter, partial };
}

/**
 * Turn a `tokenURI` into something fetchable.
 *
 * Agent Cards are addressed either as an https gateway URL (`<gateway>/feeds/<owner>/<topic>`)
 * or as a bare `bzz://<reference>`. Anything else is left alone rather than guessed at.
 */
export function resolveCardUrl(agentURI: string, gateway: string): string | undefined {
  if (agentURI.startsWith('https://') || agentURI.startsWith('http://')) return agentURI;
  if (agentURI.startsWith('bzz://')) {
    return `${gateway.replace(/\/+$/, '')}/bzz/${agentURI.slice('bzz://'.length)}`;
  }
  return undefined;
}

/**
 * The catalog feed owner is the `endpoint` of the card's `swarm-ai-catalog` service entry — a
 * bare EOA address, not a URL. It is a separate key from the Agent Card's own feed signer by
 * design, so it cannot be derived from the card's location.
 */
function readCatalogFeedOwner(card: Record<string, unknown>): Address | undefined {
  const services = card.services;
  if (!Array.isArray(services)) return undefined;

  for (const service of services) {
    if (typeof service !== 'object' || service === null) continue;
    const entry = service as Record<string, unknown>;
    if (entry.name !== CATALOG_SERVICE_NAME) continue;
    const endpoint = typeof entry.endpoint === 'string' ? entry.endpoint.trim() : '';
    if (isAddress(endpoint)) return getAddress(endpoint);
  }
  return undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Fetch one Agent Card. Resolves to undefined on any failure — the card lives on a Swarm
 * gateway this dashboard does not control, so a CORS rejection, a cold feed, or a slow
 * gateway are all expected outcomes, not errors. The badge falls back to the agent id.
 */
async function fetchCard(url: string, timeoutMs: number): Promise<AgentCardInfo | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const card = (await response.json()) as Record<string, unknown>;
    return {
      name: readString(card, 'name'),
      description: readString(card, 'description'),
      url,
      catalogFeedOwner: readCatalogFeedOwner(card),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Second pass over an already-rendered index, attaching each agent's card.
 *
 * Deliberately separate from `loadAgentLinks`: the on-chain half is fast and reliable, the
 * gateway half is neither, and the badge must not wait on it. Returns a new index so React
 * sees a changed reference.
 */
export async function enrichWithCards(
  index: AgentLinkIndex,
  gateway: string,
  timeoutMs = 8000,
): Promise<AgentLinkIndex> {
  const entries = [...index.bySplitter.entries()];

  // One fetch per distinct agent, not per row — the same agent can hold several clones.
  const urls = new Map<string, string>();
  for (const [, link] of entries) {
    if (!link.agentURI || link.card) continue;
    const url = resolveCardUrl(link.agentURI, gateway);
    if (url) urls.set(link.agentId.toString(), url);
  }
  if (urls.size === 0) return index;

  const fetched = new Map<string, AgentCardInfo>();
  await Promise.all(
    [...urls.entries()].map(async ([agentId, url]) => {
      const card = await fetchCard(url, timeoutMs);
      if (card) fetched.set(agentId, card);
    }),
  );
  if (fetched.size === 0) return index;

  const bySplitter = new Map<string, AgentLink>();
  for (const [key, link] of entries) {
    const card = link.card ?? fetched.get(link.agentId.toString());
    bySplitter.set(key, card ? { ...link, card } : link);
  }
  return { bySplitter, partial: index.partial };
}

/**
 * Where to send someone who wants to browse this agent's catalog.
 *
 * Prefers the catalogue-feed-browser, which renders items and handles the purchase flow. Falls
 * back to the raw Swarm feed, which at least resolves to the catalog's Mantaray root — readable,
 * if not friendly.
 */
export function catalogUrl(
  catalogFeedOwner: Address,
  browserBase: string | undefined,
  gateway: string,
): string {
  if (browserBase) {
    const base = browserBase.replace(/\/+$/, '');
    return `${base}/?owner=${catalogFeedOwner}`;
  }
  return `${gateway.replace(/\/+$/, '')}/feeds/${catalogFeedOwner}/${CATALOG_FEED_TOPIC.slice(2)}`;
}
