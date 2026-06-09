/**
 * Discovers ERC-8004 agents with swarm_ai_capable metadata set to 1.
 *
 * Read-only — no private key required, only an RPC endpoint (RPC_URL).
 *
 * Usage:
 *   pnpm run discover-agents
 *
 * Outputs (JSON):
 *   [{ agentId, agentURI, agentCard }]
 */

import { ethers } from 'ethers';
import { createERC8004Client, config } from '../../src';
import { downloadAgentCard } from '../../src/agent-card';
import { SWARM_AI_CAPABLE } from '../../src/constants';

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc8004 = createERC8004Client({ provider, chain: config.chain.chain });

  console.log('Discovering swarm_ai_capable agents…');

  const allSwarmAIAgents = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);
  const capableAgents = allSwarmAIAgents.filter((e) => ethers.toBigInt(e.rawValue) === 1n);

  console.log(`Found ${capableAgents.length} capable agent(s). Fetching agent cards…\n`);

  const results = await Promise.all(
    capableAgents.map(async (agent) => {
      const agentId = agent.agentId.toString();
      const agentURI = agent.uri;

      let agentCard = null;
      try {
        agentCard = await downloadAgentCard(agentURI);
      } catch (err) {
        console.warn(
          `  Warning: could not fetch agent card for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return { agentId, agentURI, agentCard };
    }),
  );

  // Agent cards rehydrate registrations[].agentId as bigint — stringify them for output.
  console.log(JSON.stringify(results, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
