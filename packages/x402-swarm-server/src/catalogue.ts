import { bee } from './bee';
import { CatalogueEntryNotFound, type DataItem, type SwarmMetadataCatalogue } from './types';

const METADATA_FEED_OWNER = process.env.METADATA_FEED_OWNER ?? '';
const METADATA_FEED_TOPIC = process.env.METADATA_FEED_TOPIC ?? '';

export async function fetchCatalogue(): Promise<SwarmMetadataCatalogue> {
  const update = await bee.fetchLatestFeedUpdate(METADATA_FEED_TOPIC, METADATA_FEED_OWNER);
  return JSON.parse(update.payload.toUtf8()) as SwarmMetadataCatalogue;
}

export function findDataItem(catalogue: SwarmMetadataCatalogue, swarmHash: string): DataItem {
  const item = catalogue.dataItems.find((d) => d.swarmHash === swarmHash);
  if (!item) {
    throw new CatalogueEntryNotFound(swarmHash);
  }
  return item;
}
