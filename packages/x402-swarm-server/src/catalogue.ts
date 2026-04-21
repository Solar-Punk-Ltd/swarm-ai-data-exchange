import { PrivateKey } from '@ethersphere/bee-js';
import { bee } from './bee';
import { CatalogueEntryNotFound, type DataItem, type SwarmMetadataCatalogue } from './types';

const METADATA_FEED_TOPIC = process.env.METADATA_FEED_TOPIC ?? '';
const BEE_FEED_PK = process.env.BEE_FEED_PK ?? '';

// Derive the feed owner address from the signing key so reader and writer are always consistent
const feedOwner = new PrivateKey(BEE_FEED_PK).publicKey().address();

export async function fetchCatalogue(): Promise<SwarmMetadataCatalogue> {
  const update = await bee.fetchLatestFeedUpdate(METADATA_FEED_TOPIC, feedOwner);
  return JSON.parse(update.payload.toUtf8()) as SwarmMetadataCatalogue;
}

export function findDataItem(catalogue: SwarmMetadataCatalogue, swarmHash: string): DataItem {
  const item = catalogue.dataItems.find((d) => d.swarmHash === swarmHash);
  if (!item) {
    throw new CatalogueEntryNotFound(swarmHash);
  }
  return item;
}
