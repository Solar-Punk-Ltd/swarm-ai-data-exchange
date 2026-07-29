/**
 * MCP Tool: get_agent
 *
 * Resolves an ERC-8004 agent id to its on-chain Agent Card (read-only, RPC + Swarm
 * fetch only — no signer). When includeCatalog is true, also resolves the agent's
 * "swarm-ai-catalog" service entry to the catalog feed owner and enumerates the
 * catalog's items by traversing its Mantaray (mirrors the §13.2 reader list flow).
 */
import { Bee, MantarayNode } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import { createERC8004Client, downloadAgentCard } from '@solarpunk/erc8004-adapter';
import type { AgentCard } from '@solarpunk/erc8004-adapter';
import {
  readCatalogFeedRoot,
  CATALOG_MANIFEST_PATH,
  type Lifecycle,
  type PaymentRequirements,
} from '@solarpunk/swarm-catalog';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
  withTimeout,
} from '../../utils';
import { AgentCatalog, CatalogItemSummary, GetAgentArgs } from './models';

const CATALOG_SERVICE_NAME = 'swarm-ai-catalog';
const ITEM_JSONLD_PATH_RE = /^\/?items\/([^/]+)\/item\.jsonld$/;

// Fail-fast budgets so a slow/unreachable endpoint returns an error well under the MCP
// client's tool timeout instead of hanging.
const RPC_TIMEOUT_MS = 15_000;
const CARD_TIMEOUT_MS = 15_000;
const CATALOG_TIMEOUT_MS = 300_000;

// chainId per supported chain key — used to pin the provider's network so ethers skips
// the eth_chainId auto-detection round-trip on first call.
const CHAIN_IDS: Record<string, number> = {
  'base-sepolia': 84532,
  base: 8453,
  mainnet: 1,
};

function hasTarget(node: MantarayNode | null | undefined): node is MantarayNode {
  return !!node?.targetAddress && !node.targetAddress.every((b) => b === 0);
}

async function downloadJson(bee: Bee, target: Uint8Array): Promise<Record<string, unknown>> {
  const raw = await bee.downloadData(target);
  return JSON.parse(raw.toUtf8()) as Record<string, unknown>;
}

function contentTypeFromAtType(atType: unknown): string {
  const arr = Array.isArray(atType) ? atType.map(String) : [String(atType)];
  if (arr.includes('sc:ImageObject')) return 'image';
  if (arr.includes('sc:VideoObject')) return 'video';
  if (arr.includes('sc:AudioObject')) return 'audio';
  if (arr.includes('sc:TextDigitalDocument')) return 'text';
  if (arr.includes('cr:Dataset') || arr.includes('sc:Dataset')) return 'dataset';
  if (arr.includes('sc:CreativeWork')) return 'document';
  if (arr.includes('sc:MediaObject')) return 'bytes';
  return 'unknown';
}

function summarize(itemId: string, doc: Record<string, unknown>): CatalogItemSummary {
  return {
    itemId,
    name: typeof doc.name === 'string' ? doc.name : itemId,
    description: typeof doc.description === 'string' ? doc.description : '',
    contentType: contentTypeFromAtType(doc['@type']),
    lifecycle: (typeof doc.lifecycle === 'string' ? doc.lifecycle : 'active') as Lifecycle,
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    payment: Array.isArray(doc.payment) ? (doc.payment as PaymentRequirements[]) : [],
    hasSample: typeof doc.sample === 'object' && doc.sample !== null,
    dateModified: typeof doc.dateModified === 'string' ? doc.dateModified : undefined,
    dateAdded: typeof doc.dateAdded === 'string' ? doc.dateAdded : undefined,
  };
}

