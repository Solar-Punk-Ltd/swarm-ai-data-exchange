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

export interface AppConfig {
  treasury: Address;
  factory: Address;
  chain: Chain;
  rpcUrl: string;
  refreshIntervalMs: number;
  currencies: Currency[];
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
