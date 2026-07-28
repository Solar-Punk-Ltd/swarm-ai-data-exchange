export interface CreateAgentArgs {
  // Human-readable agent name.
  name: string;
  // Short description of what the agent does.
  description: string;
  // Optional avatar image URL.
  image?: string;
  // SemVer or date string for the Agent Card revision. Defaults to "1.0.0".
  version?: string;
  // x402 service endpoint URL. When present, sets x402Support: true on the card.
  x402?: string;
  // Catalog feed owner address (0x-prefixed EOA). Published as the "swarm-ai-catalog"
  // service entry so consumers can discover the agent's catalog.
  catalogFeedOwner?: string;
  // Comma-separated tags OR a string array. Tags are advertised on the Agent Card.
  capabilities?: string | string[];
  // Override the upload postage batch; falls back to POSTAGE_BATCH_ID env.
  postageBatchId?: string;
}

export interface CreateAgentResult {
  // Minted ERC-8004 NFT token id.
  agentId: string;
  // Base Sepolia transaction hash of the mint.
  txHash: string;
  // Swarm feed URL stored on-chain; resolves to the latest Agent Card version.
  agentURI: string;
  message: string;
}
