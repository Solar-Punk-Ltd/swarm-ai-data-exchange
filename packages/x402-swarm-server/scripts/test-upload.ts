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

  const feedOwner = process.env.METADATA_FEED_OWNER ?? new PrivateKey(feedPk).publicKey().address();
  console.log(`Feed owner: ${feedOwner}`);

  const bee = new Bee(beeApiUrl);

  // Step 1: Create grantee list with one initial public key
  console.log('Creating grantee list with initial public key...');
  console.log(`  grantee: ${publisherPublicKey}`);
  const granteeResult = await bee.createGrantees(postageBatchId, [publisherPublicKey]);
  const granteeRef = granteeResult.ref.toString();
  const granteeHistoryRef = granteeResult.historyref.toString();
  console.log(`  granteeRef:      ${granteeRef}`);
  console.log(`  granteeHistory:  ${granteeHistoryRef}`);

  // Step 2: Upload file with ACT, passing the grantee history as context
  // Use a file path from the command line if provided, otherwise fall back to inline test data
  const filePath = process.argv[2];
  let fileData: Uint8Array;
  let fileName: string;
  if (filePath) {
    const fs = await import('fs');
    fileData = new Uint8Array(fs.readFileSync(filePath));
    fileName = filePath.split('/').pop() ?? filePath;
    console.log(`\nUploading file with ACT: ${filePath}`);
  } else {
    fileData = new TextEncoder().encode(
      `Test ACT-encrypted data uploaded at ${new Date().toISOString()}`,
    );
    fileName = 'test-data.txt';
    console.log('\nUploading test file with ACT (no file path provided)...');
  }
  const uploadResult = await bee.uploadFile(postageBatchId, fileData, fileName, {
    act: true,
    actHistoryAddress: granteeHistoryRef,
    contentType: 'text/plain',
  });
  const swarmHash = uploadResult.reference.toString();
  // The upload produces its own history entry chained off the grantee history.
  // This is the ref that patchGrantees must use — not granteeHistoryRef.
  if (!uploadResult.historyAddress.value) {
    console.error('Upload did not return an ACT history address — was act:true accepted?');
    process.exit(1);
  }
  const actHistoryRef = uploadResult.historyAddress.getOrThrow().toString();
  console.log(`  swarmHash:     ${swarmHash}`);
  console.log(`  actHistoryRef: ${actHistoryRef}`);

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
