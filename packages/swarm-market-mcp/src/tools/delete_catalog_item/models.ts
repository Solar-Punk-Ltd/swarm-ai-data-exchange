export interface DeleteCatalogItemArgs {
  // One or more itemIds (64-char hex content references) to remove from the catalog.
  itemIds: string[];
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}
