/**
 * Parsed, validated environment. Read once at module load so a misconfiguration fails loudly at
 * boot rather than rendering an empty dashboard.
 *
 * Everything here is a Vite build-time var and public by definition — there is no secret in this
 * package.
 */
import { isAddress, getAddress } from 'viem';
import type { Address, Chain } from 'viem';
import { chainById, SUPPORTED_CHAIN_IDS } from './chain';
import { CURRENCIES } from './currencies';
import type { Currency } from './currencies';
import { DEFAULT_LOG_CHUNK_BLOCKS, IDENTITY_REGISTRIES } from './registry';

export interface AppConfig {
  treasury: Address;
  factory: Address;
  chain: Chain;
  rpcUrl: string;
  refreshIntervalMs: number;
  currencies: Currency[];
  /** Gateway used to resolve `bzz://` Agent Card URIs. Cards are fetched best-effort. */
  swarmGateway: string;
  /**
   * catalogue-feed-browser base URL, used for the per-seller catalog link. Undefined falls back
   * to the raw Swarm feed URL, which resolves but does not render items.
   */
  catalogueBrowserUrl?: string;
  /**
   * ERC-8004 Identity Registry, when one is known for this chain. Undefined disables agent
   * labelling — the link is supplementary and must never block the dashboard.
   */
  identityRegistry?: {
    address: Address;
    fromBlock: bigint;
    chunkBlocks: bigint;
  };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
  }
}

const DEFAULT_CHAIN_ID = 84532;
const DEFAULT_RPC_URL = 'https://sepolia.base.org';
const DEFAULT_REFRESH_MS = 5000;
const DEFAULT_SWARM_GATEWAY = 'https://api.gateway.ethswarm.org';
// Matches CATALOGUE_FEED_BROWSER_URL in erc8004-dashboard/src/constants.ts.
const DEFAULT_CATALOGUE_BROWSER = 'http://localhost:3001';

function requireAddress(raw: string | undefined, name: string, problems: string[]): Address {
  if (!raw) {
    problems.push(`${name} is not set.`);
    return '0x';
  }
  if (!isAddress(raw)) {
    problems.push(`${name} is not a valid address: "${raw}"`);
    return '0x';
  }
  return getAddress(raw);
}

/**
 * Identity Registry for agent labelling. Optional everywhere: an unset or unknown registry means
 * seller rows show no agent, which is a degraded view rather than a broken one.
 */
function parseRegistry(chainId: number, problems: string[]): AppConfig['identityRegistry'] {
  const env = import.meta.env;
  const known = IDENTITY_REGISTRIES[chainId];
  const raw = env.VITE_IDENTITY_REGISTRY_ADDRESS || known?.address;
  if (!raw) return undefined;

  if (!isAddress(raw)) {
    problems.push(`VITE_IDENTITY_REGISTRY_ADDRESS is not a valid address: "${raw}"`);
    return undefined;
  }

  const fromBlockRaw = env.VITE_IDENTITY_REGISTRY_FROM_BLOCK;
  const fromBlock = fromBlockRaw ? Number(fromBlockRaw) : (known?.deployBlock ?? 0);
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    problems.push(`VITE_IDENTITY_REGISTRY_FROM_BLOCK must be a non-negative integer.`);
    return undefined;
  }

  const chunkRaw = env.VITE_LOG_CHUNK_BLOCKS;
  const chunkBlocks = chunkRaw ? Number(chunkRaw) : DEFAULT_LOG_CHUNK_BLOCKS;
  if (!Number.isInteger(chunkBlocks) || chunkBlocks < 1) {
    problems.push(`VITE_LOG_CHUNK_BLOCKS must be a positive integer.`);
    return undefined;
  }

  return {
    address: getAddress(raw),
    fromBlock: BigInt(fromBlock),
    chunkBlocks: BigInt(chunkBlocks),
  };
}

function parseConfig(): AppConfig {
  const problems: string[] = [];
  const env = import.meta.env;

  const treasury = requireAddress(env.VITE_TREASURY_ADDRESS, 'VITE_TREASURY_ADDRESS', problems);
  const factory = requireAddress(
    env.VITE_SPLITTER_FACTORY_ADDRESS,
    'VITE_SPLITTER_FACTORY_ADDRESS',
    problems,
  );

  const chainId = env.VITE_CHAIN_ID ? Number(env.VITE_CHAIN_ID) : DEFAULT_CHAIN_ID;
  const chain = chainById(chainId);
  if (!chain) {
    problems.push(
      `VITE_CHAIN_ID ${env.VITE_CHAIN_ID} is not supported. Expected one of ${SUPPORTED_CHAIN_IDS.join(', ')}.`,
    );
  }

  const currencies = CURRENCIES[chainId];
  if (chain && !currencies) {
    problems.push(`No currency config for chain ${chainId}. Add one to src/config/currencies.ts.`);
  }

  const refreshRaw = env.VITE_REFRESH_INTERVAL_MS;
  const refreshIntervalMs = refreshRaw ? Number(refreshRaw) : DEFAULT_REFRESH_MS;
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs < 1000) {
    problems.push(
      `VITE_REFRESH_INTERVAL_MS must be a number >= 1000 (got "${refreshRaw}"). Faster polling will hit RPC rate limits.`,
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    treasury,
    factory,
    chain: chain!,
    rpcUrl: env.VITE_RPC_URL || DEFAULT_RPC_URL,
    refreshIntervalMs,
    currencies: currencies!,
    swarmGateway: env.VITE_SWARM_GATEWAY_URL || DEFAULT_SWARM_GATEWAY,
    catalogueBrowserUrl: env.VITE_CATALOGUE_FEED_BROWSER_URL || DEFAULT_CATALOGUE_BROWSER,
    identityRegistry: parseRegistry(chainId, problems),
  };
}

/** Throws ConfigError at import time; App renders the message instead of a blank page. */
export let config: AppConfig;
export let configError: ConfigError | undefined;

try {
  config = parseConfig();
} catch (err) {
  configError = err as ConfigError;
  config = undefined as unknown as AppConfig;
}
