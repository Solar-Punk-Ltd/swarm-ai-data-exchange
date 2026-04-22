import 'dotenv/config';
import { randomBytes } from 'crypto';
import { Bee, PrivateKey, Topic } from '@ethersphere/bee-js';

async function main() {
  const nodeUrl = process.env.NODE_URL;
  const postageBatchId = process.env.POSTAGE_BATCH_ID;
  const metadataFeedOwner = process.env.METADATA_FEED_OWNER;

  if (!nodeUrl) {
    console.error('NODE_URL is required');
    process.exit(1);
  }
  if (!postageBatchId) {
    console.error('POSTAGE_BATCH_ID is required');
    process.exit(1);
  }
  if (!metadataFeedOwner) {
    console.error('METADATA_FEED_OWNER is required');
    process.exit(1);
  }

  const feedPk = new PrivateKey(metadataFeedOwner);
  const feedOwner = feedPk.publicKey().address().toChecksum();
  const topic = new Topic(randomBytes(32));

  const bee = new Bee(nodeUrl);

  const initialPayload = JSON.stringify({ schemeVersion: 'v1', dataItems: [] });
  const feedWriter = bee.makeFeedWriter(topic, feedPk);
  const feedResult = await feedWriter.uploadPayload(postageBatchId, initialPayload);

  const manifestRef = await bee.createFeedManifest(postageBatchId, topic, feedOwner);

  console.log('Public Swarm feed created.');
  console.log(`  METADATA_FEED_TOPIC=${topic.toHex()}`);
  console.log(`  METADATA_FEED_OWNER=${feedOwner}`);
  console.log(`  BEE_FEED_PK=${feedPk.toHex()}`);
  console.log(`  Feed manifest:       ${manifestRef.toString()}`);
  console.log(`  Initial chunk ref:   ${feedResult.reference.toString()}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
