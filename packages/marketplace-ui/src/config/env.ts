/**
 * Parsed, validated environment. Read once at module load so a misconfiguration fails loudly at
 * boot rather than rendering an empty dashboard.
 *
 * Everything here is a Vite build-time var and public by definition — there is no secret in this
 * package.
 *
 * Several chains can be configured at once (`VITE_CHAIN_IDS`), each with its own factory,
 * treasury and RPC under a chain-id-suffixed var (`VITE_SPLITTER_FACTORY_ADDRESS_11142220`).
 * Every listed chain is validated at boot, but `config` describes exactly one of them: the chain
 * the viewer selected (`?chain=`, then localStorage, then the default). Switching reloads the
 * page — `config` is a module singleton read by every component, so a live swap would mean
 * threading a context through all of them for a sub-second saving.
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
  /** Every chain the dropdown offers, in `VITE_CHAIN_IDS` order. Always contains `chain`. */
  chains: { id: number; name: string }[];
  refreshIntervalMs: number;
  currencies: Currency[];
  /**
   * Gateway used to resolve `bzz://` Agent Card URIs and the per-seller catalog link. Both are
   * fetched best-effort. A catalog only resolves on a node that holds it, so a local Bee
   * (`http://localhost:1633`) is usually the right value while developing.
   */
  swarmGateway: string;
  /**
   * Devcon demo pages (`/devcon`, `/claim-wallet`). Off by default — they are demo scaffolding,
   * not product surface, so the nav item and both routes disappear when this is false.
   */
  showDemoFlow: boolean;
  /**
   * Base URL the `/devcon` QR code points at. Undefined means `window.location.origin`, which is
   * only scannable when the dashboard is served over the network — a phone cannot resolve
   * localhost. Stored without a trailing slash.
   */
  demoFlowBaseUrl?: string;
  /**
   * agent-orchestration-api base URL (e.g. `http://192.168.1.20:8000`), which the Claim Wallet
   * page calls to have a buyer agent deployed for the visitor. Only read when the demo flow is on.
   *
   * Undefined leaves that page saying it is not configured — it must never block the dashboard,
   * and unlike the chain reads this is a service that may simply not be running.
   */
  devconApiUrl?: string;
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
/**
 * Per-chain RPC defaults. Chains absent here fall back to viem's `rpcUrls.default`.
 *
 * Base Sepolia is not `https://sepolia.base.org`, which was the default until it was measured: it
 * is fronted by QuickNode with a 25-calls-per-second cap that counts each element of a JSON-RPC
 * batch separately, so every tick lost exactly the calls past 25 and the dashboard never
 * refreshed. Reads are aggregated through Multicall3 now and fit comfortably either way, but there
 * is no reason to default to the endpoint with the tightest cap.
 */
const DEFAULT_RPC_URLS: Record<number, string> = {
  84532: 'https://base-sepolia-rpc.publicnode.com',
  11142220: 'https://forno.celo-sepolia.celo-testnet.org',
};
const DEFAULT_REFRESH_MS = 5000;
const DEFAULT_SWARM_GATEWAY = 'https://api.gateway.ethswarm.org';

/** Where the viewer's chain choice lives between visits. Read by `ChainSelect`, too. */
export const CHAIN_STORAGE_KEY = 'marketplace.chainId';
/** Query parameter that pins a chain in a link. Wins over localStorage. */
export const CHAIN_QUERY_PARAM = 'chain';

/** `import.meta.env` is typed with fixed keys; suffixed lookups need the open form. */
type Env = Record<string, string | undefined>;

/**
 * A per-chain var: `VITE_X_<chainId>`, falling back to the unsuffixed `VITE_X` for the default
 * chain only. Keeps a single-chain `.env` working unchanged, without letting the default chain's
 * factory silently stand in for a chain that has none.
 */
function envFor(env: Env, name: string, chainId: number, isDefault: boolean): string | undefined {
  const suffixed = env[`${name}_${chainId}`];
  if (suffixed) return suffixed;
  return isDefault ? env[name] : undefined;
}

/** The var name a problem should cite, so the fix is a copy-paste. */
function envName(name: string, chainId: number, isDefault: boolean): string {
  return isDefault ? `${name}_${chainId} (or ${name})` : `${name}_${chainId}`;
}

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

