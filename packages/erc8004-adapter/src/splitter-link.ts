/**
 * The agent <-> RevenueSplitter binding, stored as Identity Registry metadata.
 *
 * Why here and not in the clone: `SplitterFactory.createSplitter` is permissionless, so an
 * agentId passed to the factory would be an unauthenticated claim anyone could make about anyone.
 * The registry already gates `setMetadata` on NFT ownership, so writing the link there is
 * authenticated for free. And clone terms are frozen at `initialize` while agent NFT ownership can
 * transfer — a binding baked into the clone would eventually be wrong with no way to fix it.
 *
 * `MetadataSet` indexes the metadata key, which is what makes the reverse direction
 * (splitter -> agent) a single log query rather than a crawl over every Agent Card.
 */
import { getAddress, hexlify, isAddress } from 'ethers';
import { AGENT_SPLITTER } from './constants';
import type { IdentityModule } from './modules/identity';

/** Address -> the 20 raw bytes stored on-chain. */
export function encodeSplitterMetadata(splitter: string): Uint8Array {
  if (!isAddress(splitter)) {
    throw new Error(`Not a valid splitter address: ${splitter}`);
  }
  const hex = getAddress(splitter).slice(2);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Raw metadata bytes -> checksummed address, or null when unset or malformed.
 *
 * Returns null rather than throwing: an agent can write arbitrary bytes under this key, and one
 * bad entry must not break an index sweep over every agent.
 */
export function decodeSplitterMetadata(value: Uint8Array | undefined): string | null {
  if (!value || value.length !== 20) return null;
  const hex = hexlify(value);
  return isAddress(hex) ? getAddress(hex) : null;
}

/**
 * Bind `agentId` to its splitter clone. Sends a transaction, and the registry requires the caller
 * to own the agent NFT.
 *
 * Idempotent in effect but not in cost — re-linking overwrites, which is the point: when an agent
 * moves to a new clone, or the NFT changes hands, the link can be corrected.
 */
export async function setAgentSplitter(
  identity: IdentityModule,
  agentId: bigint,
  splitter: string,
): Promise<string> {
  return identity.setMetadata(agentId, AGENT_SPLITTER, encodeSplitterMetadata(splitter));
}

/** The splitter an agent claims, or null when it has not linked one. */
export async function getAgentSplitter(
  identity: IdentityModule,
  agentId: bigint,
): Promise<string | null> {
  const raw = await identity.getMetadata(agentId, AGENT_SPLITTER);
  return decodeSplitterMetadata(raw);
}

export interface AgentSplitterLink {
  agentId: bigint;
  /** The address the agent claims. Unverified — see the module note. */
  splitter: string;
}

/**
 * Every agent that has linked a splitter, deduplicated to each agent's latest value.
 *
 * Pass `fromBlock` — it defaults to `RECENT_BLOCK_COUNT` blocks back, which is a partial view. Use
 * the registry deploy block for a complete index.
 */
export async function findAgentSplitters(
  identity: IdentityModule,
  fromBlock?: number,
  toBlock?: number,
): Promise<AgentSplitterLink[]> {
  const entries = await identity.findAgentsWithMetadata(AGENT_SPLITTER, fromBlock, toBlock);
  const links: AgentSplitterLink[] = [];
  for (const entry of entries) {
    const splitter = decodeSplitterMetadata(entry.rawValue);
    // Skip malformed claims rather than failing the sweep.
    if (splitter) links.push({ agentId: entry.agentId, splitter });
  }
  return links;
}
