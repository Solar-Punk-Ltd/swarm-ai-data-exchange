/**
 * Agent identity resolution — the seller side of ERC-8004 onboarding.
 *
 * Peer of `splitter.ts`: the shared domain layer that `register_agent` (and, in time,
 * `get_agent`) sits on top of. It owns everything the removed `create_agent` tool knew about
 * building and publishing an Agent Card, plus the verification chain that used to live
 * client-side in each Python agent's `bootstrap_identity.py`.
 *
 * ## The metadata index is a lookup, not a trust anchor
 *
 * `swarm_agent_id` is written by whoever mints an agent, about themselves. Anyone can write
 * anyone else's feed-owner address there, so a hit in the index proves nothing on its own.
 * Ownership is proved by two independent facts:
 *
 *   (a) the NFT's tokenURI resolves to a Swarm feed whose owner is our BEE_FEED_PK, and
 *   (c) `ownerOf(agentId)` is our PRIVATE_KEY signer.
 *
 * Together those mean we control both the card and the token. A third check —
 *
 *   (b) the Agent Card at that feed names the agentId back in `registrations[]`
 *
 * — is what the old Python chain used as its second half. But given (a) and (c), a failing (b)
 * is not evidence of a spoof: it is our own card, stale. That distinction is the whole reason
 * this module exists, see `classifyCandidate`.
 *
 * ## Discovery must not depend on a block window
 *
 * `findAgentsWithMetadata` defaults to scanning the last RECENT_BLOCK_COUNT (550_000) blocks,
 * about 13 days on Base Sepolia. A convergent tool that mints whenever discovery comes up
 * empty would therefore mint a duplicate NFT for any agent older than that — a worse bug than
 * the one it exists to fix. So the primary lookup is the Agent Card feed itself, whose URL is
 * fully deterministic given BEE_FEED_PK (constant topic, owner derived from the key). No chain
 * reads, no window. The event scan is only a fallback for the one case the card cannot answer.
 */
import { Bee } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import { getAddress } from 'viem';
import {
  AGENT_CARD_TOPIC,
  SWARM_AGENT_ID,
  SWARM_AI_CAPABLE,
  agentCardFeedUrl,
  createERC8004Client,
  generateAgentCard,
  parseAgentCard,
  serializeAgentCard,
  uploadAgentCard,
} from '@solarpunk/erc8004-adapter';
import type { AgentCard, ERC8004Client } from '@solarpunk/erc8004-adapter';
import config from './config';
import { getErrorMessage, withTimeout } from './utils';
import {
  CARD_FETCH_TIMEOUT_MS,
  CARD_UPLOAD_TIMEOUT_MS,
  RPC_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  TX_TIMEOUT_MS,
} from './constants';

// Fail-fast budgets, mirroring get_agent's. A bootstrap tool that hangs past the MCP client's
// timeout is indistinguishable from a mint failure — the one state we most need to avoid.
export interface IdentityContext {
  /** Lowercase 0x-prefixed address of the BEE_FEED_PK signer — the catalog/card feed owner. */
  feedOwner: string;
  /** Deterministic Agent Card feed URL for BEE_FEED_PK. This is the on-chain tokenURI. */
  agentURI: string;
  /** Checksummed address of the PRIVATE_KEY signer — must own the agent NFT. */
  signer: string;
  feedPk: string;
  privateKey: string;
}

/**
 * Resolve the identity context from env. Throws with an actionable message when a key is
 * missing — nothing has happened yet at that point, so failing hard is safe.
 */
export function identityContext(catalogFeedOwnerOverride?: string): IdentityContext {
  const privateKey = config.chain.walletPrivateKey;
  if (!privateKey) {
    throw new Error('Missing PRIVATE_KEY env var (wallet key for the NFT mint and metadata).');
  }
  const feedPk = config.bee.catalogFeedPrivateKey;
  if (!feedPk) {
    throw new Error('Missing BEE_FEED_PK env var (Swarm feed signer for the Agent Card).');
  }

  const derivedOwner = new ethers.Wallet(feedPk).address.toLowerCase();
  let feedOwner = derivedOwner;
  if (catalogFeedOwnerOverride) {
    try {
      feedOwner = getAddress(catalogFeedOwnerOverride).toLowerCase();
    } catch {
      throw new Error(`Invalid catalogFeedOwner: ${catalogFeedOwnerOverride}`);
    }
  }

  return {
    feedOwner,
    agentURI: agentCardFeedUrl(feedPk),
    signer: new ethers.Wallet(privateKey).address,
    feedPk,
    privateKey,
  };
}

