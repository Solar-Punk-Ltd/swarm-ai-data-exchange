/**
 * CLI script to generate, upload, and register an ERC-8004 agent identity.
 *
 * Usage:
 *   tsx tools/create-agent/index.ts \
 *     --name "My Agent" \
 *     --description "What it does" \
 *     [--image "https://example.com/avatar.png"] \
 *     [--version "1.0.0"] \
 *     [--x402 "https://provider.example.com/data"] \
 *     [--swarm "https://swarm.example.com"] \
 *     [--capabilities "cap1,cap2,cap3"] \
 *     [--privateKey "0x..."] \
 *     [--feedPrivateKey "0x..."] \
 *     [--postageBatchId "abc123..."] \
 *     [--beeApiUrl "http://localhost:1633"]
 *
 * Optional flags fall back to env vars / erc8004-adapter config:
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
  uploadAgentCard,
} from '../../src';
import { AGENT_CARD_TOPIC, SWARM_AI_CAPABLE } from '../../src/constants';
import {
  name,
  description,
  version,
  image,
  x402,
  swarm,
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
    ...(swarm ? [{ name: 'swarm', endpoint: swarm }] : []),
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

  // ── Result ─────────────────────────────────────────────────────────────────

  const result = { agentId: agentId.toString(), txHash, agentURI };

  console.log('\n✓ Agent registered successfully');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
