import type { Account, Address, Chain, Hash, PublicClient, WalletClient } from 'viem';
import { getAddress } from 'viem';
import { REVENUE_SPLITTER_ABI, SPLITTER_FACTORY_ABI } from './abis';

export { REVENUE_SPLITTER_ABI, SPLITTER_FACTORY_ABI } from './abis';
export {
  SPLITTER_DEPLOYMENTS,
  chainKeyFromCaip2,
  resolveFactoryAddress,
  type SplitterDeployment,
} from './addresses';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Denominator for `taxBps` — mirrors SPLITTER_BPS_DENOMINATOR in RevenueSplitter.sol. */
export const BPS_DENOMINATOR = 10_000;

/** Ceiling enforced on-chain — mirrors SPLITTER_MAX_TAX_BPS in RevenueSplitter.sol. */
export const MAX_TAX_BPS = 2_000;

/** "To the end of the registry" sentinel for the paginated factory calls, which clamp `limit`. */
export const MAX_UINT256 = 2n ** 256n - 1n;

export interface SplitterTerms {
  seller: Address;
  treasury: Address;
  taxBps: number;
}

/** A wallet client that already carries an account and chain, so writes need no extra args. */
type ReadyWalletClient = WalletClient & { account: Account; chain: Chain };

/**
 * The seller's deployed splitter, or `undefined` if it has not been created yet.
 *
 * This is the only way to resolve a seller's `payTo` — clone addresses are ordinary CREATE
 * addresses and cannot be derived off-chain. `undefined` means the seller has not run
 * `createSplitter` yet, and has nothing publishable.
 */
export async function splitterOf(
  client: PublicClient,
  factory: Address,
  seller: Address,
): Promise<Address | undefined> {
  const splitter = await client.readContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'splitterOf',
    args: [getAddress(seller)],
  });
  return splitter === ZERO_ADDRESS ? undefined : splitter;
}

/**
 * Deploy the seller's splitter if it does not exist yet, and return its address either way.
 * `createSplitter` is idempotent on-chain, but the read short-circuits the tx in the common case.
 */
export async function ensureSplitter(
  publicClient: PublicClient,
  walletClient: ReadyWalletClient,
  factory: Address,
  seller: Address,
): Promise<{ splitter: Address; deployed: boolean; txHash?: Hash }> {
  const existing = await splitterOf(publicClient, factory, seller);
  if (existing) return { splitter: existing, deployed: false };

  const txHash = await walletClient.writeContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'createSplitter',
    args: [getAddress(seller)],
    account: walletClient.account,
    chain: walletClient.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // The address is only knowable after the fact, so read it back rather than deriving it.
  const splitter = await splitterOf(publicClient, factory, seller);
  if (!splitter) {
    throw new Error(`createSplitter succeeded in ${txHash} but splitterOf(${seller}) is unset.`);
  }
  return { splitter, deployed: true, txHash };
}

/** Read a clone's frozen terms. Useful as a buyer-side check that `payTo` is a real splitter. */
export async function splitterTerms(
  client: PublicClient,
  splitter: Address,
): Promise<SplitterTerms> {
  const address = getAddress(splitter);
  const [seller, treasury, taxBps] = await Promise.all([
    client.readContract({ address, abi: REVENUE_SPLITTER_ABI, functionName: 'seller' }),
    client.readContract({ address, abi: REVENUE_SPLITTER_ABI, functionName: 'treasury' }),
    client.readContract({ address, abi: REVENUE_SPLITTER_ABI, functionName: 'taxBps' }),
  ]);
  return { seller, treasury, taxBps };
}

export interface FactoryConfig {
  /** Treasury applied to clones created from now on. Existing clones keep their frozen terms. */
  treasury: Address;
  /** Tax rate applied to clones created from now on, in basis points. */
  defaultTaxBps: number;
  /** The EIP-1167 clone target this factory deploys against. */
  implementation: Address;
}

/**
 * The factory's current settings.
 *
 * `defaultTaxBps` is the rate for *future* clones only — each clone freezes its own `taxBps` at
 * `initialize`, so an existing seller's effective rate can differ. Use `splitterTerms` for what a
 * given seller actually pays.
 */
