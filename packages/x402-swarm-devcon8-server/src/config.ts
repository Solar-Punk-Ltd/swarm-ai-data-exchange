import 'dotenv/config';
import { PrivateKey } from '@ethersphere/bee-js';

// Server configuration loaded from the environment. Fail fast on missing required values.
export interface ServerConfig {
  port: number;
  network: string; // CAIP-2, e.g. "eip155:84532"
  chainId: number; // numeric chain id parsed from network
  facilitatorUrl: string;
  purchaseIntentDomainContract: string;
  beeApiUrl: string;
  postageBatchId: string;
  catalogFeedOwner: string;
  itemStateFeedPk: string;
  // EOA of itemStateFeedPk — the per-item state feed is owned by the hot key, so reads must
  // address this owner (the topic stays bound to catalogFeedOwner).
  itemStateFeedOwner: string;
  dbPath: string;
  // This seller's RevenueSplitter clone — the only settlement destination that earns valid
  // Proof-of-Purchase. When set, a purchase whose advertised payTo is anything else is
  // rejected before /settle. Optional so dev setups without a deployed factory still run.
  splitterAddress?: string;
  // State-feed write retry (§14.1: the publisher MUST retry until the on-Swarm record converges).
  // Bounded in-memory exponential backoff; durable retry across restarts is out of prototype scope.
  stateFeedRetry: { attempts: number; baseDelayMs: number; maxDelayMs: number };
  // How long a cached catalog entry (price terms, description, lifecycle) stays usable. It is
  // NOT a staleness window in the usual sense: catalog entries are content-addressed, so an
  // edited item gets a new itemId and a new cache key. This only bounds how long after an item
  // is published this server can still fail to see it. See CatalogCache.
  catalogEntryTtlMs: number;
  // ── devcon8 voucher funding ────────────────────────────────────────────────────────────
  // This server IS the voucher vendor — there is no enable flag. Every settled purchase mints
  // a wallet in memory, funds it from the funder below, and returns the private key in the
  // response. GIFT_FUNDER_PK moves REAL xBZZ and xDAI on Gnosis mainnet: it must never be the
  // testnet funder, and the server refuses to start without it.
  giftRpcUrl: string;
  giftChainId: number;
  giftFunderPk: string;
  giftXbzzAddress: string;
  // Amounts stay strings end to end (viem parseUnits): float math on token amounts truncates.
  giftXbzzAmount: string;
  giftXdaiAmount: string;
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
  const itemStateFeedPk = required('ITEM_STATE_FEED_PK');
  return {
    port: Number(process.env.PORT ?? 3000),
    network,
    chainId: parseChainId(network),
    facilitatorUrl: process.env.FACILITATOR_URL ?? 'https://x402.org/facilitator',
    purchaseIntentDomainContract: required('PURCHASE_INTENT_DOMAIN_CONTRACT'),
    beeApiUrl: process.env.BEE_API_URL ?? 'http://localhost:1633',
    postageBatchId: required('POSTAGE_BATCH_ID'),
    catalogFeedOwner: required('CATALOG_FEED_OWNER'),
    itemStateFeedPk,
    itemStateFeedOwner: '0x' + new PrivateKey(itemStateFeedPk).publicKey().address().toHex(),
    dbPath: process.env.DB_PATH ?? './data/store.db',
    splitterAddress: process.env.SPLITTER_ADDRESS,
    stateFeedRetry: {
      attempts: Number(process.env.STATE_FEED_RETRY_ATTEMPTS ?? 8),
      baseDelayMs: Number(process.env.STATE_FEED_RETRY_BASE_MS ?? 500),
      maxDelayMs: Number(process.env.STATE_FEED_RETRY_MAX_MS ?? 30_000),
    },
    catalogEntryTtlMs: Number(process.env.CATALOG_ENTRY_TTL_MS ?? 300_000),
    giftRpcUrl: process.env.GIFT_RPC_URL ?? 'https://rpc.gnosischain.com',
    giftChainId: Number(process.env.GIFT_CHAIN_ID ?? 100),
    giftFunderPk: required('GIFT_FUNDER_PK'),
    giftXbzzAddress: process.env.GIFT_XBZZ_ADDRESS ?? '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da',
    giftXbzzAmount: process.env.GIFT_XBZZ_AMOUNT ?? '0.001',
    giftXdaiAmount: process.env.GIFT_XDAI_AMOUNT ?? '0.001',
  };
}
