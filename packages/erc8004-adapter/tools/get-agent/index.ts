/**
 * CLI script to fetch a single ERC-8004 agent by ID.
 *
 * Usage:
 *   tsx tools/get-agent/index.ts \
 *     --agentId <id> \
 *     [--privateKey "0x..."]
 *
 * Optional flags fall back to env vars / erc8004-adapter config:
 *   --privateKey → PRIVATE_KEY
 *
 * Outputs (JSON):
 *   { agentId, agentURI, agentCard }
 */

import { ethers } from 'ethers';
import { createERC8004Client, config } from '../../src';
import { downloadAgentCard } from '../../src/agent-card';
import { agentId, privateKey } from './args';

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
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
