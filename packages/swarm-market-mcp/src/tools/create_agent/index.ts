/**
 * MCP Tool: create_agent
 *
 * Registers an ERC-8004 agent identity end-to-end: builds an Agent Card, uploads it to a
 * Swarm feed, mints the ERC-8004 NFT with the feed URL as its tokenURI, then re-uploads
 * the card with a populated registrations[] entry.
 *
 * Mirrors the `pnpm create-agent` CLI in @solarpunk/erc8004-adapter (tools/create-agent).
 *
 * All keys are read from env vars at server start (config.ts):
 *   - PRIVATE_KEY:    on-chain wallet for the NFT mint on Base Sepolia
 *   - BEE_FEED_PK:    Swarm feed signing key for the Agent Card upload
 *   - POSTAGE_BATCH_ID (optional): auto-discovered from the Bee node when absent
 */
import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  uploadAgentCard,
  AGENT_CARD_TOPIC,
  SWARM_AI_CAPABLE,
  SWARM_AGENT_ID,
} from '@solarpunk/erc8004-adapter';
import config from '../../config';
import {
  getErrorMessage,
  getResponseWithStructuredContent,
  getToolErrorResponse,
  ToolResponse,
} from '../../utils';
import { CreateAgentArgs, CreateAgentResult } from './models';

function toCapabilityList(input: CreateAgentArgs['capabilities']): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(',');
  return raw.map((c) => c.trim()).filter(Boolean);
}

export async function createAgent(args: CreateAgentArgs): Promise<ToolResponse> {
  const privateKey = config.chain.walletPrivateKey;
  if (!privateKey) {
    return getToolErrorResponse('Missing PRIVATE_KEY env var (wallet key for the NFT mint).');
  }

  const feedPk = config.bee.catalogFeedPrivateKey;
  if (!feedPk) {
    return getToolErrorResponse(
      'Missing BEE_FEED_PK env var (Swarm feed signer for the Agent Card).',
    );
  }

  const postageBatchId = args.postageBatchId ?? config.bee.postageBatchId;
  const beeApiUrl = config.bee.endpoint;

  // ── 1. Build the Agent Card ─────────────────────────────────────────────────
  const services = [
    ...(args.x402 ? [{ name: 'x402', endpoint: args.x402 }] : []),
    ...(args.catalogFeedOwner
      ? [{ name: 'swarm-ai-catalog', endpoint: args.catalogFeedOwner }]
      : []),
  ];

  const card = generateAgentCard({
    name: args.name,
    description: args.description,
    version: args.version ?? '1.0.0',
    ...(args.image && { image: args.image }),
    services,
    x402Support: Boolean(args.x402),
    capabilities: toCapabilityList(args.capabilities),
    active: true,
  });

  // ── 2. Upload Agent Card to Swarm ───────────────────────────────────────────
  let agentURI: string;
  try {
    const upload = await uploadAgentCard(card, AGENT_CARD_TOPIC, beeApiUrl, postageBatchId, feedPk);
    agentURI = upload.feedUrl;
  } catch (err) {
    return getToolErrorResponse(`Failed to upload Agent Card to Swarm: ${getErrorMessage(err)}`);
  }

  // ── 3. Register on-chain ───────────────────────────────────────────────────
  let agentId: bigint;
  let txHash: string;
  try {
    const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const erc8004 = createERC8004Client({ provider, signer, chain: config.chain.chain });

    // Always seed SWARM_AI_CAPABLE. If catalogFeedOwner is provided, index the agent
    // under SWARM_AGENT_ID = <lowercased owner> so find_agents_by_metadata can locate
    // it later on startup without any client-side knowledge of this key.
    const metadata = [{ metadataKey: SWARM_AI_CAPABLE, metadataValue: new Uint8Array([1]) }];
    if (args.catalogFeedOwner) {
      metadata.push({
        metadataKey: SWARM_AGENT_ID,
        metadataValue: new TextEncoder().encode(args.catalogFeedOwner.toLowerCase()),
      });
    }
    const result = await erc8004.identity.register(agentURI, metadata);
    agentId = result.agentId;
    txHash = result.txHash;

    // ── 4. Write registrations[] back into the card and re-upload ───────────
    card.registrations = [
      {
        agentId,
        agentRegistry: `eip155:${erc8004.identity.networkChainId}:${erc8004.identity.contractAddress}`,
      },
    ];
    await uploadAgentCard(card, AGENT_CARD_TOPIC, beeApiUrl, postageBatchId, feedPk);
  } catch (err) {
    return getToolErrorResponse(`Failed to register agent on-chain: ${getErrorMessage(err)}`);
  }

  const response: CreateAgentResult = {
    agentId: agentId.toString(),
    txHash,
    agentURI,
    message: `Agent registered successfully on ${config.chain.chain} with token id ${agentId.toString()}.`,
  };
  return getResponseWithStructuredContent(response);
}
