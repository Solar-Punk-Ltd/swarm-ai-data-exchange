/**
 * Per-seller revenue splitter resolution, one clone per payment rail.
 *
 * The splitter is the seller's x402 `payTo`: a purchase settles into it in full and is released
 * fractionally later, (1 - t) to the seller and t to the marketplace treasury. Routing listings
 * through it is what makes a sale taxed, and only taxed sales produce a valid Proof-of-Purchase —
 * so a listing that advertises a bare EOA earns the seller no reputation.
 *
 * A catalog item may advertise several rails (Base Sepolia and Celo Sepolia, say), and each rail
 * needs its own clone from that chain's factory: a clone address means nothing on another chain.
 * Rails are keyed by CAIP-2 throughout, because that is what `payment[].chainId` carries.
 *
 * The clone must exist before a listing can name it: its address is an ordinary CREATE address
 * recorded in the factory's `splitterOf` mapping, with no way to derive it off-chain. The seller
 * deploys their own clone (`register_agent`) and so pays that gas themselves, on every rail.
 */
import type { PaymentRequirements } from '@solarpunk/swarm-catalog';
import { ensureSplitter, splitterOf, splitterTerms } from '@solarpunk/contracts';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import type { Account, Address, Chain, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_CAIP2, chainForCaip2 } from './chains';
import config from './config';
import { rpcUrlFor } from './rpc';

/** The CAIP-2 network of ERC8004_CHAIN: where the agent's identity lives, and the default rail. */
export function identityRail(): string {
  const caip2 = CHAIN_CAIP2[config.chain.chain];
  if (!caip2) {
    throw new Error(
      `Unsupported ERC8004_CHAIN "${config.chain.chain}". Expected one of ${Object.keys(CHAIN_CAIP2).join(', ')}.`,
    );
  }
  return caip2;
}

/** Every rail that has a factory configured, identity rail first when present. */
export function configuredRails(): string[] {
  const rails = Object.keys(config.splitter.factoryAddresses);
  const identity = CHAIN_CAIP2[config.chain.chain];
  return identity && rails.includes(identity)
    ? [identity, ...rails.filter((r) => r !== identity)]
    : rails;
}

function resolveChain(caip2: string): Chain {
  return chainForCaip2(caip2);
}

export function publicClient(caip2: string = identityRail()): PublicClient {
  const chain = resolveChain(caip2);
  return createPublicClient({ chain, transport: http(rpcUrlFor(caip2)) }) as PublicClient;
}

function walletClient(caip2: string): WalletClient & { account: Account; chain: Chain } {
  const key = config.chain.walletPrivateKey;
  if (!key) {
    throw new Error('Missing PRIVATE_KEY — required to deploy a splitter clone.');
  }
  const chain = resolveChain(caip2);
  return createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain,
    transport: http(rpcUrlFor(caip2)),
  }) as WalletClient & { account: Account; chain: Chain };
}

export interface SplitterContext {
  factory: Address;
  seller: Address;
  /** CAIP-2 rail the factory lives on. Defaults to the identity rail for legacy callers. */
  chainId?: string;
}

/** The factory on a rail, or undefined when none is configured there. */
export function factoryAddress(caip2: string = identityRail()): Address | undefined {
  const factory = config.splitter.factoryAddresses[caip2];
  return factory ? getAddress(factory) : undefined;
}

/** The configured seller, or undefined when AGENT_PAYMENT_ADDRESS is unset. */
export function sellerAddress(): Address | undefined {
  const { sellerAddress: seller } = config.splitter;
  return seller ? getAddress(seller) : undefined;
}

/** Both halves of the configuration for a rail, or undefined when either is missing. */
export function splitterContext(caip2: string = identityRail()): SplitterContext | undefined {
  const factory = factoryAddress(caip2);
  const seller = sellerAddress();
  if (!factory || !seller) return undefined;
  return { factory, seller, chainId: caip2 };
}

