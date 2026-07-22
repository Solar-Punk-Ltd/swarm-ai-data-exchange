import { Bee } from '@ethersphere/bee-js';
import { keccak256, toUtf8Bytes, getBytes, concat } from 'ethers';

// Fixed protocol constant — topic for all catalog SOC feeds, no chain or agent identity encoded.
// keccak256("swarm-ai-catalog.v1") — 0x-prefixed hex string, accepted directly by bee-js makeFeedWriter/makeFeedReader.
export const CATALOG_FEED_TOPIC: string = keccak256(toUtf8Bytes('swarm-ai-catalog.v1'));

export function stateFeedTopic(catalogFeedOwner: string, itemId: string): string {
  return keccak256(
    concat([
      toUtf8Bytes('swarm-ai-catalog-state.v1'),
      getBytes(catalogFeedOwner), // 20-byte EOA address
      toUtf8Bytes(itemId), // 64-char hex itemId
    ]),
  );
}

// Read the catalog feed and return the bare 64-char hex Mantaray root reference.
// Throws if the feed has never been published (use try/catch to detect first-publish).
export async function readCatalogFeedRoot(bee: Bee, owner: string): Promise<string> {
  const reader = bee.makeFeedReader(CATALOG_FEED_TOPIC, owner);
  const result = await reader.downloadPayload();
  return result.payload.toUtf8();
}
