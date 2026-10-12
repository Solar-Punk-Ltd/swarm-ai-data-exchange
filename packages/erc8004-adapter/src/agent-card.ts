import { Bee } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import type { AgentCard, AgentCardParams, AgentRegistration, SwarmUploadResult } from './types';
import {
  AGENT_CARD_TOPIC,
  AGENT_CARD_TYPE,
  DEFAULT_AGENT_IMAGE,
  DEFAULT_GATEWAY_URL,
} from './constants';
import config from './config';
import { getUploadPostageBatchId, hexToBytes, normaliseTopic } from './utils';

export function generateAgentCard(params: AgentCardParams): AgentCard {
  return {
    type: params.type ?? AGENT_CARD_TYPE,
    name: params.name,
    version: params.version,
    description: params.description,
    image: params.image ?? DEFAULT_AGENT_IMAGE,
    services: params.services,
    x402Support: params.x402Support ?? false,
    active: params.active ?? true,
    registrations: params.registrations ?? undefined,
    capabilities: params.capabilities ?? [],
    ...(params.supportedTrust !== undefined && { supportedTrust: params.supportedTrust }),
  };
}

// Alias matching the name used in ERC-8004.md examples
export const generateRegistrationFile = generateAgentCard;

const registryKey = (r: AgentRegistration): string => (r.agentRegistry ?? '').toLowerCase();

/**
 * `registrations[]` in a canonical order: by CAIP-10 registry (case-insensitive), then agentId.
 *
 * One Agent Card is shared by every registry an agent is minted on (one tokenURI, many chains),
 * so writers on different chains each touch the same list. A fixed order means two writers that
 * agree on the content also agree byte-for-byte, and a drift check never flip-flops on order.
 */
