export interface FindAgentsByMetadataArgs {
  // Semantic mode: filter by an agent's catalog feed owner address (0x-prefixed EOA).
  // Under the hood, this maps to metadataKey=SWARM_AGENT_ID, metadataValue=<lowercased owner>.
  // Prefer this over raw metadataKey when locating an agent by its catalog feed identity.
  catalogFeedOwner?: string;
  // Raw mode: ERC-8004 metadata key to scan (e.g. "swarm_ai_capable"). Required when
  // catalogFeedOwner is not provided.
  metadataKey?: string;
  // Optional utf-8 filter applied client-side. Only agents whose stored value decodes
  // to this string are returned. Ignored in semantic (catalogFeedOwner) mode.
  metadataValue?: string;
  // Optional starting block for the event scan. Defaults to a recent window (see
  // RECENT_BLOCK_COUNT in the adapter) so casual lookups stay fast.
  fromBlock?: number;
}

export interface FindAgentsByMetadataResultEntry {
  agentId: string;
  agentURI: string;
  owner: string;
  // Utf-8 decode of the raw metadata bytes. Non-utf-8 bytes are replaced with U+FFFD.
  metadataValue: string;
}

export interface FindAgentsByMetadataResult {
  metadataKey: string;
  agents: FindAgentsByMetadataResultEntry[];
  // Entries whose on-chain owner could not be read (burned/nonexistent token). Reported
  // rather than dropped silently so a caller can tell "no match" from "match unreadable".
  unresolved?: { agentId: string; error: string }[];
}
