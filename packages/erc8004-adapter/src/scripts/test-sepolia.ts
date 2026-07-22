import { ethers } from 'ethers';
import { Bee, MantarayNode } from '@ethersphere/bee-js';
import {
  SwarmCatalogBuilder,
  readCatalogFeedRoot,
  type CatalogItem,
  type ContentSpec,
} from '@solarpunk/swarm-catalog';
import {
  createERC8004Client,
  generateAgentCard,
  serializeAgentCard,
  parseAgentCard,
  uploadAgentCard,
  config,
} from '..';
import { SWARM_AI_CAPABLE } from '../constants';
import { getUploadPostageBatchId } from '../utils';

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
        endpoint: 'http://localhost:3000',
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

  // ── 5. Publish a catalog with SwarmCatalogBuilder ──────────────────────────
  await buildDemoCatalog(address);

  return;

  // ── 4. x402-swarm-server purchase challenge (Phase 1) ──────────────────────
  // Exercises the publisher's purchase endpoint without paying: POST with no X-Payment
  // header MUST return a 402 carrying the x402 challenge, including the EIP-712 domain in
  // extra.purchaseIntentDomain (§10.2). Full Phase-2 settle (ERC-3009 + ACT grant) lives in
  // catalogue-feed-browser, which has the viem consumer wallet and USDC.
  //
  // Gated by env: set X402_TEST_ITEM_ID (and optionally X402_SERVER_URL) to run it.
  await testPurchaseChallenge();
}

async function testPurchaseChallenge() {
  log('Step 4: x402-swarm-server purchase challenge (Phase 1)');

  const itemId = process.env.X402_TEST_ITEM_ID;
  if (!itemId) {
    console.log('  Skipped — set X402_TEST_ITEM_ID (an itemId in the server catalog) to run.');
    console.log('  Optionally set X402_SERVER_URL (default http://localhost:3000).');
    return;
  }

  const serverUrl = (process.env.X402_SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const endpoint = `${serverUrl}/v1/items/${itemId}/purchase`;
  log('Purchase endpoint', endpoint);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ granteePublicKey: '0x00' }),
    });
  } catch (err) {
    console.error(`  Could not reach x402 server at ${serverUrl}:`, err);
    console.error('  Start it with: pnpm --filter @solarpunk/x402-swarm-server dev');
    return;
  }

  const body = await res.json().catch(() => undefined);

  if (res.status !== 402) {
    console.error(`  Expected HTTP 402, got ${res.status}`, body);
    return;
  }

  const accept = body?.accepts?.[0];
  const domain = accept?.extra?.purchaseIntentDomain;
  console.assert(accept, '402 challenge carried no accepts entry');
  console.assert(domain, '402 challenge missing extra.purchaseIntentDomain');

  log('402 challenge', body);
  log('Purchase challenge', accept && domain ? 'OK' : 'MALFORMED');
}