/** An ethers-backed ERC-8004 client with a signer attached (writes enabled). */
export function writeClient(ctx: IdentityContext): ERC8004Client {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(ctx.privateKey, provider);
  return createERC8004Client({ provider, signer, chain: config.chain.chain });
}

export interface BuildCardParams {
  name: string;
  description: string;
  image?: string;
  version?: string;
  x402?: string;
  capabilities?: string | string[];
  catalogFeedOwner: string;
}

function toCapabilityList(input: BuildCardParams['capabilities']): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(',');
  return raw.map((c) => c.trim()).filter(Boolean);
}

/**
 * Build the Agent Card. Deterministic — no timestamps, no nonces — which is what makes
 * `cardsEqual` a sound drift check.
 */
export function buildAgentCard(params: BuildCardParams): AgentCard {
  const services = [
    ...(params.x402 ? [{ name: 'x402', endpoint: params.x402 }] : []),
    // The catalog service entry's "endpoint" is an EOA address, not a URL — get_agent reads
    // exactly this to find the catalog feed owner.
    { name: 'swarm-ai-catalog', endpoint: params.catalogFeedOwner },
  ];

  return generateAgentCard({
    name: params.name,
    description: params.description,
    version: params.version ?? '1.0.0',
    ...(params.image && { image: params.image }),
    services,
    x402Support: Boolean(params.x402),
    capabilities: toCapabilityList(params.capabilities),
    active: true,
  });
}

/** Content equality, ignoring key order irrelevance — both sides go through one serializer. */
export function cardsEqual(a: AgentCard, b: AgentCard): boolean {
  return serializeAgentCard(a) === serializeAgentCard(b);
}

export async function publishAgentCard(
  ctx: IdentityContext,
  card: AgentCard,
  postageBatchId?: string,
): Promise<string> {
  const result = await withTimeout(
    uploadAgentCard(card, AGENT_CARD_TOPIC, config.bee.endpoint, postageBatchId, ctx.feedPk),
    CARD_UPLOAD_TIMEOUT_MS,
    'Agent Card upload to Swarm',
  );
  return result.reference;
}

export interface FetchCardResult {
  /** Null when the feed has no card yet — a legitimate "not registered" answer. */
  card: AgentCard | null;
  /** Set only on a genuine transport failure, which must NOT be read as "not registered". */
  error?: string;
}

/**
 * Read our own Agent Card.
 *
 * Prefers the local Bee node over the gateway URL: BEE_API_URL is the node that wrote this
 * feed, so making the agent's own identity lookup depend on public gateway propagation would
 * be a needless failure mode. Falls back to the gateway when the local read misses.
 */
export async function fetchAgentCard(ctx: IdentityContext): Promise<FetchCardResult> {
  const topicHex = ctx.agentURI.split('/').pop() ?? '';
  let localError: string | undefined;

  try {
    const bee = new Bee(config.bee.endpoint);
    const reader = bee.makeFeedReader(`0x${topicHex}`, ctx.feedOwner);
    const payload = await withTimeout(
      reader.downloadPayload(),
      CARD_FETCH_TIMEOUT_MS,
      `Agent Card feed read from ${config.bee.endpoint}`,
    );
    return { card: parseAgentCard(payload.payload.toUtf8()) };
  } catch (err) {
    localError = getErrorMessage(err) || 'local feed read failed';
  }

  // Gateway fallback. A 404 here is the authoritative "no card has ever been published".
  try {
    const response = await withTimeout(
      fetch(ctx.agentURI),
      CARD_FETCH_TIMEOUT_MS,
      `Agent Card fetch from ${ctx.agentURI}`,
    );
    if (response.status === 404) return { card: null };
    if (!response.ok) {
      return {
        card: null,
        error: `local read failed (${localError}); gateway returned ${response.status} ${response.statusText}`,
      };
    }
    return { card: parseAgentCard(await response.text()) };
  } catch (err) {
    return {
      card: null,
      error: `local read failed (${localError}); gateway read failed (${getErrorMessage(err)})`,
    };
  }
}