export interface ReadSplitterResult {
  /** Null until the seller has deployed their clone — never a speculative address. */
  splitter: Address | null;
  seller: Address;
  factory: Address;
  chainId: string;
  deployed: boolean;
  treasury?: Address;
  taxBps?: number;
}

export interface CreateSplitterResult {
  splitter: Address;
  seller: Address;
  factory: Address;
  chainId: string;
  /** True when the seller already had a clone, so no transaction was sent. */
  alreadyExisted: boolean;
  txHash?: string;
  treasury: Address;
  taxBps: number;
}

/**
 * Read the seller's splitter on a rail. Pure RPC, no signer.
 *
 * Returns `splitter: null` when the seller has not deployed one. It deliberately never invents an
 * address: publishing a `payTo` that nobody can collect from is worse than failing here.
 */
export async function readSplitter(ctx: SplitterContext): Promise<ReadSplitterResult> {
  const chainId = ctx.chainId ?? identityRail();
  const client = publicClient(chainId);
  const splitter = await splitterOf(client, ctx.factory, ctx.seller);

  if (!splitter) {
    return { splitter: null, seller: ctx.seller, factory: ctx.factory, chainId, deployed: false };
  }

  const terms = await splitterTerms(client, splitter);
  return {
    splitter,
    seller: ctx.seller,
    factory: ctx.factory,
    chainId,
    deployed: true,
    treasury: terms.treasury,
    taxBps: terms.taxBps,
  };
}

/**
 * Deploy the seller's splitter clone on a rail, or return the one they already have.
 *
 * Sends a transaction from `PRIVATE_KEY`, so the seller pays for their own clone rather than the
 * marketplace operator who would otherwise hit the cost during a sweep — and pays it in that
 * chain's gas token. Idempotent: a seller who already has a clone gets it back with
 * `alreadyExisted: true` and no transaction.
 */
export async function createSplitter(
  ctx: SplitterContext,
  pollDelaysMs: readonly number[] = SPLITTER_POLL_DELAYS_MS,
): Promise<CreateSplitterResult> {
  const chainId = ctx.chainId ?? identityRail();
  const client = publicClient(chainId);

  // Short-circuit before touching the signer. `ensureSplitter` performs the same `splitterOf`
  // check internally, but `walletClient()` would be evaluated as an argument first and throws
  // when PRIVATE_KEY is unset — so a seller who already has a clone got "Missing PRIVATE_KEY"
  // instead of their address. register_agent runs this on every startup, where returning the
  // existing clone read-only is the common case.
  const existing = await splitterOf(client, ctx.factory, ctx.seller);
  if (existing) {
    const terms = await splitterTerms(client, existing);
    return {
      splitter: existing,
      seller: ctx.seller,
      factory: ctx.factory,
      chainId,
      alreadyExisted: true,
      treasury: terms.treasury,
      taxBps: terms.taxBps,
    };
  }

  let splitter: Address;
  let deployed: boolean;
  let txHash: string | undefined;
  try {
    ({ splitter, deployed, txHash } = await ensureSplitter(
      client,
      walletClient(chainId),
      ctx.factory,
      ctx.seller,
    ));
  } catch (err) {
    // `ensureSplitter` reads `splitterOf` straight after the receipt. Behind a load-balanced RPC
    // that read can land on a node a block behind and come back empty for a clone that does
    // exist — the documented "sellers need two starts" race, which would now hit once per rail.
    // The deploy itself succeeded, so poll for the address instead of failing the rail.
    const message = err instanceof Error ? err.message : String(err);
    const unset = /createSplitter succeeded in (0x[0-9a-fA-F]+) but splitterOf\(.*\) is unset/.exec(
      message,
    );
    if (!unset) throw err;
    txHash = unset[1];
    deployed = true;
    splitter = await pollSplitterOf(client, ctx, pollDelaysMs, txHash);
  }
  const terms = await splitterTerms(client, splitter);
  return {
    splitter,
    seller: ctx.seller,
    factory: ctx.factory,
    chainId,
    alreadyExisted: !deployed,
    txHash,
    treasury: terms.treasury,
    taxBps: terms.taxBps,
  };
}

