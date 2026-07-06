// TypeScript reference types from Appendix A of the v1 spec
// (documents/swarm-ai-catalog-design-v1_2026-05-29-final-draft.md).

// --- SwarmStorage ---
// All v1 priced content is ACT-protected; no flag is carried per item.
// Current ACT history reference lives in CatalogItemState, not here.
export interface SwarmStorage {
  reference: string; // 64-char hex, encrypted content reference
  contentSize?: number; // optional duplicate of ContentSpec.contentSize
}

// --- PaymentRequirements ---
export interface PaymentRequirements {
  scheme: 'exact'; // v1: only 'exact'
  chainId: string; // CAIP-2
  asset: string; // CAIP-19
  amount: string; // smallest-unit, decimal string
  payTo: string; // 0x address
  facilitator?: string; // URL
  description?: string;
}

// --- ContentSpec discriminated union (schema.org-aligned field names) ---
export type ContentSpec =
  | ImageContent
  | VideoContent
  | AudioContent
  | TextContent
  | DocumentContent
  | DatasetContent
  | BytesContent;

// Discriminant union of content types, derived from ContentSpec so the member
// interfaces remain the single source of truth (auto-updates if a type is added).
export type ContentType = ContentSpec['type'];

export interface ImageContent {
  type: 'image';
  encodingFormat: string; // MIME
  width: number; // pixels
  height: number; // pixels
  contentSize?: number; // bytes
  colorSpace?: string; // swarm-cat extension
}

export interface VideoContent {
  type: 'video';
  encodingFormat: string;
  width: number;
  height: number;
  duration: string; // ISO 8601 duration, e.g. "PT12M34S"
  contentSize?: number;
  bitrate?: number; // bits per second
  fps?: number; // swarm-cat extension
  codec?: string; // swarm-cat extension
  hasAudio?: boolean; // swarm-cat extension
}

export interface AudioContent {
  type: 'audio';
  encodingFormat: string;
  duration: string;
  contentSize?: number;
  bitrate?: number;
  codec?: string; // swarm-cat extension
  channels?: number; // swarm-cat extension
  sampleRate?: number; // swarm-cat extension, Hz
}

export interface TextContent {
  type: 'text';
  encodingFormat: string; // text/plain, text/markdown, application/json, etc.
  contentSize?: number;
  wordCount?: number;
  inLanguage?: string; // BCP-47
}

export interface DocumentContent {
  type: 'document';
  encodingFormat: string; // application/pdf, application/epub+zip, etc.
  contentSize?: number;
  wordCount?: number;
  inLanguage?: string;
}

export interface DatasetContent {
  type: 'dataset';
  encodingFormat: string; // application/x-parquet, text/csv, etc.
  contentSize?: number;
  recordSets?: CroissantRecordSet[];
  isMultiFile?: boolean;
}

export interface CroissantRecordSet {
  name: string;
  fields: CroissantField[];
}

export interface CroissantField {
  name: string;
  dataType: string; // schema.org type, e.g. "sc:Text", "sc:Integer"
}

export interface BytesContent {
  type: 'bytes';
  encodingFormat: string; // application/octet-stream typical
  contentSize?: number;
  modelArchitecture?: string; // swarm-cat extension
  parameters?: number; // swarm-cat extension
}

// --- SampleSpec ---
export interface SampleSpec {
  kind: 'subset' | 'clip' | 'thumbnail' | 'manifest';
  path: string; // relative path under /items/{itemId}/sample/
  encodingFormat?: string;
  contentSize?: number;
}

// --- Lifecycle ---
// Single source of truth: the const tuple is runtime-iterable (validation), the
// derived union preserves the exact wire-format string literals (Appendix A).
export const LIFECYCLE_VALUES = ['active', 'deprecated', 'retired'] as const;
export type Lifecycle = (typeof LIFECYCLE_VALUES)[number];

// --- CatalogItem (publisher input) ---
export interface CatalogItem {
  id: string; // equals storage.reference
  name: string;
  description: string;
  content: ContentSpec;
  storage: SwarmStorage;
  payment: PaymentRequirements[];
  sample?: SampleSpec;
  license?: string; // URL or SPDX id
  tags?: string[];
  version?: string;
  lifecycle: Lifecycle;
  supersededBy?: string; // itemId, when deprecated
  dateAdded: string; // ISO 8601
  dateModified: string; // ISO 8601
}

// --- CatalogItemState (wire) ---
// Primary purpose: track the publisher's ACT-state (current actHistoryRef + granteeRef) for one item.
// Consumer reads MUST be verification-only (never a subscription channel). Carries no analytics fields.
export interface CatalogItemState {
  itemId: string;
  actHistoryRef: string; // current ACT history reference; advances per grant
  granteeRef: string; // current grantee-list reference; advances per grant
  lifecycle: Lifecycle;
  version?: string;
  catalogRootAtUpdate?: string;
  dateModified: string;
}

// --- ActGrantResult (wire) ---
export interface ActGrantResult {
  itemId: string;
  actHistoryRef: string;
  grantTo: string; // hex pubkey
  grantorPublicKey?: string; // publisher Bee-node public key — the actPublisher a grantee needs to decrypt
  reference: string;
  txHash: string;
  grantedAt: string; // ISO 8601
  expiresAt?: string; // ISO 8601
}

// --- ApiError (wire) ---
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

// --- EIP-712 domain ---
export interface Eip712Domain {
  name: string; // "Swarm AI Data Exchange"
  version: string; // "1"
  chainId: number;
  verifyingContract: string; // 0x address
}

// --- PurchaseIntent message ---
export interface PurchaseIntentMessage {
  itemId: string;
  granteePublicKey: string; // 0x-prefixed hex of consumer's Bee-node pubkey
  payment: {
    scheme: 'exact';
    asset: string; // CAIP-19
    amount: string; // uint256 decimal string
    payTo: string; // address
  };
  nonce: string; // bytes32
  validAfter: number; // Unix seconds
  validBefore: number; // Unix seconds
}

// --- EIP-712 types descriptor ---
export const PURCHASE_INTENT_TYPES = {
  PurchaseIntent: [
    { name: 'itemId', type: 'string' },
    { name: 'granteePublicKey', type: 'bytes' },
    { name: 'payment', type: 'Payment' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'payTo', type: 'address' },
  ],
} as const;

// --- Full envelope (decoded X-Payment) ---
export interface PurchasePayload {
  x402Version: 1;
  scheme: 'exact';
  network: string; // CAIP-2
  payload: {
    purchaseIntent: {
      domain: Eip712Domain;
      types: typeof PURCHASE_INTENT_TYPES;
      primaryType: 'PurchaseIntent';
      message: PurchaseIntentMessage;
      signature: string; // 0x-prefixed
    };
    authorization: {
      from: string; // payer address
      to: string; // payee address (same as payment.payTo)
      value: string; // same as payment.amount
      validAfter: number;
      validBefore: number;
      nonce: string; // bytes32, same as message.nonce
      signature: string; // ERC-3009 signature
    };
  };
}
