import 'dotenv/config';
import { ethers } from 'ethers';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  parseAgentCard,
} from '../src';

const RPC_URL = process.env.RPC_URL ?? 'https://sepolia.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONSUMER_PRIVATE_KEY = process.env.CONSUMER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY is not set in .env');
  process.exit(1);
}

function log(label: string, value?: unknown) {
  console.log(`\n[${label}]`, value !== undefined ? value : '');
}

async function main() {
  // ── Setup ──────────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY!, provider);
  const address = await signer.getAddress();
  const balance = await provider.getBalance(address);

  log('Provider wallet', address);
  log('Balance', `${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('\nWallet has no ETH. Get testnet funds from https://faucet.quicknode.com/base/sepolia');
    process.exit(1);
  }

  // Consumer wallet — must be a different address from the provider.
  // The ERC-8004 Reputation Registry rejects self-feedback at the contract level.
  let consumerSigner: ethers.Wallet;
  if (CONSUMER_PRIVATE_KEY && CONSUMER_PRIVATE_KEY !== PRIVATE_KEY) {
    consumerSigner = new ethers.Wallet(CONSUMER_PRIVATE_KEY, provider);
  } else {
    // Ephemeral wallet — used only for FeedbackAuth signing verification (step 3).
    // Step 4 (on-chain postFeedback) will be skipped without a funded consumer wallet.
    consumerSigner = ethers.Wallet.createRandom().connect(provider);
    console.log('\n  Note: CONSUMER_PRIVATE_KEY not set. Using an ephemeral wallet for step 3.');
    console.log('  Step 4 (post feedback on-chain) will be skipped.');
    console.log('  Set CONSUMER_PRIVATE_KEY in .env to a different funded wallet to run the full flow.');
  }
  const consumerAddress = await consumerSigner.getAddress();
  log('Consumer wallet', consumerAddress);

  const erc8004 = createERC8004Client({ provider, signer, chain: 'base-sepolia' });

  // ── 1. Generate Agent Card ─────────────────────────────────────────────────
  log('Step 1: Generate Agent Card');

  const card = generateAgentCard({
    name: 'Test Data Provider',
    description: 'Demo agent for Swarm Data Exchange POC testing',
    capabilities: ['image-data', 'test'],
    endpoints: {
      x402: 'https://provider.example.com/data',
      mcp: 'bzz://placeholder-upload-to-swarm-first',
    },
    owner: address,
  });

  log('Agent Card', JSON.parse(serializeAgentCard(card)));

  // Round-trip parse check
  const reparsed = parseAgentCard(serializeAgentCard(card));
  console.assert(reparsed.name === card.name, 'Agent card round-trip failed');
  log('Agent Card round-trip', 'OK');

  // ── 2. Register Identity ───────────────────────────────────────────────────
  log('Step 2: Register on-chain (Identity Registry)');
  console.log('  Sending transaction...');

  // In production the agentURI would be `bzz://<hash>` after uploading the card to Swarm.
  const agentURI = `bzz://placeholder-${Date.now()}`;
  const { agentId, txHash } = await erc8004.identity.register(agentURI);

  log('Registered agentId', agentId.toString());
  log('Transaction', txHash);

  // Verify on-chain
  const onChainURI = await erc8004.identity.getAgentURI(agentId);
  const owner = await erc8004.identity.getOwner(agentId);
  log('On-chain URI', onChainURI);
  log('On-chain owner', owner);

  console.assert(onChainURI === agentURI, 'URI mismatch after registration');
  console.assert(owner.toLowerCase() === address.toLowerCase(), 'Owner mismatch after registration');

  // ── 3. FeedbackAuth sign / verify ─────────────────────────────────────────
  log('Step 3: Sign FeedbackAuth (provider → consumer)');

  const feedbackAuth = await erc8004.reputation.signFeedbackAuth(agentId, consumerAddress);

  log('FeedbackAuth', { ...feedbackAuth, agentId: feedbackAuth.agentId.toString() });

  const recovered = erc8004.reputation.verifyFeedbackAuth(feedbackAuth, consumerAddress);
  log('Recovered signer', recovered);
  console.assert(recovered.toLowerCase() === address.toLowerCase(), 'FeedbackAuth signer mismatch');
  log('FeedbackAuth verify', 'OK');

  // ── 4. Post Feedback ───────────────────────────────────────────────────────
  log('Step 4: Post feedback (Reputation Registry)');

  const consumerBalance = await provider.getBalance(consumerAddress);
  if (!CONSUMER_PRIVATE_KEY || consumerBalance === 0n) {
    console.log('  Skipped — set CONSUMER_PRIVATE_KEY to a different funded wallet to run this step.');
    console.log('  The contract does not allow the agent owner to submit feedback on their own agent.');
  } else {
    console.log('  Sending transaction...');

    const consumerErc8004 = createERC8004Client({ provider, signer: consumerSigner, chain: 'base-sepolia' });
    const feedbackTxHash = await consumerErc8004.reputation.postFeedback({
      agentId,
      score: 90,
      tags: ['test', 'image-data'],
      evidenceURI: `bzz://evidence-placeholder-${Date.now()}`,
      feedbackAuth,
    });

    log('Feedback tx', feedbackTxHash);

    // ── 5. Calculate Reputation ──────────────────────────────────────────────
    log('Step 5: Calculate reputation');

    const reputation = await erc8004.aggregate.calculateReputation(agentId);
    log('Reputation', {
      agentId: reputation.agentId.toString(),
      score: reputation.score,
      feedbackCount: reputation.feedbackCount.toString(),
      reliable: reputation.reliable,
    });
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n✓ Steps completed successfully');
  console.log(`  agentId: ${agentId}`);
  console.log(`  View on BaseScan: https://sepolia.basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
