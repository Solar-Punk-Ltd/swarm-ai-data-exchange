import { Bee } from '@ethersphere/bee-js';
import type { SwarmMetadataCatalogue } from './types.js';

export async function fetchCatalogue(
  beeUrl: string,
  feedTopic: string,
  feedOwner: string,
): Promise<SwarmMetadataCatalogue> {
  const bee = new Bee(beeUrl);
  const update = await bee.fetchLatestFeedUpdate(feedTopic, feedOwner);
  return JSON.parse(update.payload.toUtf8()) as SwarmMetadataCatalogue;
}