export function normaliseRegistrations(
  registrations: AgentRegistration[] | undefined,
): AgentRegistration[] | undefined {
  if (!registrations) return registrations;
  return [...registrations].sort((a, b) => {
    const ka = registryKey(a);
    const kb = registryKey(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    const ia = BigInt(a.agentId);
    const ib = BigInt(b.agentId);
    return ia === ib ? 0 : ia < ib ? -1 : 1;
  });
}

/**
 * Put `entry` into the card's `registrations[]`, replacing any entry for the same registry and
 * keeping every other registry's entry. Returns a new card; the input is not mutated.
 *
 * Keyed by `agentRegistry` (CAIP-10, `eip155:<chainId>:<registry>`), never by agentId alone:
 * the same registry contract can be deployed at the same address on several chains, so agentId
 * numbers collide across chains and only the pair identifies a registration.
 */
export function upsertRegistration(card: AgentCard, entry: AgentRegistration): AgentCard {
  const key = registryKey(entry);
  const others = (card.registrations ?? []).filter((r) => registryKey(r) !== key);
  return { ...card, registrations: normaliseRegistrations([...others, entry]) };
}

export function serializeAgentCard(card: AgentCard): string {
  return JSON.stringify(card, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function parseAgentCard(json: string): AgentCard {
  const data = JSON.parse(json) as Record<string, unknown>;

  if (data.type !== AGENT_CARD_TYPE) {
    throw new Error(`Invalid agent card: type MUST be ${AGENT_CARD_TYPE}`);
  }

  if (!data.name || !data.description || !data.services) {
    throw new Error('Invalid agent card: missing required fields (name, description, services)');
  }

  if (
    typeof data.x402Support !== 'boolean' ||
    typeof data.active !== 'boolean' ||
    (Boolean(data.registrations) && !Array.isArray(data.registrations))
  ) {
    throw new Error(
      'Invalid agent card: missing or invalid required fields (x402Support, active, registrations)',
    );
  }

  const card = data as unknown as AgentCard;

  if (!card.registrations) {
    return card;
  }

  // Transform agentId to BigInt at runtime
  for (const reg of card.registrations) {
    if (reg.agentId !== undefined && reg.agentId !== null) {
      reg.agentId = BigInt(reg.agentId);
    }
  }

  return card;
}

/**
 * Downloads and parses an AgentCard from a Swarm feed URL (the agentURI
 * stored on-chain). Always resolves to the latest version of the card.
 *
 * @param agentURI  The Swarm feed URL returned by uploadAgentCard, e.g.
 *                  "https://api.gateway.ethswarm.org/feeds/<owner>/<topic>".
 * @returns         The parsed AgentCard.
 */
export async function downloadAgentCard(agentURI: string): Promise<AgentCard> {
  const response = await fetch(agentURI);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch AgentCard from ${agentURI}: ${response.status} ${response.statusText}`,
    );
  }

  const json = await response.text();
  return parseAgentCard(json);
}

/**
 * The canonical Agent Card feed URL for a feed signing key.
 *
 * This is the value written on-chain as the ERC-8004 tokenURI. It is fully deterministic:
 * the topic is a constant and the owner is derived from the key, so an agent can re-derive
 * its own agentURI with no chain reads and no block-range scan. That is what makes
 * "find my existing agent" possible without an event window.
 *
 * `uploadAgentCard` returns this same value, and calls this helper to build it, so the
 * writer and the deriver cannot drift apart.
 */
export function agentCardFeedUrl(feedPrivateKey: string, topic = AGENT_CARD_TOPIC): string {
  const normalized = feedPrivateKey.startsWith('0x') ? feedPrivateKey : `0x${feedPrivateKey}`;
  // The owner segment is written without the 0x prefix and lowercased.
  const owner = new ethers.Wallet(normalized).address.slice(2).toLowerCase();
  return `${DEFAULT_GATEWAY_URL}/feeds/${owner}/${normaliseTopic(topic)}`;
}

/**
 * Uploads a serialised AgentCard to a Swarm feed and returns the content
 * reference and feed URL.
 *
 * Using a feed rather than plain bytes means the provider can update their
 * Agent Card in the future without changing the on-chain agentURI — the feed
 * URL always resolves to the latest version.
 *
 * @param card            The AgentCard to upload.
 * @param beeApiUrl       Base URL of the Bee node (e.g. "http://localhost:1633").
 * @param postageBatchId  A valid usable postage stamp batch ID (64-char hex).
 * @param feedPrivateKey  Hex private key used to sign feed updates (with or without 0x prefix).
 * @param topic           Feed topic. Defaults to "agent-card". Non-hex strings are SHA-256 hashed to 32 bytes.
 * @returns               Content reference, a direct bzz:// URL, and the feed URL for the latest version.
 */
export async function uploadAgentCard(
  card: AgentCard,
  topic = AGENT_CARD_TOPIC,
  beeApiUrl?: string,
  batchId?: string,
  privateKey?: string,
): Promise<SwarmUploadResult> {
  const bee = new Bee(beeApiUrl || config.bee.endpoint);
  const { postageBatchId, error } = await getUploadPostageBatchId(
    batchId || config.bee.postageBatchId,
    bee,
  );

  if (error !== null) {
    throw error;
  }

  const feedPrivateKey = privateKey || config.bee.feedPrivateKey;

  if (!feedPrivateKey) {
    throw new Error('feedPrivateKey required.');
  }

  if (!postageBatchId) {
    throw new Error('No available postage batch.');
  }

  const topicHex = normaliseTopic(topic);
  const topicBytes = hexToBytes(topicHex);
  const privateKeyBytes = hexToBytes(feedPrivateKey);

  const feedWriter = bee.makeFeedWriter(topicBytes, privateKeyBytes);
  const binaryData = Buffer.from(serializeAgentCard(card));
  const result = await feedWriter.uploadPayload(postageBatchId!, binaryData);

  const reference = result.reference.toString();

  return {
    reference,
    url: `bzz://${reference}`,
    feedUrl: agentCardFeedUrl(feedPrivateKey, topic),
  };
}
