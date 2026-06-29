import dotenv from 'dotenv';
import { DEFAULT_BEE_API_URL, DEFAULT_CHAIN, DEFAULT_RPC_URL } from './constants';

dotenv.config({ quiet: true });

export interface BeeConfig {
  endpoint: string;
  // Catalog feed signer (cold key).
  catalogFeedPrivateKey?: string;
  // Per-item state feed signer (hot key) — must differ from catalogFeedPrivateKey.
  itemStateFeedPrivateKey?: string;
  postageBatchId?: string;
}

// Read-only ERC-8004 access for resolving an agent id → Agent Card (get_agent).
export interface ChainConfig {
  rpcUrl: string;
  chain: string;
}

export interface Config {
  bee: BeeConfig;
  chain: ChainConfig;
}

const config: Config = {
  bee: {
    endpoint: process.env.BEE_API_URL || DEFAULT_BEE_API_URL,
    catalogFeedPrivateKey: process.env.BEE_FEED_PK,
    itemStateFeedPrivateKey: process.env.ITEM_STATE_FEED_PK,
    postageBatchId: process.env.POSTAGE_BATCH_ID,
  },
  chain: {
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC_URL,
    chain: process.env.ERC8004_CHAIN || DEFAULT_CHAIN,
  },
};

export default config;