/** Accepts only "true"/"false" — a typo must fail loudly rather than silently read as off. */
function parseBool(raw: string | undefined, name: string, problems: string[]): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  problems.push(`${name} must be "true" or "false" (got "${raw}").`);
  return false;
}

/**
 * A demo-flow URL. Only validated when the demo flow is on: a stale value left behind an off flag
 * must not stop the dashboard from booting.
 *
 * Trailing slashes are stripped because every caller appends its own path — the QR builder adds
 * `/claim-wallet` and the claim client adds `/devcon/...`, and a trailing slash would double it.
 */
function parseDemoUrl(
  raw: string | undefined,
  enabled: boolean,
  name: string,
  problems: string[],
): string | undefined {
  if (!raw || !enabled) return undefined;
  try {
    new URL(raw);
  } catch {
    problems.push(`${name} is not a valid URL: "${raw}"`);
    return undefined;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Identity Registry for agent labelling. Optional everywhere: an unset or unknown registry means
 * seller rows show no agent, which is a degraded view rather than a broken one.
 */
function parseRegistry(
  env: Env,
  chainId: number,
  isDefault: boolean,
  problems: string[],
): AppConfig['identityRegistry'] {
  const known = IDENTITY_REGISTRIES[chainId];
  const raw = envFor(env, 'VITE_IDENTITY_REGISTRY_ADDRESS', chainId, isDefault) || known?.address;
  if (!raw) return undefined;

  if (!isAddress(raw)) {
    problems.push(
      `${envName('VITE_IDENTITY_REGISTRY_ADDRESS', chainId, isDefault)} is not a valid address: "${raw}"`,
    );
    return undefined;
  }

  const fromBlockRaw = envFor(env, 'VITE_IDENTITY_REGISTRY_FROM_BLOCK', chainId, isDefault);
  const fromBlock = fromBlockRaw ? Number(fromBlockRaw) : (known?.deployBlock ?? 0);
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    problems.push(
      `${envName('VITE_IDENTITY_REGISTRY_FROM_BLOCK', chainId, isDefault)} must be a non-negative integer.`,
    );
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

/** Everything that differs per chain. One is built per `VITE_CHAIN_IDS` entry. */
interface ChainSettings {
  chain: Chain;
  factory: Address;
  treasury: Address;
  rpcUrl: string;
  currencies: Currency[];
  identityRegistry?: AppConfig['identityRegistry'];
}

/**
 * The chains offered: `VITE_CHAIN_IDS` as a comma list, else just the default chain. Unknown ids
 * are reported, not skipped — a dropdown entry that cannot be rendered is a config bug, not a
 * preference.
 */
function parseChainIds(env: Env, defaultChainId: number, problems: string[]): number[] {
  const raw = env.VITE_CHAIN_IDS;
  if (!raw) return [defaultChainId];
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const text = part.trim();
    if (!text) continue;
    const id = Number(text);
    if (!Number.isInteger(id) || !chainById(id)) {
      problems.push(
        `VITE_CHAIN_IDS entry "${text}" is not supported. Expected one of ${SUPPORTED_CHAIN_IDS.join(', ')}.`,
      );
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) problems.push('VITE_CHAIN_IDS lists no supported chain.');
  return ids;
}

function parseChainSettings(
  env: Env,
  chainId: number,
  isDefault: boolean,
  problems: string[],
): ChainSettings | undefined {
  const chain = chainById(chainId);
  if (!chain) return undefined;

  const currencies = CURRENCIES[chainId];
  if (!currencies) {
    problems.push(`No currency config for chain ${chainId}. Add one to src/config/currencies.ts.`);
  }

  const treasury = requireAddress(
    envFor(env, 'VITE_TREASURY_ADDRESS', chainId, isDefault),
    envName('VITE_TREASURY_ADDRESS', chainId, isDefault),
    problems,
  );
  const factory = requireAddress(
    envFor(env, 'VITE_SPLITTER_FACTORY_ADDRESS', chainId, isDefault),
    envName('VITE_SPLITTER_FACTORY_ADDRESS', chainId, isDefault),
    problems,
  );
  const rpcUrl =
    envFor(env, 'VITE_RPC_URL', chainId, isDefault) ||
    DEFAULT_RPC_URLS[chainId] ||
    chain.rpcUrls.default.http[0];

  return {
    chain,
    factory,
    treasury,
    rpcUrl,
    currencies: currencies ?? [],
    identityRegistry: parseRegistry(env, chainId, isDefault, problems),
  };
}

/**
 * The viewer's chain: `?chain=` in the URL, then the remembered choice, then the default. Anything
 * unknown falls back rather than failing boot — a stale link or a localStorage value from before a
 * chain was removed must not blank the dashboard.
 */
export function selectChainId(offered: number[], defaultChainId: number): number {
  if (typeof window === 'undefined') return defaultChainId;
  const candidates: (string | null | undefined)[] = [];
  try {
    candidates.push(new URL(window.location.href).searchParams.get(CHAIN_QUERY_PARAM));
  } catch {
    // An unparsable location is not worth more than the default.
  }
  try {
    candidates.push(window.localStorage.getItem(CHAIN_STORAGE_KEY));
  } catch {
    // Private windows and blocked storage throw on access; the default is the right answer.
  }
  for (const raw of candidates) {
    if (!raw) continue;
    const id = Number(raw);
    if (offered.includes(id)) return id;
  }
  return defaultChainId;
}

function parseConfig(): AppConfig {
  const problems: string[] = [];
  const env = import.meta.env as unknown as Env;

  const defaultRaw = env.VITE_CHAIN_ID;
  const defaultChainId = defaultRaw ? Number(defaultRaw) : DEFAULT_CHAIN_ID;
  if (!chainById(defaultChainId)) {
    problems.push(
      `VITE_CHAIN_ID ${defaultRaw} is not supported. Expected one of ${SUPPORTED_CHAIN_IDS.join(', ')}.`,
    );
  }

  const chainIds = parseChainIds(env, defaultChainId, problems);
  // An explicit default that is not offered is a contradiction; an implicit one just means the
  // first listed chain is the default.
  const effectiveDefault = chainIds.includes(defaultChainId) ? defaultChainId : chainIds[0];
  if (defaultRaw && !chainIds.includes(defaultChainId)) {
    problems.push(`VITE_CHAIN_ID ${defaultRaw} is not in VITE_CHAIN_IDS (${chainIds.join(', ')}).`);
  }

  const settings = new Map<number, ChainSettings>();
  for (const id of chainIds) {
    const parsed = parseChainSettings(env, id, id === effectiveDefault, problems);
    if (parsed) settings.set(id, parsed);
  }

  const refreshRaw = env.VITE_REFRESH_INTERVAL_MS;
  const refreshIntervalMs = refreshRaw ? Number(refreshRaw) : DEFAULT_REFRESH_MS;
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs < 1000) {
    problems.push(
      `VITE_REFRESH_INTERVAL_MS must be a number >= 1000 (got "${refreshRaw}"). Faster polling will hit RPC rate limits.`,
    );
  }

  const showDemoFlow = parseBool(env.VITE_SHOW_DEMO_FLOW, 'VITE_SHOW_DEMO_FLOW', problems);
  const demoFlowBaseUrl = parseDemoUrl(
    env.VITE_DEMO_FLOW_BASE_URL,
    showDemoFlow,
    'VITE_DEMO_FLOW_BASE_URL',
    problems,
  );
  const devconApiUrl = parseDemoUrl(
    env.VITE_DEVCON_API_URL,
    showDemoFlow,
    'VITE_DEVCON_API_URL',
    problems,
  );

  if (problems.length > 0) throw new ConfigError(problems);

  const selected = settings.get(selectChainId(chainIds, effectiveDefault))!;

  return {
    treasury: selected.treasury,
    factory: selected.factory,
    chain: selected.chain,
    rpcUrl: selected.rpcUrl,
    chains: chainIds.map((id) => ({ id, name: settings.get(id)!.chain.name })),
    refreshIntervalMs,
    currencies: selected.currencies,
    swarmGateway: env.VITE_SWARM_GATEWAY_URL || DEFAULT_SWARM_GATEWAY,
    showDemoFlow,
    demoFlowBaseUrl,
    devconApiUrl,
    identityRegistry: selected.identityRegistry,
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
