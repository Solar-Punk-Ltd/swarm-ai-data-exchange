/**
 * Every on-chain read the dashboard performs.
 *
 * All contract calls go through the `@solarpunk/contracts` SDK; the only raw `readContract` here
 * is ERC-20 `balanceOf`, against viem's own `erc20Abi`. No ABI is declared in this package.
 *
 * These are plain async functions rather than hooks on purpose: MarketplaceContext is the single
 * fetch owner, and rows must never poll independently.
 */
import { erc20Abi } from 'viem';
import type { Address, PublicClient } from 'viem';
import {
  factoryConfig,
  pending,
  splitterTerms,
  splittersSlice,
  MAX_UINT256,
  type FactoryConfig,
} from '@solarpunk/contracts';
import { erc20Currencies, type Currency } from '../config/currencies';

export interface SellerRecord {
  /** The EIP-1167 clone. Not a proxy — its terms are frozen at creation. */
  splitter: Address;
  seller: Address;
  /** This clone's own frozen rate, which may differ from the factory default. */
  taxBps: number;
}

export interface PendingSplit {
  sellerAmount: bigint;
  treasuryAmount: bigint;
}

/** symbol → amount */
export type BalanceMap = Record<string, bigint>;
/** symbol → what each party would receive right now */
export type PendingMap = Record<string, PendingSplit>;

export interface Registry {
  sellers: SellerRecord[];
  factory: FactoryConfig;
}

export interface BalanceSnapshot {
  treasury: BalanceMap;
  /** keyed by seller EOA */
  sellers: Record<Address, BalanceMap>;
  /** keyed by clone address; ERC-20 only, since a clone cannot hold ETH */
  splitters: Record<Address, PendingMap>;
}

/**
 * Load the seller registry.
 *
 * Note the direction: the factory has no seller list. `splitterOf` is a one-way mapping with no
 * enumerable keyset, so we enumerate *clones* and read `seller` off each one. Calling
 * `splitterOf(seller)` afterwards would be a redundant round trip.
 */
export async function loadRegistry(client: PublicClient, factory: Address): Promise<Registry> {
  const [cfg, splitters] = await Promise.all([
    factoryConfig(client, factory),
    // `limit` is clamped on-chain, so MAX_UINT256 safely means "to the end".
    splittersSlice(client, factory, 0n, MAX_UINT256),
  ]);

  const sellers = await Promise.all(
    splitters.map(async (splitter): Promise<SellerRecord> => {
      const terms = await splitterTerms(client, splitter);
      return { splitter, seller: terms.seller, taxBps: terms.taxBps };
    }),
  );

  return { sellers, factory: cfg };
}

async function balancesFor(
  client: PublicClient,
  address: Address,
  currencies: Currency[],
): Promise<BalanceMap> {
  const entries = await Promise.all(
    currencies.map(async (currency): Promise<[string, bigint]> => {
      const amount = currency.address
        ? await client.readContract({
            address: currency.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          })
        : await client.getBalance({ address });
      return [currency.symbol, amount];
    }),
  );
  return Object.fromEntries(entries);
}

async function pendingFor(
  client: PublicClient,
  splitter: Address,
  currencies: Currency[],
): Promise<PendingMap> {
  const entries = await Promise.all(
    erc20Currencies(currencies).map(async (currency): Promise<[string, PendingSplit]> => {
      const split = await pending(client, splitter, currency.address);
      return [currency.symbol, split];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * One tick's worth of balances for every address on screen.
 *
 * Fired as a single `Promise.all` so viem's JSON-RPC batching collapses the whole tick into one
 * HTTP round trip — a naive per-row fetch is `3N + 3` requests every few seconds, which public
 * Base Sepolia rate-limits hard.
 */
export async function readBalances(
  client: PublicClient,
  params: { treasury: Address; sellers: SellerRecord[]; currencies: Currency[] },
): Promise<BalanceSnapshot> {
  const { treasury, sellers, currencies } = params;

  const [treasuryBalances, sellerBalances, splitterPending] = await Promise.all([
    balancesFor(client, treasury, currencies),
    Promise.all(
      sellers.map(
        async (s) => [s.seller, await balancesFor(client, s.seller, currencies)] as const,
      ),
    ),
    Promise.all(
      sellers.map(
        async (s) => [s.splitter, await pendingFor(client, s.splitter, currencies)] as const,
      ),
    ),
  ]);

  return {
    treasury: treasuryBalances,
    sellers: Object.fromEntries(sellerBalances),
    splitters: Object.fromEntries(splitterPending),
  };
}

/** Total held by a clone for one currency — the sum of both parties' shares. */
export function totalPending(split: PendingSplit | undefined): bigint {
  if (!split) return 0n;
  return split.sellerAmount + split.treasuryAmount;
}

/** True when a clone holds a non-zero balance of any ERC-20, i.e. Distribute would do something. */
export function isFunded(pendingMap: PendingMap | undefined): boolean {
  if (!pendingMap) return false;
  return Object.values(pendingMap).some((split) => totalPending(split) > 0n);
}
