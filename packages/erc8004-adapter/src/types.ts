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

export interface MetadataEntry {
  metadataKey: string;
  metadataValue: Uint8Array;
}

export interface AgentService {
  name: string; // e.g. "MCP", "A2A", "web", "email"
  endpoint: string; // The service endpoint URL or identifier
  version?: string; // SHOULD - e.g. "0.3.0", "2025-06-18"
  skills?: string[]; // OPTIONAL
  domains?: string[]; // OPTIONAL
}

export interface AgentRegistration {
  agentId: bigint;
  agentRegistry: string; // e.g. "eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f42e99"
}

export interface AgentCard {
  type: string; // MUST be "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  name: string;
  description: string;
  image?: string; // OPTIONAL - e.g. "https://example.com/agentimage.png"
  services: AgentService[];
  x402Support: boolean;
  active: boolean;
  registrations: AgentRegistration[];
  supportedTrust?: string[]; // OPTIONAL - e.g. ["reputation", "crypto-economic"]
}

export interface AgentCardParams {
  name: string;
  description: string;
  services: AgentService[];
  type?: string; // Defaults to "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  image?: string;
  x402Support?: boolean; // Defaults to false
  active?: boolean; // Defaults to true
  registrations?: AgentRegistration[];
  supportedTrust?: string[];
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

// Off-chain authorization: new wallet signs this to consent to being registered as the agent wallet.
export interface WalletAuth {
  agentId: bigint;
  wallet: string; // new hot wallet address
  deadline: number; // unix timestamp
  signature: string; // EIP-712 sig from the new wallet
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
