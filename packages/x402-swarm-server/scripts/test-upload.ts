import 'dotenv/config';
import { Bee, PrivateKey } from '@ethersphere/bee-js';

async function main() {
  const beeApiUrl = process.env.BEE_API_URL ?? 'http://localhost:1633';
  const postageBatchId = process.env.POSTAGE_BATCH_ID ?? '';
  const publisherPublicKey = process.env.PUBLISHER_PUBLIC_KEY ?? '';
  const feedTopic = process.env.METADATA_FEED_TOPIC ?? '';
  const feedPk = process.env.BEE_FEED_PK ?? '';

  if (!postageBatchId) {
    console.error('POSTAGE_BATCH_ID is required');
    process.exit(1);
  }
  if (!publisherPublicKey) {
    console.error('PUBLISHER_PUBLIC_KEY is required');
    process.exit(1);
  }
  if (!feedPk) {
    console.error('BEE_FEED_PK is required');
    process.exit(1);
  }
  if (!feedTopic) {
    console.error('METADATA_FEED_TOPIC is required');
    process.exit(1);
  }

  // Derive feed owner from the signing key — must match what catalogue.ts uses
  const feedOwner = new PrivateKey(feedPk).publicKey().address();
  console.log(`Feed owner (derived from BEE_FEED_PK): ${feedOwner}`);

  const bee = new Bee(beeApiUrl);

  // Step 1: Create grantee list with one initial public key
  console.log('Creating grantee list with initial public key...');
  console.log(`  grantee: ${publisherPublicKey}`);
  const granteeResult = await bee.createGrantees(postageBatchId, [publisherPublicKey]);
  const granteeRef = granteeResult.ref.toString();
  const actHistoryRef = granteeResult.historyref.toString();
  console.log(`  granteeRef:    ${granteeRef}`);
  console.log(`  actHistoryRef: ${actHistoryRef}`);

  // Step 2: Upload test file with ACT, linked to the grantee history
  const testData = new TextEncoder().encode(
    `Test ACT-encrypted data uploaded at ${new Date().toISOString()}`,
  );
  console.log('\nUploading test file with ACT...');
  const uploadResult = await bee.uploadFile(postageBatchId, testData, 'test-data.txt', {
    act: true,
    actHistoryAddress: actHistoryRef,
    contentType: 'text/plain',
  });
  const swarmHash = uploadResult.reference.toString();
  console.log(`  swarmHash: ${swarmHash}`);

  // Step 3: Fetch existing catalogue from feed, or start fresh
  console.log('\nFetching existing catalogue from feed...');
  let catalogue: {
    schemeVersion: string;
    dataItems: {
      swarmHash: string;
      actHistoryRef: string;
      granteeRef: string;
      displayName: string;
      metadata: unknown[];
      tags: unknown[];
    }[];
  };
  try {
    const feedUpdate = await bee.fetchLatestFeedUpdate(feedTopic, feedOwner);
    catalogue = JSON.parse(feedUpdate.payload.toUtf8());
    console.log(`  Found catalogue with ${catalogue.dataItems.length} item(s)`);
  } catch {
    console.log('  No existing catalogue found, starting fresh');
    catalogue = { schemeVersion: 'v1', dataItems: [] };
  }

  // Step 4: Upsert data item
  const newItem = {
    swarmHash,
    actHistoryRef,
    granteeRef,
    displayName: 'test-data',
    metadata: [],
    tags: [],
  };
  const existingIdx = catalogue.dataItems.findIndex((d) => d.swarmHash === swarmHash);
  if (existingIdx >= 0) {
    catalogue.dataItems[existingIdx] = newItem;
  } else {
    catalogue.dataItems.push(newItem);
  }

  // Step 5: Write updated catalogue to feed
  console.log('\nWriting catalogue to feed...');
  const feedWriter = bee.makeFeedWriter(feedTopic, feedPk);
  const feedResult = await feedWriter.uploadPayload(postageBatchId, JSON.stringify(catalogue));
  console.log(`  Feed reference: ${feedResult.reference.toString()}`);

  console.log('\nDone! Summary:');
  console.log(`  SWARM_HASH=${swarmHash}`);
  console.log(`  actHistoryRef=${actHistoryRef}`);
  console.log(`  granteeRef=${granteeRef}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
