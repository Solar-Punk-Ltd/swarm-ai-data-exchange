import { Bee, PrivateKey } from '@ethersphere/bee-js';
import { stateFeedTopic } from './feeds';
import type { CatalogItemState } from './types';

type FeedSigner = PrivateKey | Uint8Array | string;

export class NoStateFeedError extends Error {
  constructor(itemId: string) {
    super(`No state feed found for item: ${itemId}`);
    this.name = 'NoStateFeedError';
  }
}

// Read the current CatalogItemState from a per-item state feed.
// Throws NoStateFeedError if the feed has never been initialized (item not yet published).
export async function readItemState(
  bee: Bee,
  catalogFeedOwner: string,
  itemId: string,
): Promise<CatalogItemState> {
  const topic = stateFeedTopic(catalogFeedOwner, itemId);
  const reader = bee.makeFeedReader(topic, catalogFeedOwner);
  let stateRef: string;
  try {
    const result = await reader.downloadPayload();
    stateRef = result.payload.toUtf8();
  } catch {
    throw new NoStateFeedError(itemId);
  }
  const stateData = await bee.downloadData(stateRef);
  return JSON.parse(stateData.toUtf8()) as CatalogItemState;
}

// Write an updated CatalogItemState to the per-item state feed.
// Uploads the state JSON blob to Swarm, then pushes a feed update pointing at the blob reference.
// Returns the Swarm reference of the newly uploaded state JSON.
export async function writeItemState(
  bee: Bee,
  signer: FeedSigner,
  catalogFeedOwner: string,
  state: CatalogItemState,
  postageBatchId: string,
): Promise<string> {
  const uploadResult = await bee.uploadData(postageBatchId, JSON.stringify(state));
  const stateRef = uploadResult.reference.toString();
  const topic = stateFeedTopic(catalogFeedOwner, state.itemId);
  const writer = bee.makeFeedWriter(topic, signer);
  await writer.uploadPayload(postageBatchId, stateRef);

  return stateRef;
}
