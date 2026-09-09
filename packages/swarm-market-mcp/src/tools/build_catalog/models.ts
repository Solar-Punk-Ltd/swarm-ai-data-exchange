import type { CatalogItem } from '@solarpunk/swarm-catalog';
import type { PaymentInput } from '../../splitter';

// CatalogItem as accepted from a tool caller: payTo may be omitted on payment entries and is
// resolved to the seller's split contract before staging.
export type CatalogItemInput = Omit<CatalogItem, 'payment'> & { payment: PaymentInput[] };

export interface BuildCatalogItem {
  // Mirrors swarm-catalog's CatalogItem (id MUST equal storage.reference; payment MUST be non-empty).
  item: CatalogItemInput;
  // REQUIRED for every priced item: the ACT refs the caller captured when ACT-wrapping the content.
  actSeed: { actHistoryRef: string; granteeRef: string };
  // Optional sample bytes → builder.stageSampleData(itemId, ...). Interpreted per
  // sampleEncoding: 'utf8' (default) uses the string as-is; 'base64' decodes to raw
  // bytes first (required for binary samples like PNG thumbnails).
  sampleData?: string;
  sampleEncoding?: 'utf8' | 'base64';
}

export interface BuildCatalogArgs {
  items: BuildCatalogItem[];
  catalogMeta?: { name?: string; description?: string; license?: string };
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}
