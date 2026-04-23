/**
 * CLI script to fetch a single ERC-8004 agent by ID.
 *
 * Usage:
 *   tsx scripts/get-agent.ts \
 *     --agentId <id> \
 *     [--privateKey "0x..."]
 *
 * Optional flags fall back to env vars / erc8004-adapter config:
 *   --privateKey → PRIVATE_KEY
 *
 * Outputs (JSON):
 *   { agentId, agentURI, agentCard }
 */

import { parseArgs } from 'util';
import { ethers } from 'ethers';
import { createERC8004Client, config } from '../src';
import { downloadAgentCard } from '../src/agent-card';

// ── Argument parsing ──────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    agentId: { type: 'string' },
    privateKey: { type: 'string' },
  },
  strict: true,
});

// ── Validate required args ────────────────────────────────────────────────────

if (!args.agentId) {
  console.error('Error: --agentId is required');
  process.exit(1);
}

// ── Resolve config (CLI flags > env vars / adapter config) ────────────────────

const privateKey = args.privateKey ?? config.chain.privateKey;

if (!privateKey) {
  console.error('Error: --privateKey is required (or set PRIVATE_KEY env var)');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const agentId = args.agentId!;

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(privateKey!, provider);
  const erc8004 = createERC8004Client({ provider, signer, chain: config.chain.chain });

  const agentURI = await erc8004.identity.getAgentURI(BigInt(agentId));

  let agentCard = null;
  try {
    agentCard = await downloadAgentCard(agentURI);
  } catch (err) {
    console.warn(
      `Warning: could not fetch agent card for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(JSON.stringify({ agentId, agentURI, agentCard }, null, 2));
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
