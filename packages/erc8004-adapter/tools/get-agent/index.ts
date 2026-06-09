/**
 * Fetches a single ERC-8004 agent by ID.
 *
 * Read-only — no private key required, only an RPC endpoint (RPC_URL).
 *
 * Usage:
 *   pnpm run get-agent --agentId <id>
 *
 * Outputs (JSON):
 *   { agentId, agentURI, agentCard }
 */

import { ethers } from 'ethers';
import { createERC8004Client, config } from '../../src';
import { downloadAgentCard } from '../../src/agent-card';
import { agentId } from './args';

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc8004 = createERC8004Client({ provider, chain: config.chain.chain });

  const agentURI = await erc8004.identity.getAgentURI(BigInt(agentId));

  let agentCard = null;
  try {
    agentCard = await downloadAgentCard(agentURI);
  } catch (err) {
    console.warn(
      `Warning: could not fetch agent card for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Agent cards rehydrate registrations[].agentId as bigint — stringify them for output.
  console.log(
    JSON.stringify(
      { agentId, agentURI, agentCard },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  );
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
