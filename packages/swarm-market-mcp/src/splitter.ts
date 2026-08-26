/**
 * Per-seller revenue splitter resolution.
 *
 * The splitter is the seller's x402 `payTo`: a purchase settles into it in full and is released
 * fractionally later, (1 - t) to the seller and t to the marketplace treasury. Routing listings
 * through it is what makes a sale taxed, and only taxed sales produce a valid Proof-of-Purchase —
 * so a listing that advertises a bare EOA earns the seller no reputation.
 *
 * The clone must exist before a listing can name it: its address is an ordinary CREATE address
 * recorded in the factory's `splitterOf` mapping, with no way to derive it off-chain. The seller
 * deploys their own clone (`create_split_contract`) and so pays that gas themselves.
 */
import type { PaymentRequirements } from '@solarpunk/swarm-catalog';
import { ensureSplitter, splitterOf, splitterTerms } from '@solarpunk/contracts';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import type { Account, Address, Chain, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import config from './config';

const CHAINS: Record<string, Chain> = {
  'base-sepolia': baseSepolia,
  base,
};

function resolveChain(): Chain {
  const chain = CHAINS[config.chain.chain];
  if (!chain) {
    throw new Error(
      `Unsupported chain for splitter operations: ${config.chain.chain}. Expected one of ${Object.keys(CHAINS).join(', ')}.`,
    );
  }
  return chain;
}

export function publicClient(): PublicClient {
  return createPublicClient({
    chain: resolveChain(),
    transport: http(config.chain.rpcUrl),
  }) as PublicClient;
}

function walletClient(): WalletClient & { account: Account; chain: Chain } {
  const key = config.chain.walletPrivateKey;
  if (!key) {
    throw new Error('Missing PRIVATE_KEY — required to deploy a splitter clone.');
  }
  const chain = resolveChain();
  return createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain,
    transport: http(config.chain.rpcUrl),
  }) as WalletClient & { account: Account; chain: Chain };
}

export interface SplitterContext {
  factory: Address;
  seller: Address;
}

/** The configured factory, or undefined when SPLITTER_FACTORY_ADDRESS is unset. */
export function factoryAddress(): Address | undefined {
  const { factoryAddress: factory } = config.splitter;
  return factory ? getAddress(factory) : undefined;
}

/** The configured seller, or undefined when SELLER_ADDRESS is unset. */
export function sellerAddress(): Address | undefined {
  const { sellerAddress: seller } = config.splitter;
  return seller ? getAddress(seller) : undefined;
}

/** Both halves of the configuration, or undefined when either is missing. */
export function splitterContext(): SplitterContext | undefined {
  const factory = factoryAddress();
  const seller = sellerAddress();
  if (!factory || !seller) return undefined;
  return { factory, seller };
}

export interface ReadSplitterResult {
  /** Null until the seller has deployed their clone — never a speculative address. */
  splitter: Address | null;
  seller: Address;
  factory: Address;
  deployed: boolean;
  treasury?: Address;
  taxBps?: number;
}

export interface CreateSplitterResult {
  splitter: Address;
  seller: Address;
  factory: Address;
  /** True when the seller already had a clone, so no transaction was sent. */
  alreadyExisted: boolean;
  txHash?: string;
  treasury: Address;
  taxBps: number;
}

/**
 * Read the seller's splitter. Pure RPC, no signer.
 *
 * Returns `splitter: null` when the seller has not deployed one. It deliberately never invents an
 * address: publishing a `payTo` that nobody can collect from is worse than failing here.
 */
export async function readSplitter(ctx: SplitterContext): Promise<ReadSplitterResult> {
  const client = publicClient();
  const splitter = await splitterOf(client, ctx.factory, ctx.seller);

  if (!splitter) {
    return { splitter: null, seller: ctx.seller, factory: ctx.factory, deployed: false };
  }

  const terms = await splitterTerms(client, splitter);
  return {
    splitter,
    seller: ctx.seller,
    factory: ctx.factory,
    deployed: true,
    treasury: terms.treasury,
    taxBps: terms.taxBps,
  };
}

/**
 * Deploy the seller's splitter clone, or return the one they already have.
 *
 * Sends a transaction from `PRIVATE_KEY`, so the seller pays for their own clone rather than the
 * marketplace operator who would otherwise hit the cost during a sweep. Idempotent: a seller who
 * already has a clone gets it back with `alreadyExisted: true` and no transaction.
 */
export async function createSplitter(ctx: SplitterContext): Promise<CreateSplitterResult> {
  const client = publicClient();
  const { splitter, deployed, txHash } = await ensureSplitter(
    client,
    walletClient(),
    ctx.factory,
    ctx.seller,
  );
  const terms = await splitterTerms(client, splitter);
  return {
    splitter,
    seller: ctx.seller,
    factory: ctx.factory,
    alreadyExisted: !deployed,
    txHash,
    treasury: terms.treasury,
    taxBps: terms.taxBps,
  };
}

/** A payment entry as accepted from a tool caller: payTo may be omitted and resolved for them. */
export type PaymentInput = Omit<PaymentRequirements, 'payTo'> & { payTo?: string };

/**
 * Fill in (or verify) `payTo` on every payment entry of an item.
 *
 * Publishing an item whose payTo is not the seller's splitter is treated as an error rather than
 * a warning: it would silently produce an untaxed listing that earns the seller no reputation,
 * and the mistake is only visible much later, at purchase time.
 */
export async function resolvePayTo(
  payments: PaymentInput[],
  itemId: string,
): Promise<PaymentRequirements[]> {
  const ctx = splitterContext();

  if (!ctx) {
    return payments.map((payment) => {
      if (!payment.payTo) {
        throw new Error(
          `Item ${itemId}: payment entry has no payTo, and no splitter is configured. ` +
            'Set SPLITTER_FACTORY_ADDRESS + SELLER_ADDRESS, or supply payTo explicitly.',
        );
      }
      return { ...payment, payTo: payment.payTo };
    });
  }

  const splitter = await splitterOf(publicClient(), ctx.factory, ctx.seller);
  if (!splitter) {
    throw new Error(
      `Item ${itemId}: seller ${ctx.seller} has no split contract on factory ${ctx.factory}. ` +
        'Run create_split_contract first — a listing must point at a deployed splitter, or the ' +
        'sale is untaxed and earns no Proof-of-Purchase.',
    );
  }

  return payments.map((payment) => {
    if (payment.payTo && getAddress(payment.payTo) !== splitter) {
      throw new Error(
        `Item ${itemId}: payTo ${payment.payTo} is not this seller's split contract (${splitter}). ` +
          'Settling elsewhere is untaxed and earns no Proof-of-Purchase. Omit payTo to use the splitter.',
      );
    }
    return { ...payment, payTo: splitter };
  });
}
