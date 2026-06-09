import { Bee, MantarayNode } from '@ethersphere/bee-js';
import {
  readCatalogFeedRoot,
  CATALOG_MANIFEST_PATH,
  itemManifestPath,
  type CatalogMeta,
  type Lifecycle,
  type PaymentRequirements,
} from '@solarpunk/swarm-catalog';

// Collection-level metadata as read back from /catalog.jsonld. Extends the publisher-side
// CatalogMeta (name/description/license) with the protocol-managed fields the document also
// carries (§5.2).
export interface CatalogMetaResult extends CatalogMeta {
  itemCount?: number;
  protocolVersion?: string;
  dateModified?: string;
}

// Lightweight list-view type (§13). Populated from item.jsonld — inline Mantaray fork
// metadata (§5.5) is empty in the prototype publisher, so we always fall back to the leaf,
// which is also the authoritative source when the two disagree.
export interface CatalogItemSummary {
  itemId: string;
  name: string;
  description: string;
  contentType: string; // image | video | audio | text | document | dataset | bytes
  encodingFormat?: string;
  lifecycle: Lifecycle;
  tags: string[];
  payment: PaymentRequirements[];
  hasSample: boolean;
}

// Sample blob + its declared MIME type, for the open-access sample proxy (§13.3).
export interface SampleBlob {
  data: Uint8Array;
  encodingFormat: string;
}

// /items/{itemId}/item.jsonld — capture group 1 is the itemId.
const ITEM_JSONLD_PATH_RE = /^\/?items\/([^/]+)\/item\.jsonld$/;

// Resolve catalog feed → Mantaray root → fully-loaded manifest. Topic is the fixed
// CATALOG_FEED_TOPIC constant; only the owner varies. Throws if the feed was never published.
async function loadCatalogManifest(bee: Bee, catalogFeedOwner: string): Promise<MantarayNode> {
  const root = await readCatalogFeedRoot(bee, catalogFeedOwner);
  const manifest = await MantarayNode.unmarshal(bee, root);
  await manifest.loadRecursively(bee);
  return manifest;
}

function hasTarget(node: MantarayNode | null | undefined): node is MantarayNode {
  return !!node?.targetAddress && !node.targetAddress.every((b) => b === 0);
}

async function downloadJson(bee: Bee, target: Uint8Array): Promise<Record<string, unknown>> {
  const raw = await bee.downloadData(target);
  return JSON.parse(raw.toUtf8()) as Record<string, unknown>;
}

// Reverse the §7.4 co-typing: map the JSON-LD @type array back to a ContentSpec.type label.
function contentTypeFromAtType(atType: unknown): string {
  const arr = Array.isArray(atType) ? atType.map(String) : [String(atType)];
  if (arr.includes('sc:ImageObject')) return 'image';
  if (arr.includes('sc:VideoObject')) return 'video';
  if (arr.includes('sc:AudioObject')) return 'audio';
  if (arr.includes('sc:TextDigitalDocument')) return 'text';
  if (arr.includes('cr:Dataset') || arr.includes('sc:Dataset')) return 'dataset';
  if (arr.includes('sc:CreativeWork')) return 'document';
  if (arr.includes('sc:MediaObject')) return 'bytes';
  return 'unknown';
}

function summarize(itemId: string, doc: Record<string, unknown>): CatalogItemSummary {
  return {
    itemId,
    name: typeof doc.name === 'string' ? doc.name : itemId,
    description: typeof doc.description === 'string' ? doc.description : '',
    contentType: contentTypeFromAtType(doc['@type']),
    encodingFormat: typeof doc.encodingFormat === 'string' ? doc.encodingFormat : undefined,
    lifecycle: (typeof doc.lifecycle === 'string' ? doc.lifecycle : 'active') as Lifecycle,
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    payment: Array.isArray(doc.payment) ? (doc.payment as PaymentRequirements[]) : [],
    hasSample: typeof doc.sample === 'object' && doc.sample !== null,
  };
}

