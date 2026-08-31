export interface LinkSplitContractArgs {
  // ERC-8004 agent id (NFT token id) to bind. The caller must own this NFT.
  agentId: string;
  // Splitter clone to link. Defaults to the clone resolved for AGENT_PAYMENT_ADDRESS.
  splitter?: string;
  // Seller whose clone to resolve when splitter is omitted. Defaults to AGENT_PAYMENT_ADDRESS.
  seller?: string;
}

export interface LinkSplitContractResult {
  agentId: string;
  splitter: string;
  seller?: string;
  factory?: string;
  txHash: string;
  metadataKey: string;
  // True when the agent already pointed at this exact splitter before the write.
  alreadyLinked: boolean;
}