/** Backoff for re-reading `splitterOf` after a confirmed deploy whose first read came back empty. */
export const SPLITTER_POLL_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function pollSplitterOf(
  client: PublicClient,
  ctx: SplitterContext,
  delaysMs: readonly number[],
  txHash: string,
): Promise<Address> {
  for (const delay of delaysMs) {
    await sleep(delay);
    const splitter = await splitterOf(client, ctx.factory, ctx.seller);
    if (splitter) return splitter;
  }
  throw new Error(
    `createSplitter succeeded in ${txHash} but splitterOf(${ctx.seller}) stayed unset after ` +
      `${delaysMs.length} retries. Re-run register_agent; it will find the clone.`,
  );
}

/** A payment entry as accepted from a tool caller: payTo may be omitted and resolved for them. */
export type PaymentInput = Omit<PaymentRequirements, 'payTo'> & { payTo?: string };

/**
 * Fill in (or verify) `payTo` on every payment entry of an item, rail by rail.
 *
 * Publishing an item whose payTo is not the seller's splitter on that rail is treated as an
 * error rather than a warning: it would silently produce an untaxed listing that earns the seller
 * no reputation, and the mistake is only visible much later, at purchase time. So is a rail with
 * no factory configured: the catalog would advertise a chain where nothing can collect the tax.
 */
export async function resolvePayTo(
  payments: PaymentInput[],
  itemId: string,
): Promise<PaymentRequirements[]> {
  const seller = sellerAddress();
  const rails = configuredRails();

  // Legacy mode: no splitter configured anywhere, so payTo must be supplied explicitly.
  if (rails.length === 0 || !seller) {
    return payments.map((payment) => {
      if (!payment.payTo) {
        throw new Error(
          `Item ${itemId}: payment entry has no payTo, and no splitter is configured. ` +
            'Set SPLITTER_FACTORY_ADDRESSES + AGENT_PAYMENT_ADDRESS, or supply payTo explicitly.',
        );
      }
      return { ...payment, payTo: payment.payTo };
    });
  }

  // One splitterOf per distinct rail, not per payment entry.
  const clones = new Map<string, Address>();
  for (const rail of new Set(payments.map((p) => p.chainId))) {
    const ctx = splitterContext(rail);
    if (!ctx) {
      throw new Error(
        `Item ${itemId}: payment rail ${rail} has no SplitterFactory configured ` +
          `(configured rails: ${rails.join(', ')}). Add it to SPLITTER_FACTORY_ADDRESSES or ` +
          'drop that rail from payment[]; a listing on a rail with no splitter is untaxed.',
      );
    }
    const splitter = await splitterOf(publicClient(rail), ctx.factory, ctx.seller);
    if (!splitter) {
      throw new Error(
        `Item ${itemId}: seller ${ctx.seller} has no split contract on ${rail} ` +
          `(factory ${ctx.factory}). Run register_agent first — it deploys the clone on every ` +
          'configured rail. A listing must point at a deployed splitter, or the sale is untaxed ' +
          'and earns no Proof-of-Purchase.',
      );
    }
    clones.set(rail, splitter);
  }

  return payments.map((payment) => {
    const splitter = clones.get(payment.chainId)!;
    if (payment.payTo && getAddress(payment.payTo) !== splitter) {
      throw new Error(
        `Item ${itemId}: payTo ${payment.payTo} is not this seller's split contract on ` +
          `${payment.chainId} (${splitter}). Settling elsewhere is untaxed and earns no ` +
          'Proof-of-Purchase. Omit payTo to use the splitter.',
      );
    }
    return { ...payment, payTo: splitter };
  });
}
