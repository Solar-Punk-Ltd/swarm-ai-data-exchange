/**
 * Generates, uploads, and registers an ERC-8004 agent identity.
 *
 * Usage:
 *   pnpm run create-agent \
 *     --name "My Agent" \
 *     --description "What it does" \
 *     [--image "https://example.com/avatar.png"] \
 *     [--version "1.0.0"] \
 *     [--x402 "https://provider.example.com/data"] \
 *     [--catalogFeedOwner "0xabcd...1234"] \
 *     [--capabilities "cap1,cap2,cap3"] \
 *     [--privateKey "0x..."] \
 *     [--feedPrivateKey "0x..."] \
 *     [--postageBatchId "abc123..."] \
 *     [--beeApiUrl "http://localhost:1633"]
 *
 * Optional flags fall back to env vars:
 *   --privateKey     → PRIVATE_KEY
 *   --feedPrivateKey → BEE_FEED_PK
 *   --postageBatchId → BEE_POSTAGE_STAMP
 *   --beeApiUrl      → BEE_API_URL (default: http://localhost:1633)
 *
 * Outputs (JSON):
 *   { agentId, txHash, agentURI }
 */

import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  config,
  agentCardFeedUrl,
  downloadAgentCard,
  uploadAgentCard,
  upsertRegistration,
} from '../../src';
import type { AgentRegistration } from '../../src';
import { AGENT_CARD_TOPIC, SWARM_AI_CAPABLE } from '../../src/constants';
import {
  name,
  description,
  version,
  image,
  x402,
  catalogFeedOwner,
  capabilities,
  beeApiUrl,
  privateKey,
  feedPk,
  batchId,
} from './args';

async function main() {
  // ── 1. Generate agent card ─────────────────────────────────────────────────

  const services = [
    ...(x402 ? [{ name: 'x402', endpoint: x402 }] : []),
    ...(catalogFeedOwner ? [{ name: 'swarm-ai-catalog', endpoint: catalogFeedOwner }] : []),
  ];

  const card = generateAgentCard({
    name,
    description,
    version,
    ...(image && { image }),
    services,
    x402Support: Boolean(x402),
    capabilities,
    active: true,
  });

  console.log('\n[1/3] Agent Card');
  console.log(serializeAgentCard(card));

  // ── 2. Upload agent card to Swarm ─────────────────────────────────────────

  console.log('\n[2/3] Uploading to Swarm…');

  // One card is shared by every registry this agent is minted on, so carry forward whatever
  // registrations the feed already holds (e.g. a Base entry when now registering on Celo).
  // Read BEFORE the upload below, which would otherwise replace them.
  let existing: AgentRegistration[] = [];
  try {
    existing = (await downloadAgentCard(agentCardFeedUrl(feedPk))).registrations ?? [];
  } catch {
    // No prior card (or the gateway has not caught up): nothing to preserve.
  }
  if (existing.length > 0) card.registrations = existing;

  const { feedUrl: agentURI } = await uploadAgentCard(
    card,
    AGENT_CARD_TOPIC,
    beeApiUrl,
    batchId,
    feedPk,
  );

  console.log('  AgentURI: ', agentURI);

  // ── 3. Register on-chain ───────────────────────────────────────────────────

  console.log('\n[3/3] Registering on-chain…');

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const erc8004 = createERC8004Client({ provider, signer, chain: config.chain.chain });

  const { agentId, txHash } = await erc8004.identity.register(agentURI, [
    { metadataKey: SWARM_AI_CAPABLE, metadataValue: new Uint8Array([1]) },
  ]);

  // ── 4. Write registrations[] back to the card ──────────────────────────────

  console.log('\n[4/4] Updating Agent Card with registration…');

  // Merge this registration in rather than overwriting, so the other chains' entries survive.
  const merged = upsertRegistration(
    { ...card, registrations: existing },
    {
      agentId,
      agentRegistry: `eip155:${erc8004.identity.networkChainId}:${erc8004.identity.contractAddress}`,
    },
  );

  await uploadAgentCard(merged, AGENT_CARD_TOPIC, beeApiUrl, batchId, feedPk);

  // ── Result ─────────────────────────────────────────────────────────────────

  const result = { agentId: agentId.toString(), txHash, agentURI };

  console.log('\n✓ Agent registered successfully');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
