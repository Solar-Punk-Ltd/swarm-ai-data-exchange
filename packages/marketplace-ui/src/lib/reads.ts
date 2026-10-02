/**
 * Every on-chain read the dashboard performs.
 *
 * All contract calls go through the `@solarpunk/contracts` SDK; the only raw `readContract` here
 * is ERC-20 `balanceOf`, against viem's own `erc20Abi`. No ABI is declared in this package.
 *
 * These are plain async functions rather than hooks on purpose: MarketplaceContext is the single
 * fetch owner, and rows must never poll independently.
 */
import { erc20Abi, multicall3Abi } from 'viem';
import type { Address, PublicClient } from 'viem';
import {
  factoryConfig,
  pendingMany,
  splitterTermsMany,
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

  // `splitterTermsMany` aggregates on-chain: `3N` reads become one. Per-clone `splitterTerms` in
  // a loop is what this used to be, and at N=8 that alone was 24 calls in a single second.
  const terms = await splitterTermsMany(client, splitters);
  const sellers: SellerRecord[] = splitters.map((splitter, i) => ({
    splitter,
    seller: terms[i].seller,
    taxBps: terms[i].taxBps,
  }));

  return { sellers, factory: cfg };
}

/**
 * Every balance on screen, as Multicall3 contract entries.
 *
 * Native balances go through Multicall3's own `getEthBalance` rather than `eth_getBalance`, which
 * is the only way to fold them into the same aggregated call — this is exactly the case the
 * package CLAUDE.md flagged as the reason to prefer the transport batch, and it stops being true
 * the moment the endpoint meters calls instead of requests.
 *
 * `erc20Abi` and `multicall3Abi` are viem's own, so no ABI is declared in this package. The
 * splitter side goes through `pendingMany` in the SDK for the same reason.
 */
function balanceContracts(multicall3: Address, address: Address, currencies: Currency[]) {
  return currencies.map((currency) =>
    currency.address
      ? ({
          address: currency.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        } as const)
      : ({
          address: multicall3,
          abi: multicall3Abi,
          functionName: 'getEthBalance',
          args: [address],
        } as const),
  );
}

/**
 * One tick's worth of balances for every address on screen, in **two** `eth_call`s regardless of
 * how many sellers there are: one aggregating every balance, one aggregating every `pending`.
 *
 * This used to be `3N + 3` JSON-RPC calls relying on viem's transport batching to collapse them
 * into a single HTTP request. That defends against nothing on a public endpoint, because the
 * endpoint meters *calls*: Base Sepolia's public node caps at 25/second and counts each element
 * of a JSON-RPC batch separately, so at N=8 exactly two of the 27 failed on every tick, forever.
 * Batching made it worse, not better — it guaranteed all 27 landed in the same second.
 *
 * `allowFailure: false` throughout, so a reverting call rejects the tick rather than reporting a
 * zero. The dashboard renders a real zero and an unread value differently, and collapsing the two
 * would be a worse bug than the stale banner.
 */
export async function readBalances(
  client: PublicClient,
  params: { treasury: Address; sellers: SellerRecord[]; currencies: Currency[] },
): Promise<BalanceSnapshot> {
  const { treasury, sellers, currencies } = params;
  const multicall3 = client.chain?.contracts?.multicall3?.address;
  if (!multicall3) {
    throw new Error(
      `No Multicall3 address configured for chain ${client.chain?.id ?? 'unknown'}. ` +
        'Every balance read is aggregated through it; add it to the viem chain definition.',
    );
  }

  const holders: Address[] = [treasury, ...sellers.map((s) => s.seller)];
  const erc20s = erc20Currencies(currencies);

  const [balanceResults, pendingResults] = await Promise.all([
    client.multicall({
      allowFailure: false,
      contracts: holders.flatMap((holder) => balanceContracts(multicall3, holder, currencies)),
    }),
    // One aggregated call per ERC-20. With USDC as the only one in the currency config, one call.
    Promise.all(
      erc20s.map((currency) =>
        pendingMany(
          client,
          sellers.map((s) => s.splitter),
          currency.address,
        ),
      ),
    ),
  ]);

  // Results come back positionally, in the order the entries were built.
  const perHolder = currencies.length;
  const balanceFor = (index: number): BalanceMap =>
    Object.fromEntries(
      currencies.map((currency, c) => [
        currency.symbol,
        balanceResults[index * perHolder + c] as bigint,
      ]),
    );

  return {
    treasury: balanceFor(0),
    sellers: Object.fromEntries(sellers.map((s, i) => [s.seller, balanceFor(i + 1)])),
    splitters: Object.fromEntries(
      sellers.map((s, i) => [
        s.splitter,
        Object.fromEntries(
          erc20s.map((currency, c) => [currency.symbol, pendingResults[c][i] as PendingSplit]),
        ) as PendingMap,
      ]),
    ),
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
