import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  parseAgentCard,
  uploadAgentCard,
  config,
} from '..';
import { SWARM_AI_CAPABLE } from '../constants';

if (!config.chain.privateKey) {
  console.error('PRIVATE_KEY is not set');
  process.exit(1);
}

function log(label: string, value?: unknown) {
  console.log(`\n[${label}]`, value !== undefined ? value : '');
}

async function main() {
  // ── Setup ──────────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const signer = new ethers.Wallet(config.chain.privateKey!, provider);
  const address = await signer.getAddress();
  const balance = await provider.getBalance(address);

  log('Provider wallet', address);
  log('Balance', `${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error(
      '\nWallet has no ETH. Get testnet funds from https://faucet.quicknode.com/base/sepolia',
    );
    process.exit(1);
  }

  const erc8004 = createERC8004Client({ provider, signer, chain: config.chain.chain });

  // ── 1. Generate Agent Card ─────────────────────────────────────────────────
  log('Step 1: Generate Agent Card');

  const card = generateAgentCard({
    name: 'Test Data Provider',
    description: 'Demo agent for Swarm Data Exchange POC testing',
    version: '1.0.0',
    services: [
      {
        name: 'x402',
        endpoint: 'https://provider.example.com/data',
      },
      {
        // Catalog discovery entry point — endpoint is the catalog feed owner address (§4.1).
        // Demo uses the provider EOA; a real publisher would point this at its catalog feed signer.
        name: 'swarm-ai-catalog',
        endpoint: address,
      },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ['reputation'],
    capabilities: ['trading', 'image_generation'],
  });

  log('Agent Card', serializeAgentCard(card));

  // Round-trip parse check
  const reparsed = parseAgentCard(serializeAgentCard(card));
  console.assert(reparsed.name === card.name, 'Agent card round-trip failed');
  log('Agent Card round-trip', 'OK');

  // ── 2. Upload Agent Card to Swarm ─────────────────────────────────────────
  log('Step 2: Upload Agent Card to Swarm');

  let agentURI: string;
  if (config.bee.feedPrivateKey) {
    console.log('  Uploading to Swarm feed...');
    const uploaded = await uploadAgentCard(card);
    log('Swarm reference', uploaded.reference);
    log('Feed URL', uploaded.feedUrl);
    agentURI = uploaded.feedUrl;
  } else {
    agentURI = `bzz://placeholder-${Date.now()}`;
    console.log('  Skipped — BEE_FEED_PK not set. Using placeholder URI.');
    console.log('  Set BEE_FEED_PK (and optionally BEE_POSTAGE_STAMP, BEE_API_URL) to upload.');
  }

  // ── 3. Register Identity ───────────────────────────────────────────────────
  log('Step 3: Register on-chain (Identity Registry)');
  console.log('  Sending transaction...');
  const { agentId, txHash } = await erc8004.identity.register(agentURI, [
    { metadataKey: SWARM_AI_CAPABLE, metadataValue: new Uint8Array([1]) },
  ]);

  log('Registered agentId', agentId.toString());
  log('Transaction', txHash);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Verify on-chain
  const onChainURI = await erc8004.identity.getAgentURI(agentId);
  const owner = await erc8004.identity.getOwner(agentId);
  log('On-chain URI', onChainURI);
  log('On-chain owner', owner);

  console.assert(onChainURI === agentURI, 'URI mismatch after registration');
  console.assert(
    owner.toLowerCase() === address.toLowerCase(),
    'Owner mismatch after registration',
  );

  await erc8004.identity.setMetadata(agentId, 'TEST_METADATA', new Uint8Array([1]));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const testMetadataValue = await erc8004.identity.getMetadata(agentId, 'TEST_METADATA');
  log('Test metadata value: ', testMetadataValue);

  // ── 3b. Write registrations[] back into the Agent Card ─────────────────────
  // The card is the single source of truth for cross-registry identity (ERC-8004 §2).
  // agentRegistry is CAIP-10: eip155:<chainId>:<contractAddress>, derived from the client.
  log('Step 3b: Populate registrations[] and re-upload card');

  card.registrations = [
    {
      agentId,
      agentRegistry: `eip155:${erc8004.identity.networkChainId}:${erc8004.identity.contractAddress}`,
    },
  ];
  log('Updated Agent Card', serializeAgentCard(card));

  if (config.bee.feedPrivateKey) {
    await uploadAgentCard(card);
    log('Re-uploaded card with registrations[]', 'OK');
  } else {
    console.log('  Skipped re-upload — BEE_FEED_PK not set.');
  }

  // ── Query agents with swarm_ai_capable = 1 ──────────────────────────────────
  log('Query: agents with swarm_ai_capable metadata');

  const allSwarmAIAgents = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);
  const capableAgents = allSwarmAIAgents.filter((e) => ethers.toBigInt(e.rawValue) === 1n);

  log('swarm_ai_capable agents found', capableAgents.length);
  log(
    'Agent cards',
    capableAgents.map((a) => ({ agentId: a.agentId.toString(), uri: a.uri })),
  );
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
