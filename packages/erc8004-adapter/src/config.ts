import 'dotenv/config';
import { DEFAULT_BEE_API_URL, DEFAULT_CHAIN, DEFAULT_RPC_URL } from './constants';

export interface ChainConfig {
  /** JSON-RPC endpoint for the target network */
  rpcUrl: string;
  /** ERC-8004 chain identifier passed to createERC8004Client */
  chain: string;
  /** Provider wallet private key — used to register agents and sign FeedbackAuth */
  privateKey?: string;
}

export interface BeeConfig {
  /** Bee node HTTP API base URL */
  endpoint: string;
  /**
   * Private key used to sign Swarm feed updates when uploading Agent Cards.
   * Maps to BEE_FEED_PK environment variable.
   */
  feedPrivateKey?: string;
  /**
   * Postage stamp batch ID (64-char hex) used for Swarm uploads.
   * Maps to BEE_POSTAGE_STAMP environment variable.
   */
  postageBatchId?: string;
}

export interface ERC8004AdapterConfig {
  chain: ChainConfig;
  bee: BeeConfig;
}

const config: ERC8004AdapterConfig = {
  chain: {
    rpcUrl: process.env.RPC_URL ?? DEFAULT_RPC_URL,
    chain: process.env.CHAIN ?? DEFAULT_CHAIN,
    privateKey: process.env.PRIVATE_KEY,
  },

  bee: {
    endpoint: process.env.BEE_API_URL ?? DEFAULT_BEE_API_URL,
    feedPrivateKey: process.env.BEE_FEED_PK,
    postageBatchId: process.env.BEE_POSTAGE_STAMP,
  },
};

export default config;
