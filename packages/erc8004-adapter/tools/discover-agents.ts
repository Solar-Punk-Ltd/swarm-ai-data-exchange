/**
 * CLI script to discover ERC-8004 agents with swarm_ai_capable metadata set to 1.
 *
 * Usage:
 *   tsx scripts/discover-agents.ts \
 *     [--privateKey "0x..."]
 *
 * Optional flags fall back to env vars / erc8004-adapter config:
 *   --privateKey → PRIVATE_KEY
 *
 * Outputs (JSON):
 *   [{ agentId, agentURI, agentCard }]
 */

import { parseArgs } from 'util';
import { ethers } from 'ethers';
import { createERC8004Client, config } from '../src';
import { downloadAgentCard } from '../src/agent-card';
import { SWARM_AI_CAPABLE } from '../src/constants';
import { resolvePrivateKey } from './utils/validation';

// ── Argument parsing ──────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    privateKey: { type: 'string' },
  },
  strict: true,
});

// ── Resolve config (CLI flags > env vars / adapter config) ────────────────────

const privateKey = resolvePrivateKey(args.privateKey);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const erc8004 = createERC8004Client({ provider, signer, chain: config.chain.chain });

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

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
