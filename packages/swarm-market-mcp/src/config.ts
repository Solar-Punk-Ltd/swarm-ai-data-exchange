import dotenv from 'dotenv';
import { CHAIN_CAIP2 } from './chains';
import { DEFAULT_BEE_API_URL, DEFAULT_CHAIN, DEFAULT_RPC_URL } from './constants';
import { parseChainMap } from './utils';

dotenv.config({ quiet: true });

function normalizeHexKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return key.startsWith('0x') ? key : `0x${key}`;
}

export interface BeeConfig {
  endpoint: string;
  // Catalog feed signer (cold key).
  catalogFeedPrivateKey?: string;
  // Per-item state feed signer (hot key) — must differ from catalogFeedPrivateKey.
  itemStateFeedPrivateKey?: string;
  postageBatchId?: string;
}

// ERC-8004 access. rpcUrl + chain are used read-only by get_agent; walletPrivateKey is
// required by register_agent to sign the NFT mint transaction.
export interface ChainConfig {
  rpcUrl: string;
  // The primary identity chain (ERC8004_CHAIN, adapter spelling). Read tools default to it.
  chain: string;
  // Every ERC-8004 chain the seller is registered on (ERC8004_CHAINS), primary first. One Agent
  // Card is shared by all of them; register_agent converges an identity on each.
  chains: string[];
  walletPrivateKey?: string;
  // RPC per payment rail, keyed by CAIP-2 (RPC_URLS). The identity chain falls back to rpcUrl;
  // any other rail without an entry uses viem's default public RPC for that chain.
  rpcUrls: Record<string, string>;
}

// Buyer-side settlement config for purchase_catalog_item. The wallet key signs the
// EIP-712 PurchaseIntent + ERC-3009 authorization; the RPC reads the token EIP-712 domain on
// whichever rail the buyer picks.
export interface PaymentConfig {
  walletPrivateKey?: string;
  rpcUrl?: string;
  // RPC per rail, keyed by CAIP-2 (PAYMENT_RPC_URLS); rpcUrl is the fallback for every rail.
  rpcUrls: Record<string, string>;
  // Fallback x402 base endpoint when a purchase call omits x402Endpoint (the seller's
  // Agent Card is the primary source).
  x402Endpoint?: string;
}

// Per-seller revenue splitter (@solarpunk/contracts), one factory per payment rail keyed by
// CAIP-2. When a rail's factory and the seller are set, build_catalog resolves that rail's
// payment[].payTo to the seller's clone there, so listings settle through the taxed path that
// earns Proof-of-Purchase. No factories at all = legacy behaviour: payTo must be supplied.
export interface SplitterConfig {
  factoryAddresses: Record<string, string>;
  sellerAddress?: string;
}

// ERC8004_CHAINS, deduplicated, with the primary ERC8004_CHAIN always first: it must be present
// because every single-chain caller (get_agent, the splitter link default) reads it.
function identityChains(primary: string): string[] {
  const listed = (process.env.ERC8004_CHAINS ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return [primary, ...listed.filter((c, i) => c !== primary && listed.indexOf(c) === i)];
}

// SPLITTER_FACTORY_ADDRESSES supersedes the single-rail SPLITTER_FACTORY_ADDRESS, which still
// works as "the factory on ERC8004_CHAIN" so an existing .env keeps publishing taxed listings.
function factoryAddresses(chain: string): Record<string, string> {
  const map = parseChainMap(process.env.SPLITTER_FACTORY_ADDRESSES, 'SPLITTER_FACTORY_ADDRESSES');
  const legacy = process.env.SPLITTER_FACTORY_ADDRESS;
  if (Object.keys(map).length === 0 && legacy) {
    const caip2 = CHAIN_CAIP2[chain];
    if (!caip2) {
      throw new Error(
        `SPLITTER_FACTORY_ADDRESS is set but ERC8004_CHAIN "${chain}" has no CAIP-2 mapping; ` +
          'use SPLITTER_FACTORY_ADDRESSES=<caip2>=<address> instead.',
      );
    }
    map[caip2] = legacy;
  }
  return map;
}

export interface Config {
  bee: BeeConfig;
  chain: ChainConfig;
  payment: PaymentConfig;
  splitter: SplitterConfig;
}

const config: Config = {
  bee: {
    endpoint: process.env.BEE_API_URL || DEFAULT_BEE_API_URL,
    catalogFeedPrivateKey: normalizeHexKey(process.env.BEE_FEED_PK),
    itemStateFeedPrivateKey: normalizeHexKey(process.env.ITEM_STATE_FEED_PK),
    postageBatchId: process.env.POSTAGE_BATCH_ID,
  },
  chain: {
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC_URL,
    chain: process.env.ERC8004_CHAIN || DEFAULT_CHAIN,
    chains: identityChains(process.env.ERC8004_CHAIN || DEFAULT_CHAIN),
    walletPrivateKey: normalizeHexKey(process.env.PRIVATE_KEY),
    rpcUrls: parseChainMap(process.env.RPC_URLS, 'RPC_URLS'),
  },
  payment: {
    walletPrivateKey: process.env.BUYER_WALLET_PK,
    rpcUrl: process.env.PAYMENT_RPC_URL,
    rpcUrls: parseChainMap(process.env.PAYMENT_RPC_URLS, 'PAYMENT_RPC_URLS'),
    x402Endpoint: process.env.X402_ENDPOINT,
  },
  splitter: {
    factoryAddresses: factoryAddresses(process.env.ERC8004_CHAIN || DEFAULT_CHAIN),
    sellerAddress: process.env.AGENT_PAYMENT_ADDRESS,
  },
};

export default config;
