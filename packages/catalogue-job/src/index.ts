import 'dotenv/config';
import cron from 'node-cron';
import { Bee } from '@ethersphere/bee-js';
import { ethers } from 'ethers';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import crypto from 'crypto';
import { config as adapterConfig } from '@solarpunk/erc8004-adapter';
import type { AgentCard } from '@solarpunk/erc8004-adapter';

const DEFAULT_GATEWAY_URL = 'https://api.gateway.ethswarm.org';

const execAsync = promisify(exec);

function normaliseTopic(topic: string): string {
  const stripped = topic.startsWith('0x') ? topic.slice(2) : topic;
  if (/^[0-9a-fA-F]{64}$/.test(stripped)) return stripped;
  return crypto.createHash('sha256').update(topic).digest('hex');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

interface DiscoveredAgent {
  agentId: string;
  agentURI: string;
  agentCard: AgentCard | null;
}

// Runs `pnpm discover-agents` inside the erc8004-adapter package and parses
// the JSON array it writes to stdout.
async function discoverAgents(): Promise<DiscoveredAgent[]> {
  const adapterDir = path.resolve(__dirname, '../../erc8004-adapter');
  const { stdout, stderr } = await execAsync('pnpm discover-agents', { cwd: adapterDir });

  if (stderr.trim()) {
    console.warn('discover-agents warnings:\n', stderr.trim());
  }

  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) {
    throw new Error('No JSON array found in discover-agents output');
  }

  return JSON.parse(stdout.slice(jsonStart)) as DiscoveredAgent[];
}

// ── Validate required env vars at startup ─────────────────────────────────────

const feedPrivateKey = process.env.BEE_FEED_PK ?? adapterConfig.bee.feedPrivateKey;
const postageBatchId = process.env.BEE_POSTAGE_STAMP ?? adapterConfig.bee.postageBatchId;
const catalogueTopic = process.env.CATALOGUE;

if (!feedPrivateKey) throw new Error('BEE_FEED_PK is required');
if (!postageBatchId) throw new Error('BEE_POSTAGE_STAMP is required');
if (!catalogueTopic) throw new Error('CATALOGUE is required');

// Re-bind as string after guards so closures see the narrowed type
const validFeedPrivateKey: string = feedPrivateKey;
const validPostageBatchId: string = postageBatchId;
const validCatalogueTopic: string = catalogueTopic;

const beeApiUrl = process.env.BEE_API_URL ?? adapterConfig.bee.endpoint;
const bee = new Bee(beeApiUrl);

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogueEntry {
  agentId: string;
  catalogue: unknown;
}

// Finds the Swarm service in an agent card and fetches the JSON at its endpoint.
async function fetchSwarmCatalogue(agentCard: AgentCard): Promise<unknown> {
  const swarmService = agentCard.services.find((s) => s.name.toLowerCase() === 'swarm');
  if (!swarmService) {
    throw new Error('No Swarm service found in agent card services');
  }

  const response = await fetch(swarmService.endpoint);

  if (!response.ok) {
    return {};
  }
  return response.json();
}

// ── Job ───────────────────────────────────────────────────────────────────────

async function runCatalogueJob(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Running catalogue job…`);

  try {
    const agents = await discoverAgents();

    console.log(`Discovered ${agents.length} agent(s). Fetching Swarm catalogues…`);

    const entries: CatalogueEntry[] = await Promise.all(
      agents.map(async ({ agentId, agentCard }) => {
        let catalogue: unknown = null;
        if (agentCard) {
          try {
            catalogue = await fetchSwarmCatalogue(agentCard);
          } catch (err) {
            console.warn(
              `  Warning: could not fetch Swarm catalogue for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return { agentId, catalogue };
      }),
    );

    const topicHex = normaliseTopic(validCatalogueTopic);
    const topicBytes = hexToBytes(topicHex);
    const privateKeyBytes = hexToBytes(validFeedPrivateKey);
    const feedWriter = bee.makeFeedWriter(topicBytes, privateKeyBytes);
    const feedResult = await feedWriter.uploadPayload(
      validPostageBatchId,
      Buffer.from(JSON.stringify(entries)),
    );
    // Derive the feed owner address from the private key
    const normalized = validFeedPrivateKey.startsWith('0x')
      ? validFeedPrivateKey
      : `0x${validFeedPrivateKey}`;
    const owner = new ethers.Wallet(normalized).address.slice(2).toLowerCase();

    console.log(
      `
        [${new Date().toISOString()}] Catalogue uploaded (${entries.length} agent(s)).
        Reference: ${feedResult.reference.toString()}
        Feed URL: ${DEFAULT_GATEWAY_URL}/feeds/${owner}/${topicHex}
      `,
    );
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Catalogue job failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

console.log(`Starting catalogue job service (topic: ${validCatalogueTopic})…`);
runCatalogueJob();
cron.schedule('*/5 * * * *', runCatalogueJob);
console.log('Catalogue job scheduled every 5 minutes.');
