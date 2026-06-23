import dotenv from 'dotenv';
import { DEFAULT_BEE_API_URL } from './constants';

dotenv.config({ quiet: true });

export interface BeeConfig {
  endpoint: string;
  // Catalog feed signer (cold key).
  catalogFeedPrivateKey?: string;
  // Per-item state feed signer (hot key) — must differ from catalogFeedPrivateKey.
  itemStateFeedPrivateKey?: string;
  postageBatchId?: string;
}

export interface Config {
  bee: BeeConfig;
}

const config: Config = {
  bee: {
    endpoint: process.env.BEE_API_URL || DEFAULT_BEE_API_URL,
    catalogFeedPrivateKey: process.env.BEE_FEED_PK,
    itemStateFeedPrivateKey: process.env.ITEM_STATE_FEED_PK,
    postageBatchId: process.env.POSTAGE_BATCH_ID,
  },
};

export default config;
