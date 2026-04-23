/**
 * CLI script to generate, upload, and register an ERC-8004 agent identity.
 *
 * Usage:
 *   tsx scripts/create-agent.ts \
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

import { parseArgs } from 'util';
import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  config,
  uploadAgentCard,
} from '../src';
import { AGENT_CARD_TOPIC, SWARM_AI_CAPABLE } from '../src/constants';

// ── Argument parsing ──────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    description: { type: 'string' },
    image: { type: 'string' },
    version: { type: 'string' },
    x402: { type: 'string' },
    swarm: { type: 'string' },
    capabilities: { type: 'string' },
    privateKey: { type: 'string' },
    feedPrivateKey: { type: 'string' },
    postageBatchId: { type: 'string' },
    beeApiUrl: { type: 'string' },
  },
  strict: true,
});

function requireArg(value: string | undefined, flag: string): string {
  if (!value?.trim()) {
    console.error(`Error: --${flag} is required`);
    process.exit(1);
  }
  return value.trim();
}

// ── Resolve config (CLI flags > env vars / adapter config) ────────────────────

const name = requireArg(args.name, 'name');
const description = requireArg(args.description, 'description');
const version = args.version ?? '1.0.0';
const beeApiUrl = args.beeApiUrl ?? config.bee.endpoint;
const privateKey = args.privateKey ?? config.chain.privateKey;
const feedPk = args.feedPrivateKey ?? config.bee.feedPrivateKey;
const batchId = args.postageBatchId ?? config.bee.postageBatchId;

if (!privateKey) {
  console.error('Error: --privateKey is required (or set PRIVATE_KEY env var)');
  process.exit(1);
}

if (!feedPk) {
  console.error('Error: --feedPrivateKey is required (or set BEE_FEED_PK env var)');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Generate agent card ─────────────────────────────────────────────────

  const services = [];
  if (args.x402?.trim()) services.push({ name: 'x402', endpoint: args.x402.trim() });
  if (args.swarm?.trim()) services.push({ name: 'swarm', endpoint: args.swarm.trim() });

  const capabilities = args.capabilities
    ? args.capabilities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  const card = generateAgentCard({
    name,
    description,
    version,
    ...(args.image?.trim() && { image: args.image.trim() }),
    services,
    x402Support: Boolean(args.x402?.trim()),
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
    privateKey,
  );

  console.log('  AgentURI: ', agentURI);

  // ── 3. Register on-chain ───────────────────────────────────────────────────

  console.log('\n[3/3] Registering on-chain…');

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(privateKey!, provider);
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
