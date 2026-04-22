import { PrivateKey } from '@ethersphere/bee-js';
import { bee } from './bee';
import { CatalogueEntryNotFound, type DataItem, type SwarmMetadataCatalogue } from './types';

const METADATA_FEED_TOPIC = process.env.METADATA_FEED_TOPIC ?? '';
const BEE_FEED_PK = process.env.BEE_FEED_PK ?? '';

const feedOwner =
  process.env.METADATA_FEED_OWNER ?? new PrivateKey(BEE_FEED_PK).publicKey().address();

export async function fetchCatalogue(): Promise<SwarmMetadataCatalogue> {
  const update = await bee.fetchLatestFeedUpdate(METADATA_FEED_TOPIC, feedOwner);
  return JSON.parse(update.payload.toUtf8()) as SwarmMetadataCatalogue;
}

export function findDataItem(catalogue: SwarmMetadataCatalogue, swarmHash: string): DataItem {
  const item = catalogue.dataItems.find((d) => d.swarmHash === swarmHash);
  if (!item) {
    console.log(JSON.stringify(catalogue, null, 2));
    throw new CatalogueEntryNotFound(swarmHash);
  }
  return item;
}