export async function factoryConfig(
  client: PublicClient,
  factory: Address,
): Promise<FactoryConfig> {
  const address = getAddress(factory);
  const [treasury, defaultTaxBps, implementation] = await Promise.all([
    client.readContract({ address, abi: SPLITTER_FACTORY_ABI, functionName: 'treasury' }),
    client.readContract({ address, abi: SPLITTER_FACTORY_ABI, functionName: 'defaultTaxBps' }),
    client.readContract({ address, abi: SPLITTER_FACTORY_ABI, functionName: 'implementation' }),
  ]);
  return { treasury, defaultTaxBps, implementation };
}

/** Total number of splitter clones the factory has created. */
export async function splitterCount(client: PublicClient, factory: Address): Promise<bigint> {
  return client.readContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'splitterCount',
  });
}

/**
 * A page of the factory's clone registry, in creation order.
 *
 * `limit` is clamped on-chain, so `MAX_UINT256` reads from `offset` to the end. Prefer this over
 * replaying `SplitterCreated` logs when you just need the current set — no log retention limits,
 * no reorg bookkeeping.
 */
export async function splittersSlice(
  client: PublicClient,
  factory: Address,
  offset: bigint,
  limit: bigint,
): Promise<readonly Address[]> {
  return client.readContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'splittersSlice',
    args: [offset, limit],
  });
}

/**
 * Sweep `token` out of every clone in `[offset, offset + limit)` — the marketplace operator's
 * collection call, one transaction for all sellers.
 *
 * Permissionless, like `distribute`: a sweep can only move funds to the seller and treasury
 * addresses frozen at each clone's creation. Clones that revert (a blacklisted seller, say) are
 * skipped rather than aborting the batch; the receipt's `DistributeSkipped` logs name them.
 *
 * The loop is one external call per clone with no gas ceiling — paginate once the registry is
 * large enough that a full sweep approaches the block limit.
 */
export async function distributeAll(
  walletClient: ReadyWalletClient,
  factory: Address,
  token: Address,
  offset: bigint = 0n,
  limit: bigint = MAX_UINT256,
): Promise<Hash> {
  return walletClient.writeContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'distributeAll',
    args: [getAddress(token), offset, limit],
    account: walletClient.account,
    chain: walletClient.chain,
  });
}

/**
 * Sweep `token` out of an explicit set of clones — for a keeper that has already used `pending`
 * to find the ones actually holding a balance and would rather not pay to walk idle clones.
 */
export async function distributeForMany(
  walletClient: ReadyWalletClient,
  factory: Address,
  splitters: Address[],
  token: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'distributeFor',
    args: [splitters.map((s) => getAddress(s)), getAddress(token)],
    account: walletClient.account,
    chain: walletClient.chain,
  });
}

/** Amounts each party would receive if `distribute` were called right now. */
export async function pending(
  client: PublicClient,
  splitter: Address,
  token: Address,
): Promise<{ sellerAmount: bigint; treasuryAmount: bigint }> {
  const [sellerAmount, treasuryAmount] = await client.readContract({
    address: getAddress(splitter),
    abi: REVENUE_SPLITTER_ABI,
    functionName: 'pending',
    args: [getAddress(token)],
  });
  return { sellerAmount, treasuryAmount };
}

/** Release the accrued balance of one token. Permissionless — any account may call it. */
export async function distribute(
  walletClient: ReadyWalletClient,
  splitter: Address,
  token: Address,
): Promise<Hash> {
  return walletClient.writeContract({
    address: getAddress(splitter),
    abi: REVENUE_SPLITTER_ABI,
    functionName: 'distribute',
    args: [getAddress(token)],
    account: walletClient.account,
    chain: walletClient.chain,
  });
}

/** Release several tokens in one transaction. */
export async function distributeMany(
  walletClient: ReadyWalletClient,
  splitter: Address,
  tokens: Address[],
): Promise<Hash> {
  return walletClient.writeContract({
    address: getAddress(splitter),
    abi: REVENUE_SPLITTER_ABI,
    functionName: 'distributeMany',
    args: [tokens.map((t) => getAddress(t))],
    account: walletClient.account,
    chain: walletClient.chain,
  });
}
