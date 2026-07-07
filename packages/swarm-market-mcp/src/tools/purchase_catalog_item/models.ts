export interface PurchaseCatalogItemArgs {
  // 64-char hex content reference of the catalog item to buy.
  itemId: string;
  // x402 server base URL (e.g. https://seller/v1). Falls back to X402_ENDPOINT env.
  x402Endpoint?: string;
  // Override the grantee (buyer) public key. Defaults to this node's ACT publisher key.
  granteePublicKey?: string;
}

// EIP-712 domain the seller quotes for PurchaseIntent signing, carried in
// accepts[].extra.purchaseIntentDomain of the 402 challenge.
export interface PurchaseIntentDomain {
  name: string;
  version: string;
  chainId: number | string;
  verifyingContract: string;
}

// A single entry in the 402 challenge `accepts[]` array (x402 PaymentRequirements).
export interface PaymentRequirementsAccept {
  scheme: string;
  network: string;
  asset: string;
  maxAmountRequired: string | number;
  payTo: string;
  extra?: {
    purchaseIntentDomain?: PurchaseIntentDomain;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// Body of the seller's 402 challenge response.
export interface PurchaseChallenge {
  accepts?: PaymentRequirementsAccept[];
  [k: string]: unknown;
}

// Shape returned by the seller's x402 server on successful settlement.
export interface ActGrantResult {
  txHash?: string;
  actHistoryRef?: string;
  grantorPublicKey?: string;
  [k: string]: unknown;
}
