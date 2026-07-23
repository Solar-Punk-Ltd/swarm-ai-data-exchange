export interface DeleteCatalogArgs {
  // Safety latch — must be true to actually empty the catalog. Guards against an
  // accidental call wiping every item.
  confirm: boolean;
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}