// Resolve the catalog feed → Mantaray root → /catalog.jsonld and return its collection-level
// metadata (§13 reader flow, scoped to the collection document only). Throws if the feed has
// never been published or the leaf is absent/invalid — callers wanting an optional header catch.
export async function readCatalogMeta(
  bee: Bee,
  catalogFeedOwner: string,
): Promise<CatalogMetaResult> {
  const manifest = await loadCatalogManifest(bee, catalogFeedOwner);
  const node = manifest.find(CATALOG_MANIFEST_PATH);
  if (!hasTarget(node)) {
    throw new Error('catalog.jsonld not found in catalog manifest');
  }

  const doc = await downloadJson(bee, node.targetAddress);
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

// Enumerate every /items/{itemId}/item.jsonld leaf and summarize it for the list view (§13.2).
// No lifecycle filtering — the UI is responsible for marking/hiding retired items (§13).
export async function listItems(catalogFeedOwner: string, bee: Bee): Promise<CatalogItemSummary[]> {
  const manifest = await loadCatalogManifest(bee, catalogFeedOwner);
  const leaves = manifest.collect().filter((n) => ITEM_JSONLD_PATH_RE.test(n.fullPathString));

  const summaries = await Promise.all(
    leaves.map(async (node) => {
      if (!hasTarget(node)) return null;
      const itemId = ITEM_JSONLD_PATH_RE.exec(node.fullPathString)![1];
      const doc = await downloadJson(bee, node.targetAddress);
      return summarize(itemId, doc);
    }),
  );
  return summaries.filter((s): s is CatalogItemSummary => s !== null);
}

// Fetch the full item.jsonld document for a single item (§13.2 detail view). Returned as the
// raw JSON-LD object (with @context/@type and flattened content fields) — not a CatalogItem —
// because the detail view renders the document verbatim.
export async function getItem(
  catalogFeedOwner: string,
  itemId: string,
  bee: Bee,
): Promise<Record<string, unknown>> {
  const manifest = await loadCatalogManifest(bee, catalogFeedOwner);
  const node = manifest.find(itemManifestPath(itemId));
  if (!hasTarget(node)) throw new Error(`Item ${itemId} not found in catalog`);
  return downloadJson(bee, node.targetAddress);
}

// List the Mantaray paths of an item's sample assets (everything under /items/{itemId}/ except
// item.jsonld). Paths only — the sample proxy reads encodingFormat from item.jsonld.sample.
export async function getSamplePaths(
  catalogFeedOwner: string,
  itemId: string,
  bee: Bee,
): Promise<string[]> {
  const manifest = await loadCatalogManifest(bee, catalogFeedOwner);
  const prefix = `items/${itemId}/`;
  return manifest
    .collect()
    .map((n) => n.fullPathString.replace(/^\//, ''))
    .filter((p) => p.startsWith(prefix) && p !== `${prefix}item.jsonld`)
    .map((p) => `/${p}`);
}

// Fetch a single sample blob for the open-access sample proxy (§13.3): read item.jsonld for the
// sample descriptor (path + encodingFormat), then download the blob at /items/{itemId}/{path}.
// Sample content is never ACT-protected — it is always open-access.
export async function getSample(
  catalogFeedOwner: string,
  itemId: string,
  bee: Bee,
): Promise<SampleBlob> {
  const manifest = await loadCatalogManifest(bee, catalogFeedOwner);

  const itemNode = manifest.find(itemManifestPath(itemId));
  if (!hasTarget(itemNode)) throw new Error(`Item ${itemId} not found in catalog`);
  const doc = await downloadJson(bee, itemNode.targetAddress);

  const sample = doc.sample as { path?: string; encodingFormat?: string } | undefined;
  if (!sample?.path) throw new Error(`Item ${itemId} has no sample`);

  const sampleNode = manifest.find(`/items/${itemId}/${sample.path}`);
  if (!hasTarget(sampleNode)) throw new Error(`Sample blob not found for item ${itemId}`);

  const raw = await bee.downloadData(sampleNode.targetAddress);
  return {
    data: raw.toUint8Array(),
    encodingFormat:
      typeof sample.encodingFormat === 'string'
        ? sample.encodingFormat
        : 'application/octet-stream',
  };
}
