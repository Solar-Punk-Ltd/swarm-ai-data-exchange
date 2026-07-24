export interface FindAgentsByMetadataArgs {
  // ERC-8004 metadata key to scan (e.g. "swarm_agent_id", "swarm_ai_capable").
  metadataKey: string;
  // Optional utf-8 filter applied client-side to metadataValue. When set, only agents
  // whose stored value decodes to this string are returned.
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
}
