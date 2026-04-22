import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  parseAgentCard,
  uploadAgentCard,
  config,
} from '../src';
import { SWARM_AI_CAPABLE } from '../src/constants';

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

  // Consumer wallet — must be a different address from the provider.
  // The ERC-8004 Reputation Registry rejects self-feedback at the contract level.
  let consumerSigner: ethers.Wallet;
  if (
    config.chain.consumerPrivateKey &&
    config.chain.consumerPrivateKey !== config.chain.privateKey
  ) {
    consumerSigner = new ethers.Wallet(config.chain.consumerPrivateKey, provider);
  } else {
    // Ephemeral wallet — used only for FeedbackAuth signing verification (step 3).
    // Step 4 (on-chain postFeedback) will be skipped without a funded consumer wallet.
    consumerSigner = ethers.Wallet.createRandom().connect(provider);
    console.log('\n  Note: CONSUMER_PRIVATE_KEY not set. Using an ephemeral wallet for step 3.');
    console.log('  Step 4 (post feedback on-chain) will be skipped.');
    console.log('  Set CONSUMER_PRIVATE_KEY to a different funded wallet to run the full flow.');
  }
  const consumerAddress = await consumerSigner.getAddress();
  log('Consumer wallet', consumerAddress);

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
        name: 'Swarm',
        endpoint: 'http://data_discovery_layer',
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

  // ── Query agents with swarm_ai_capable = 1 ──────────────────────────────────
  log('Query: agents with swarm_ai_capable metadata');

  const allSwarmAIAgents = await erc8004.identity.findAgentsWithMetadata(SWARM_AI_CAPABLE);
  const capableAgents = allSwarmAIAgents.filter((e) => ethers.toBigInt(e.rawValue) === 1n);

  log('swarm_ai_capable agents found', capableAgents.length);
  log(
    'Agent cards',
    capableAgents.map((a) => ({ agentId: a.agentId.toString(), uri: a.uri })),
  );

  return;

  // ── 4. Set Agent Wallet ────────────────────────────────────────────────────
  log('Step 4: Set agent wallet (Identity Registry)');

  // The hot wallet is an ephemeral signer — it doesn't need ETH, only signs the auth.
  // In production this would be a dedicated payment wallet separate from the NFT owner.
  const hotWalletSigner = ethers.Wallet.createRandom();
  const walletAuth = await erc8004.identity.signAgentWalletAuth(agentId, hotWalletSigner);

  log('WalletAuth', { ...walletAuth, agentId: walletAuth.agentId.toString() });

  console.log('  Sending transaction...');
  const setWalletTxHash = await erc8004.identity.setAgentWallet(
    agentId,
    walletAuth.wallet,
    walletAuth.deadline,
    walletAuth.signature,
  );

  log('Set wallet tx', setWalletTxHash);

  const linkedWallet = await erc8004.identity.getAgentWallet(agentId);
  log('Linked agent wallet', linkedWallet);
  console.assert(
    linkedWallet.toLowerCase() === hotWalletSigner.address.toLowerCase(),
    'Agent wallet mismatch after setAgentWallet',
  );

  // ── 5. FeedbackAuth sign / verify ─────────────────────────────────────────
  log('Step 5: Sign FeedbackAuth (provider → consumer)');

  const feedbackAuth = await erc8004.reputation.signFeedbackAuth(agentId, consumerAddress);

  log('FeedbackAuth', { ...feedbackAuth, agentId: feedbackAuth.agentId.toString() });

  const recovered = erc8004.reputation.verifyFeedbackAuth(feedbackAuth, consumerAddress);
  log('Recovered signer', recovered);
  console.assert(recovered.toLowerCase() === address.toLowerCase(), 'FeedbackAuth signer mismatch');
  log('FeedbackAuth verify', 'OK');

  // ── 6. Post Feedback ───────────────────────────────────────────────────────
  log('Step 6: Post feedback (Reputation Registry)');

  const consumerBalance = await provider.getBalance(consumerAddress);
  if (!config.chain.consumerPrivateKey || consumerBalance === 0n) {
    console.log(
      '  Skipped — set CONSUMER_PRIVATE_KEY to a different funded wallet to run this step.',
    );
    console.log(
      '  The contract does not allow the agent owner to submit feedback on their own agent.',
    );
  } else {
    console.log('  Sending transaction...');

    const consumerErc8004 = createERC8004Client({
      provider,
      signer: consumerSigner,
      chain: config.chain.chain,
    });
    const feedbackTxHash = await consumerErc8004.reputation.postFeedback({
      agentId,
      score: 90,
      tags: ['test', 'image-data'],
      evidenceURI: `bzz://evidence-placeholder-${Date.now()}`,
      feedbackAuth,
    });

    log('Feedback tx', feedbackTxHash);

    // ── 7. Calculate Reputation ──────────────────────────────────────────────
    log('Step 7: Calculate reputation');

    const reputation = await erc8004.aggregate.calculateReputation(agentId);
    log('Reputation', {
      agentId: reputation.agentId.toString(),
      score: reputation.score,
      feedbackCount: reputation.feedbackCount.toString(),
      reliable: reputation.reliable,
    });
  }

  // ── 8. Query by Metadata ───────────────────────────────────────────────────
  log('Step 8: Query Agents by Metadata (swarm_ai_capable)');
  const aiAgents = await erc8004.identity.getAgentsByMetadata(SWARM_AI_CAPABLE);
  log(`Found ${aiAgents.length} agents with SWARM_AI_CAPABLE metadata`);
  aiAgents.forEach((a) =>
    console.log(`   Agent ID: ${a.agentId.toString()} | Value encoded: ${a.rawValue.length} bytes`),
  );

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n✓ Steps completed successfully');
  console.log(`  agentId: ${agentId}`);
  console.log(`  View on BaseScan: https://sepolia.basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
