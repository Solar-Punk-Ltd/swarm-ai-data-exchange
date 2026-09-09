import type { Lifecycle, PaymentRequirements } from '@solarpunk/swarm-catalog';

export interface GetAgentArgs {
  // ERC-8004 NFT token id of the agent to fetch.
  agentId: string;
  // When true, also resolve the agent's "swarm-ai-catalog" feed and enumerate its items.
  includeCatalog?: boolean;
}

// One item as enumerated from the agent's catalog Mantaray (list view, §13.2).
export interface CatalogItemSummary {
  itemId: string;
  name: string;
  description: string;
  contentType: string;
  lifecycle: Lifecycle;
  tags: string[];
  payment: PaymentRequirements[];
  hasSample: boolean;
  dateModified?: string;
  dateAdded?: string;
}

export interface AgentCatalog {
  // Catalog feed owner address from the Agent Card's "swarm-ai-catalog" service entry.
  owner: string;
  // Current Mantaray root the catalog feed resolves to. Absent on read errors.
  root?: string;
  name?: string;
  description?: string;
  license?: string;
  items: CatalogItemSummary[];
  // Every path present in the Mantaray. Diagnostic: lets a caller distinguish
  // "empty catalog" from "items exist but at unexpected paths".
  allPaths?: string[];
  // Items whose leaf is in the Mantaray but whose chunk could not be fetched — typically
  // content stamped by a since-expired postage batch. Listed rather than thrown so one
  // unreadable entry cannot make the rest of the catalog unpurchasable.
  unreadableItems?: { itemId: string; error: string }[];
  // Set instead of items when the feed exists in the card but cannot be read.
  error?: string;
}
