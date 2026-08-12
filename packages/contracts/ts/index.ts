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

export interface SplitterTerms {
  seller: Address;
  treasury: Address;
  taxBps: number;
}

/** A wallet client that already carries an account and chain, so writes need no extra args. */
type ReadyWalletClient = WalletClient & { account: Account; chain: Chain };

/**
 * Deterministic address of a seller's splitter — valid whether or not the clone is deployed.
 *
 * This is what a publisher writes into `payment[].payTo` at catalog-build time. An x402 `exact`
 * settlement is an ERC-3009 `transferWithAuthorization`, a plain balance move with no callback,
 * so payments credit this address even before the clone exists.
 */
export async function predictSplitter(
  client: PublicClient,
  factory: Address,
  seller: Address,
): Promise<Address> {
  return client.readContract({
    address: getAddress(factory),
    abi: SPLITTER_FACTORY_ABI,
    functionName: 'predictSplitter',
    args: [getAddress(seller)],
  });
}

/** The seller's deployed splitter, or `undefined` if it has not been created yet. */
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

  const splitter = await predictSplitter(publicClient, factory, seller);
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
