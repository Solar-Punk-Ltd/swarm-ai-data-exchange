import 'dotenv/config';

// Server configuration loaded from the environment. Fail fast on missing required values.
export interface ServerConfig {
  port: number;
  paymentAddress: string;
  network: string; // CAIP-2, e.g. "eip155:84532"
  chainId: number; // numeric chain id parsed from network
  facilitatorUrl: string;
  purchaseIntentDomainContract: string;
  beeApiUrl: string;
  postageBatchId: string;
  catalogFeedOwner: string;
  itemStateFeedPk: string;
  dbPath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// CAIP-2 "eip155:84532" → 84532
export function parseChainId(caip2: string): number {
  const parts = caip2.split(':');
  const id = Number(parts[parts.length - 1]);
  if (!Number.isInteger(id)) {
    throw new Error(`Invalid CAIP-2 network identifier: ${caip2}`);
  }
  return id;
}

export function loadConfig(): ServerConfig {
  const network = process.env.NETWORK ?? 'eip155:84532';
  return {
    port: Number(process.env.PORT ?? 3000),
    paymentAddress: required('PAYMENT_ADDRESS'),
    network,
    chainId: parseChainId(network),
    facilitatorUrl: process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator',
    purchaseIntentDomainContract: required('PURCHASE_INTENT_DOMAIN_CONTRACT'),
    beeApiUrl: process.env.BEE_API_URL ?? 'http://localhost:1633',
    postageBatchId: required('POSTAGE_BATCH_ID'),
    catalogFeedOwner: required('CATALOG_FEED_OWNER'),
    itemStateFeedPk: required('ITEM_STATE_FEED_PK'),
    dbPath: process.env.DB_PATH ?? './data/store.db',
  };
}
