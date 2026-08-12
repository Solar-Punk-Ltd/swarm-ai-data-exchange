export interface EnsureSplitContractArgs {
  // Seller address whose splitter to resolve. Defaults to SELLER_ADDRESS.
  seller?: string;
  // false (default) predicts the deterministic address without sending a transaction;
  // true deploys the clone if it does not exist yet.
  deploy?: boolean;
}
