// Catalog Mantaray path schema (§5). Centralized so the publisher (SwarmCatalogBuilder)
// and readers (x402-swarm-server, catalogue-feed-browser) traverse identical paths —
// a single source of truth prevents publisher/reader drift.
//
// Paths are stored WITHOUT a leading slash, following the Swarm dir-upload convention
// (keys like `index.html`, not `/index.html`). This keeps leaves addressable over the
// bzz HTTP endpoint, e.g. `/bzz/{root}/items/{itemId}/sample/thumb.png`. The spec's
// `/items/...` notation (§5) denotes the namespace, not a literal leading-slash byte.

// Manifest path for an item's JSON-LD document: items/{itemId}/item.jsonld
export function itemManifestPath(itemId: string): string {
  return `items/${itemId}/item.jsonld`;
}

// Manifest path for an item's sample asset: items/{itemId}/{samplePath}
export function itemSamplePath(itemId: string, samplePath: string): string {
  return `items/${itemId}/${samplePath}`;
}

// Manifest path for the collection-level catalog document.
export const CATALOG_MANIFEST_PATH = 'catalog.jsonld';
