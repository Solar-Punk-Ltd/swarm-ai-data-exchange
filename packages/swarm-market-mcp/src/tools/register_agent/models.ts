import type { Candidate } from '../../agent-identity';

export interface RegisterAgentArgs {
  name: string;
  description: string;
  image?: string;
  version?: string;
  x402?: string;
  capabilities?: string | string[];
  // Defaults to the BEE_FEED_PK address. Override only when the catalog feed signer differs
  // from the Agent Card feed signer.
  catalogFeedOwner?: string;
  // Splitter seller of record. Defaults to AGENT_PAYMENT_ADDRESS, then the PRIVATE_KEY wallet.
  seller?: string;
  postageBatchId?: string;
  // Re-publish the Agent Card when its content has drifted from these arguments.
  refreshCard?: boolean;
  // Explicit start block for the fallback MetadataSet scan on the primary chain.
  fromBlock?: number;
  // Per-chain start blocks for the fallback scan, keyed by CAIP-2. Wins over fromBlock.
  fromBlocks?: Record<string, number>;
  // Report what would happen without sending a transaction or writing to Swarm.
  dryRun?: boolean;
  // Skip splitter + link entirely (identity-only registration).
  skipSplitter?: boolean;
}

/**
 * Outcome of the identity step.
 *
 *   existing   — a verified NFT was already bound to this feed; no writes
 *   refreshed  — verified, but card content had drifted and was re-published
 *   repaired   — the NFT was provably ours but the card did not name it; card rewritten
 *   minted     — no candidate existed, so a new NFT was minted
 *   incomplete — minted, but the post-mint card write failed. agentId IS present.
 *   failed     — no agentId exists (mint failed, or discovery itself errored)
 */
export type IdentityStatus =
  | 'existing'
  | 'refreshed'
  | 'repaired'
  | 'minted'
  | 'incomplete'
  | 'failed'
  | 'would-mint'
  | 'would-repair'
  | 'would-refresh';

export type MetadataStatus = 'present' | 'backfilled' | 'missing' | 'failed' | 'would-backfill';

export type SplitterStatus =
  | 'existing'
  | 'deployed'
  | 'unconfigured'
  | 'failed'
  | 'skipped'
  | 'would-deploy';

export type LinkStatus =
  | 'linked'
  | 'already-linked'
  | 'repointed'
  | 'skipped'
  | 'failed'
  | 'would-link';

export interface RegisterAgentIdentity {
  status: IdentityStatus;
  agentId: string | null;
  /** Deterministic — known even when agentId is null. */
  agentURI: string;
  txHash?: string;
  /** Swarm content reference of the most recent card write. */
  cardReference?: string;
  /** The single boolean a caller should gate on. */
  verified: boolean;
  metadataStatus: MetadataStatus;
  metadataTxHash?: string;
  candidatesScanned: number;
  /** Retained even on success: length > 1 is the double-mint signal. */
  candidates: Candidate[];
  /** Discovery threw rather than returning empty; the mint was suppressed. */
  discoveryError?: string;
  error?: string;
}

export interface RegisterAgentSplitter {
  status: SplitterStatus;
  address: string | null;
  seller: string | null;
  factory: string | null;
  /** CAIP-2 rail the clone lives on. */
  chainId?: string;
  treasury?: string;
  taxBps?: number;
  txHash?: string;
  error?: string;
}

export interface RegisterAgentLink {
  status: LinkStatus;
  metadataKey: string;
  splitter: string | null;
  previousSplitter?: string;
  txHash?: string;
  reason?: string;
  error?: string;
}

/** One identity chain's outcome: its own agentId, card status and splitter link. */
export interface RegisterAgentChainIdentity {
  /** Adapter chain name, e.g. "celo-sepolia". */
  chain: string;
  /** CAIP-2, e.g. "eip155:11142220". */
  chainId: string;
  identity: RegisterAgentIdentity;
  link: RegisterAgentLink;
}

export interface RegisterAgentResult {
  feedOwner: string;
  signer: string;
  /** The primary identity chain (ERC8004_CHAIN). */
  chain: string;
  dryRun: boolean;
  /** The primary chain's identity; identities[] has every chain. */
  identity: RegisterAgentIdentity;
  /** The clone on the identity chain — the one `link` binds under agent_splitter. */
  splitter: RegisterAgentSplitter;
  /** One entry per configured payment rail (SPLITTER_FACTORY_ADDRESSES), identity rail first. */
  splitters: RegisterAgentSplitter[];
  /** The primary chain's link; identities[] has every chain. */
  link: RegisterAgentLink;
  /** One entry per ERC8004_CHAINS chain, primary first. */
  identities: RegisterAgentChainIdentity[];
  warnings: string[];
  message: string;
}