// Resolve catalog feed → Mantaray root → enumerate /items/{itemId}/item.jsonld leaves.
async function readCatalog(bee: Bee, owner: string): Promise<AgentCatalog> {
  const root = await readCatalogFeedRoot(bee, owner);
  const manifest = await MantarayNode.unmarshal(bee, root);
  await manifest.loadRecursively(bee);
  // Diagnostic: expose every path the Mantaray contains so callers can see whether the
  // catalog feed is pointing at an empty/wrong root vs. a filter mismatch. Kept in the
  // returned payload rather than logged so buyer-side telemetry can see it too.
  const allPaths = manifest.collect().map((n) => n.fullPathString);

  let name: string | undefined;
  let description: string | undefined;
  let license: string | undefined;
  const metaNode = manifest.find(CATALOG_MANIFEST_PATH);
  if (hasTarget(metaNode)) {
    const meta = await downloadJson(bee, metaNode.targetAddress);
    if (typeof meta.name === 'string') name = meta.name;
    if (typeof meta.description === 'string') description = meta.description;
    if (typeof meta.license === 'string') license = meta.license;
  }

  const leaves = manifest.collect().filter((n) => ITEM_JSONLD_PATH_RE.test(n.fullPathString));
  const items = (
    await Promise.all(
      leaves.map(async (node) => {
        if (!hasTarget(node)) return null;
        const itemId = ITEM_JSONLD_PATH_RE.exec(node.fullPathString)![1];
        const doc = await downloadJson(bee, node.targetAddress);
        return summarize(itemId, doc);
      }),
    )
  ).filter((s): s is CatalogItemSummary => s !== null);

  return { owner, root, name, description, license, items, allPaths };
}

// registrations[].agentId is a bigint at runtime — stringify so the result serializes cleanly.
function serializableCard(card: AgentCard): Record<string, unknown> {
  return {
    ...card,
    registrations: card.registrations?.map((r) => ({
      ...r,
      agentId: r.agentId.toString(),
    })),
  };
}

export async function getAgent(args: GetAgentArgs, bee: Bee): Promise<ToolResponse> {
  let agentIdBn: bigint;
  try {
    agentIdBn = BigInt(args.agentId);
  } catch {
    return getToolErrorResponse(`Invalid agentId: ${args.agentId} is not an integer.`);
  }

  const chainId = CHAIN_IDS[config.chain.chain];
  const provider = chainId
    ? new ethers.JsonRpcProvider(config.chain.rpcUrl, chainId, { staticNetwork: true })
    : new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc8004 = createERC8004Client({ provider, chain: config.chain.chain });

  let agentURI: string;
  let card: AgentCard;
  try {
    agentURI = await withTimeout(
      erc8004.identity.getAgentURI(agentIdBn),
      RPC_TIMEOUT_MS,
      `RPC tokenURI(${args.agentId}) on ${config.chain.chain}`,
    );
    card = await withTimeout(
      downloadAgentCard(agentURI),
      CARD_TIMEOUT_MS,
      `Agent Card fetch from ${agentURI}`,
    );
  } catch (err) {
    return getToolErrorResponse(`Failed to resolve agent ${args.agentId}: ${getErrorMessage(err)}`);
  }

  const result: Record<string, unknown> = {
    agentId: args.agentId,
    agentURI,
    agentCard: serializableCard(card),
  };

  if (args.includeCatalog) {
    const owner = card.services.find((s) => s.name === CATALOG_SERVICE_NAME)?.endpoint;
    if (!owner) {
      result.catalog = null;
      result.catalogNote = `Agent has no "${CATALOG_SERVICE_NAME}" service entry.`;
    } else {
      try {
        result.catalog = await withTimeout(
          readCatalog(bee, owner),
          CATALOG_TIMEOUT_MS,
          `Catalog read for owner ${owner}`,
        );
      } catch (err) {
        // Card advertises a catalog but the feed is unpublished/unreadable — report, don't fail.
        // Guarantee a non-empty error string so downstream callers don't misread the failure
        // as a "successful empty catalog" (some bee-js errors ship with an empty message).
        const errorMessage =
          getErrorMessage(err) || `Catalog read failed for owner ${owner} (${typeof err})`;
        result.catalog = {
          owner,
          items: [],
          error: errorMessage,
        } satisfies AgentCatalog;
      }
    }
  }

  return getResponseWithStructuredContent(result);
}