/** Extract the feed-owner segment of a `<gateway>/feeds/<owner>/<topic>` URL. */
export function feedOwnerFromUri(agentURI: string): string | null {
  const marker = '/feeds/';
  const idx = agentURI.indexOf(marker);
  if (idx === -1) return null;
  const segment = agentURI.slice(idx + marker.length).split('/')[0];
  if (!segment) return null;
  return segment.startsWith('0x') ? segment.toLowerCase() : `0x${segment.toLowerCase()}`;
}

export type Verdict = 'verified' | 'repairable' | 'rejected';

export interface Candidate {
  agentId: string;
  agentURI: string;
  owner: string;
  verdict: Verdict;
  reason?: string;
  source: 'card' | 'scan';
}

/**
 * Classify one candidate NFT against our identity.
 *
 * Checks run cheapest-first. `repairable` is the load-bearing verdict: it means the token is
 * provably ours but our card does not name it — exactly the state a mint leaves behind when
 * the post-mint card write fails. Treating that as a rejection would mint a duplicate on the
 * next call, which is the bug this whole module exists to prevent.
 */
export async function classifyCandidate(
  erc8004: ERC8004Client,
  ctx: IdentityContext,
  agentId: bigint,
  card: AgentCard | null,
  source: 'card' | 'scan',
  knownOwner?: string,
): Promise<Candidate> {
  const id = agentId.toString();

  let owner = knownOwner ?? '';
  if (!owner) {
    owner = await withTimeout(
      erc8004.identity.getOwner(agentId),
      RPC_TIMEOUT_MS,
      `RPC ownerOf(${id})`,
    );
  }

  const base = { agentId: id, owner, source };

  if (getAddress(owner) !== getAddress(ctx.signer)) {
    return {
      ...base,
      agentURI: '',
      verdict: 'rejected',
      reason: `owned by ${owner}, not our signer ${ctx.signer}`,
    };
  }

  const agentURI = await withTimeout(
    erc8004.identity.getAgentURI(agentId),
    RPC_TIMEOUT_MS,
    `RPC tokenURI(${id})`,
  );
  const uriOwner = feedOwnerFromUri(agentURI);
  if (!uriOwner) {
    return {
      ...base,
      agentURI,
      verdict: 'rejected',
      reason: `tokenURI has no /feeds/<owner>/ segment (${agentURI})`,
    };
  }
  if (uriOwner !== ctx.feedOwner) {
    return {
      ...base,
      agentURI,
      verdict: 'rejected',
      reason: `tokenURI feed owner ${uriOwner} != our feed owner ${ctx.feedOwner}`,
    };
  }

  // Ours, proven. The card back-reference now only decides reuse vs. repair.
  const named = (card?.registrations ?? []).some((r) => r.agentId?.toString() === id);
  if (named) return { ...base, agentURI, verdict: 'verified' };

  return {
    ...base,
    agentURI,
    verdict: 'repairable',
    reason: 'Agent Card does not name this agentId in registrations[]',
  };
}

export interface DiscoveryResult {
  candidates: Candidate[];
  card: AgentCard | null;
  /** Set when a lookup *failed* as opposed to legitimately finding nothing. Suppresses mint. */
  cardError?: string;
  scanError?: string;
}

/**
 * Find every agent that might be ours, card-first.
 *
 * Layer 1 (the card feed) is exact and window-independent, and is the steady-state path.
 * Layer 2 (the MetadataSet scan) only runs when layer 1 yields nothing usable, because the
 * one case the card cannot answer is the repair state, where `registrations[]` is absent.
 * That failure is by nature recent, so the default block window covers it.
 */
