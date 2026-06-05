import { Bee, MantarayNode } from '@ethersphere/bee-js';
import {
  readCatalogFeedRoot,
  CATALOG_MANIFEST_PATH,
  type CatalogMeta,
} from '@solarpunk/swarm-catalog';

// Collection-level metadata as read back from /catalog.jsonld. Extends the publisher-side
// CatalogMeta (name/description/license) with the protocol-managed fields the document also
// carries (§5.2).
export interface CatalogMetaResult extends CatalogMeta {
  itemCount?: number;
  protocolVersion?: string;
  dateModified?: string;
}

// Resolve the catalog feed → Mantaray root → /catalog.jsonld and return its collection-level
// metadata (§13 reader flow, scoped to the collection document only).
//
// Topic is the fixed CATALOG_FEED_TOPIC constant; owner is the catalog feed signer EOA. Throws
// if the feed has never been published, the Mantaray lacks /catalog.jsonld, or the leaf is not
// valid JSON — callers that want the header to be optional should catch and degrade gracefully.
export async function readCatalogMeta(
  bee: Bee,
  catalogFeedOwner: string,
): Promise<CatalogMetaResult> {
  const root = await readCatalogFeedRoot(bee, catalogFeedOwner);
  const manifest = await MantarayNode.unmarshal(bee, root);
  await manifest.loadRecursively(bee);

  const node = manifest.find(CATALOG_MANIFEST_PATH);
  if (!node || !node.targetAddress || node.targetAddress.every((b) => b === 0)) {
    throw new Error('catalog.jsonld not found in catalog manifest');
  }

  const raw = await bee.downloadData(node.targetAddress);
  const doc = JSON.parse(raw.toUtf8()) as Record<string, unknown>;

  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;

  return {
    name: str(doc.name),
    description: str(doc.description),
    license: str(doc.license),
    itemCount: num(doc['swarm-cat:itemCount']),
    protocolVersion: str(doc['swarm-cat:protocolVersion']),
    dateModified: str(doc.dateModified),
  };
}