// The consumer/grantee identity for ACT is a Bee-node public key. Here we seed the grantee
// list with the publisher's own node key so the list exists; real buyers are added per purchase.
async function getBeePublicKey(beeUrl: string): Promise<string> {
  const res = await fetch(`${beeUrl.replace(/\/$/, '')}/addresses`);
  if (!res.ok) throw new Error(`Failed to fetch Bee addresses (${res.status})`);
  const data = (await res.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error('Bee /addresses response missing publicKey');
  return data.publicKey.startsWith('0x') ? data.publicKey : `0x${data.publicKey}`;
}

// Build and publish a small catalog using SwarmCatalogBuilder (§12 publisher flow).
// Gated like the Swarm steps above: requires BEE_FEED_PK (catalog feed signer) + a usable
// postage batch + a reachable Bee node with ACT support.
async function buildDemoCatalog(publisherAddress: string) {
  log('Step 5: Publish a catalog with SwarmCatalogBuilder');

  if (!config.bee.feedPrivateKey) {
    console.log('  Skipped — BEE_FEED_PK not set (catalog feed signer required).');
    return;
  }

  const bee = new Bee(config.bee.endpoint);
  const { postageBatchId, error } = await getUploadPostageBatchId(config.bee.postageBatchId, bee);
  if (error !== null || !postageBatchId) {
    console.log(`  Skipped — no usable postage batch: ${error ?? 'none found'}`);
    return;
  }

  // The builder enforces the spec invariant that the catalog feed signer (cold key) and the
  // per-item state feed signer (hot key) are distinct. The adapter only has BEE_FEED_PK, so use
  // ITEM_STATE_FEED_PK if provided, else a throwaway random key for this demo run.
  const itemStateFeedSigner =
    process.env.ITEM_STATE_FEED_PK ?? ethers.Wallet.createRandom().privateKey;

  const builder = new SwarmCatalogBuilder({
    bee,
    catalogFeedSigner: config.bee.feedPrivateKey,
    itemStateFeedSigner,
    postageBatchId,
  });

  builder.setCatalogMeta({
    name: 'Test Data Provider Catalog',
    description: 'Demo catalog published by test-sepolia',
    license: 'https://creativecommons.org/licenses/by/4.0/',
  });

  const publisherPubKey = await getBeePublicKey(config.bee.endpoint);

  const assets: Array<{
    bytes: Uint8Array;
    content: ContentSpec;
    name: string;
    description: string;
    sample: Uint8Array;
    samplePath: string;
    sampleKind: 'thumbnail' | 'subset';
  }> = [
    {
      bytes: Buffer.from(`demo-image-${Date.now()}`),
      content: { type: 'image', encodingFormat: 'image/png', width: 1024, height: 1024 },
      name: 'Curated image set',
      description: 'High-res demo training images',
      sample: Buffer.from('thumbnail-bytes'),
      samplePath: 'sample/thumb.png',
      sampleKind: 'thumbnail',
    },
    {
      bytes: Buffer.from(`Introduction
      Swarm is a peer-to-peer network of Bee nodes that collectively provide censorship-resistant decentralised storage and communication services. Swarm's mission is to enable a self-sovereign global society and permissionless open markets by providing scalable decentralized storage infrastructure for Web3. Its incentive system is enforced through smart contracts on the Gnosis Chain blockchain and powered by the xBZZ token, making it economically self-sustaining.

      Bee Client
      Bee is a Swarm client implemented in Go and serves as the foundation of the Swarm network. Bee nodes form a private, decentralized, and self-sustaining network for permissionless publishing and data storage. You can learn more about how Bee clients work by reading about the concepts and protocols which underpin the Swarm network. To get hands on experience working with Swarm, you can start by learning how to install and operate a Bee node.

      Swarm Foundation
      The Swarm Foundation is dedicated to advancing open-source technology for decentralized data storage and exchange. It fosters a sustainable, independent ecosystem by supporting the development of free and open-source software (FLOSS) and empowering a community built around crypto-economic incentives for processing, distributing, and storing data.

      Its mission is to champion digital freedom by promoting the Swarm network as the foundational layer of the fair data economy, while nurturing the community that sustains it.

      To achieve this, the foundation provides financial grants and other forms of support, evaluated on a case-by-case basis.
    `),
      content: { type: 'text', encodingFormat: 'text/plain' },
      name: 'Swarm Introduction',
      description: 'A short introduction to Swarm.',
      sample: Buffer.from(
        'Swarm is a peer-to-peer network of Bee nodes that collectively provide censorship-resistant decentralised storage and communication services.',
      ),
      samplePath: 'sample/preview.txt',
      sampleKind: 'subset',
    },
  ];

  const now = new Date().toISOString();
  for (const a of assets) {
    // Caller responsibility (a): ACT-wrap + upload the full content. The content address
    // becomes the itemId (id === storage.reference). Mirrors the working ACT pattern in
    // x402-swarm-server/scripts/test-upload.ts:
    //   1. createGrantees → initial grantee list (publisher's own key) + its history.
    //   2. uploadData with act:true, passing the grantee history as context, so the
    //      ciphertext is bound to that ACT.
    const grantees = await bee.createGrantees(postageBatchId, [publisherPubKey]);
    const uploaded = await bee.uploadData(postageBatchId, a.bytes, {
      act: true,
      actHistoryAddress: grantees.historyref,
    });
    const itemId = uploaded.reference.toString();

    // Caller responsibility (b): capture the ACT refs that gate decryption. The upload
    // returns its OWN history head, chained off the grantee history — that (not the grantee
    // history) is the ref a grant/patchGrantees advances at purchase time.
    const actHistoryRef = uploaded.historyAddress.getOrThrow().toString();

    const item: CatalogItem = {
      id: itemId,
      name: a.name,
      description: a.description,
      content: a.content,
      storage: { reference: itemId },
      payment: [
        {
          scheme: 'exact',
          chainId: 'eip155:84532',
          asset: 'eip155:84532/erc20:0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amount: '10000',
          payTo: publisherAddress,
        },
      ],
      sample: { kind: a.sampleKind, path: a.samplePath },
      license: 'CC-BY-4.0',
      lifecycle: 'active',
      dateAdded: now,
      dateModified: now,
    };

    builder.stageItem(item);
    builder.stageSampleData(itemId, a.sample);
    builder.seedActState(itemId, {
      actHistoryRef,
      granteeRef: grantees.ref.toString(),
    });
    log('Staged item', { itemId, name: a.name });
  }

  const result = await builder.publish();
  const catalogFeedOwner = new ethers.Wallet(
    config.bee.feedPrivateKey.startsWith('0x')
      ? config.bee.feedPrivateKey
      : `0x${config.bee.feedPrivateKey}`,
  ).address;

  log('Catalog published', {
    catalogFeedOwner,
    catalogRoot: result.catalogRoot,
    feedUpdateTxId: result.feedUpdateTxId,
    stateFeeds: result.stateFeeds,
  });

  // ── Read the catalog back from its feed (§13 reader flow) ──────────────────
  // Resolve the catalog feed → bare Mantaray root, then traverse the manifest to display the
  // published item set. This is the same entry point a consumer uses to discover the catalog.
  await readDemoCatalog(bee, catalogFeedOwner, result.catalogRoot);

  console.log(
    `\n  Browse it: set CATALOG_FEED_OWNER=${catalogFeedOwner} on x402-swarm-server, then` +
      `\n  test the purchase flow with X402_TEST_ITEM_ID=<one of the itemIds above>.`,
  );
}

// Resolve the catalog feed → Mantaray root → manifest and display the published catalog (§13).
// publishedRoot is the root publish() just wrote; we read the feed back independently and assert
// they match, proving the feed update is live and resolvable.
async function readDemoCatalog(bee: Bee, catalogFeedOwner: string, publishedRoot: string) {
  log('Step 6: Read catalog back from the feed');

  const root = await readCatalogFeedRoot(bee, catalogFeedOwner);
  log('Catalog feed root', root);
  console.assert(
    root.toLowerCase() === publishedRoot.toLowerCase(),
    `Feed root ${root} does not match published root ${publishedRoot}`,
  );

  const manifest = await MantarayNode.unmarshal(bee, root);
  await manifest.loadRecursively(bee);

  const paths = manifest
    .collect()
    .map((n) => n.fullPathString)
    .sort();
  log('Catalog manifest paths', paths);
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