export async function discoverCandidates(
  erc8004: ERC8004Client,
  ctx: IdentityContext,
  fromBlock?: number,
): Promise<DiscoveryResult> {
  const { card, error: cardError } = await fetchAgentCard(ctx);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const reg of card?.registrations ?? []) {
    if (reg.agentId === undefined || reg.agentId === null) continue;
    const id = reg.agentId.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      candidates.push(await classifyCandidate(erc8004, ctx, BigInt(id), card, 'card'));
    } catch (err) {
      candidates.push({
        agentId: id,
        agentURI: '',
        owner: '',
        verdict: 'rejected',
        reason: `could not classify: ${getErrorMessage(err)}`,
        source: 'card',
      });
    }
  }

  if (candidates.some((c) => c.verdict !== 'rejected')) {
    return { candidates, card, cardError };
  }

  // Fallback: the scan. Only reachable when the card named nothing usable.
  let scanError: string | undefined;
  try {
    const entries = await withTimeout(
      erc8004.identity.findAgentsWithMetadata(SWARM_AGENT_ID, fromBlock),
      SCAN_TIMEOUT_MS,
      `MetadataSet scan for ${SWARM_AGENT_ID}`,
    );
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const mine = entries.filter((e) => decoder.decode(e.rawValue) === ctx.feedOwner);

    // allSettled: ownerOf reverts for a burned token, and one dead entry must not block
    // bootstrap for an unrelated agent.
    const settled = await Promise.allSettled(
      mine
        .filter((e) => !seen.has(e.agentId.toString()))
        .map((e) => classifyCandidate(erc8004, ctx, e.agentId, card, 'scan')),
    );
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') candidates.push(outcome.value);
    }
  } catch (err) {
    scanError = getErrorMessage(err) || 'MetadataSet scan failed';
  }

  return { candidates, card, cardError, scanError };
}

export interface MintResult {
  agentId: bigint;
  txHash: string;
}

/**
 * Mint the NFT. The caller is responsible for having published the card first (the tokenURI
 * must exist before the mint) and for patching `registrations[]` afterwards — those are
 * deliberately separate steps so a failure in the second can never discard the agentId
 * produced by this one.
 */
export async function mintAgent(erc8004: ERC8004Client, ctx: IdentityContext): Promise<MintResult> {
  const metadata = [
    { metadataKey: SWARM_AI_CAPABLE, metadataValue: new Uint8Array([1]) },
    {
      metadataKey: SWARM_AGENT_ID,
      metadataValue: new TextEncoder().encode(ctx.feedOwner),
    },
  ];
  return withTimeout(
    erc8004.identity.register(ctx.agentURI, metadata),
    TX_TIMEOUT_MS,
    'ERC-8004 register() transaction',
  );
}

/** The registrations[] entry naming `agentId` on this registry. */
export function registrationEntry(erc8004: ERC8004Client, agentId: bigint) {
  return {
    agentId,
    agentRegistry: `eip155:${erc8004.identity.networkChainId}:${erc8004.identity.contractAddress}`,
  };
}

/**
 * Ensure `swarm_agent_id` is set. An agent minted without it is invisible to the fallback
 * scan forever, so a convergent tool should repair that. Costs gas, hence reported separately.
 */
export async function hasAgentIdMetadata(
  erc8004: ERC8004Client,
  ctx: IdentityContext,
  agentId: bigint,
): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const existing = await withTimeout(
    erc8004.identity.getMetadata(agentId, SWARM_AGENT_ID),
    RPC_TIMEOUT_MS,
    `RPC getMetadata(${agentId}, ${SWARM_AGENT_ID})`,
  );
  return Boolean(existing && existing.length > 0 && decoder.decode(existing) === ctx.feedOwner);
}

export async function ensureAgentIdMetadata(
  erc8004: ERC8004Client,
  ctx: IdentityContext,
  agentId: bigint,
): Promise<'present' | 'backfilled'> {
  if (await hasAgentIdMetadata(erc8004, ctx, agentId)) {
    return 'present';
  }
  await withTimeout(
    erc8004.identity.setMetadata(agentId, SWARM_AGENT_ID, new TextEncoder().encode(ctx.feedOwner)),
    TX_TIMEOUT_MS,
    `setMetadata(${SWARM_AGENT_ID})`,
  );
  return 'backfilled';
}
