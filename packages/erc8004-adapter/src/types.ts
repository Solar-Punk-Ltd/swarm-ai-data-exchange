import type { Signer, Provider } from 'ethers';

export interface ERC8004Config {
  provider: Provider;
  signer?: Signer;
  chain: 'base-sepolia' | 'base' | 'mainnet' | (string & {});
  contracts?: {
    identityRegistry?: string;
    reputationRegistry?: string;
  };
}

export interface AgentEndpoints {
  mcp?: string; // Swarm MCP endpoint, e.g. bzz://<hash>
  x402?: string; // x402 payment server URL
  a2a?: string; // Agent-to-Agent protocol endpoint
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  endpoints: AgentEndpoints;
  supportedTrust: string[];
  owner?: string;
}

export interface AgentCardParams {
  name: string;
  description: string;
  capabilities: string[];
  endpoints: AgentEndpoints;
  version?: string;
  supportedTrust?: string[];
  owner?: string;
}

export interface RegisterResult {
  agentId: bigint;
  txHash: string;
}

export interface PostFeedbackParams {
  agentId: bigint;
  score: number; // 0–100
  tags?: [string?, string?];
  evidenceURI?: string; // bzz://<hash> or https://...
  feedbackAuth?: FeedbackAuth;
  endpoint?: string;
}

// Off-chain authorization: provider signs this so only authorised consumers can post feedback.
export interface FeedbackAuth {
  agentId: bigint;
  consumer: string; // consumer wallet address
  deadline: number; // unix timestamp
  signature: string; // EIP-712 sig from the provider wallet
}

export interface FeedbackResult {
  value: bigint;
  valueDecimals: number;
  score: number; // normalized 0–100
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface ReputationSummary {
  count: bigint;
  averageScore: number; // normalized 0–100
  rawValue: bigint;
  rawDecimals: number;
}

export interface ReputationScore {
  agentId: bigint;
  score: number; // 0–100 aggregated
  feedbackCount: bigint;
  reliable: boolean; // score >= 70 and count >= 3
}

export interface SwarmUploadResult {
  /** 64-char hex content hash of the uploaded payload */
  reference: string;
  /** bzz://<reference> — direct immutable link to this version of the card */
  url: string;
  /** Bee API feed URL — resolves to the latest card version via owner + topic */
  feedUrl: string;
}
