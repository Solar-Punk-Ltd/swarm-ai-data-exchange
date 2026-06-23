import type { CatalogItem } from '@solarpunk/swarm-catalog';

export interface BuildCatalogItem {
  // Mirrors swarm-catalog's CatalogItem (id MUST equal storage.reference; payment MUST be non-empty).
  item: CatalogItem;
  // REQUIRED for every priced item: the ACT refs the caller captured when ACT-wrapping the content.
  actSeed: { actHistoryRef: string; granteeRef: string };
  // Optional sample bytes (utf-8 string) → builder.stageSampleData(itemId, ...).
  sampleData?: string;
}

export interface BuildCatalogArgs {
  items: BuildCatalogItem[];
  catalogMeta?: { name?: string; description?: string; license?: string };
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}
