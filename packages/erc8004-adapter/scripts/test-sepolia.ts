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

  log('Wallet', address);
  log('Balance', `${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('\nWallet has no ETH. Get testnet funds from https://faucet.quicknode.com/base/sepolia');
    process.exit(1);
  }

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

  // Using the same wallet as consumer for testing purposes
  const consumerAddress = address;
  const feedbackAuth = await erc8004.reputation.signFeedbackAuth(agentId, consumerAddress);

  log('FeedbackAuth', { ...feedbackAuth, agentId: feedbackAuth.agentId.toString() });

  const recovered = erc8004.reputation.verifyFeedbackAuth(feedbackAuth, consumerAddress);
  log('Recovered signer', recovered);
  console.assert(recovered.toLowerCase() === address.toLowerCase(), 'FeedbackAuth signer mismatch');
  log('FeedbackAuth verify', 'OK');

  // ── 4. Post Feedback ───────────────────────────────────────────────────────
  log('Step 4: Post feedback (Reputation Registry)');
  console.log('  Sending transaction...');

  const feedbackTxHash = await erc8004.reputation.postFeedback({
    agentId,
    score: 90,
    tags: ['test', 'image-data'],
    evidenceURI: `bzz://evidence-placeholder-${Date.now()}`,
    feedbackAuth,
  });

  log('Feedback tx', feedbackTxHash);

  // ── 5. Calculate Reputation ────────────────────────────────────────────────
  log('Step 5: Calculate reputation');

  const reputation = await erc8004.aggregate.calculateReputation(agentId);
  log('Reputation', {
    agentId: reputation.agentId.toString(),
    score: reputation.score,
    feedbackCount: reputation.feedbackCount.toString(),
    reliable: reputation.reliable,
  });

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n✓ All steps completed successfully');
  console.log(`  agentId: ${agentId}`);
  console.log(`  View on BaseScan: https://sepolia.basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
