/**
 * Per-seller revenue splitter resolution.
 *
 * The splitter is the seller's x402 `payTo`: a purchase settles into it in full and is released
 * fractionally later, (1 - t) to the seller and t to the marketplace treasury. Routing listings
 * through it is what makes a sale taxed, and only taxed sales produce a valid Proof-of-Purchase —
 * so a listing that advertises a bare EOA earns the seller no reputation.
 *
 * Addresses are CREATE2-deterministic, so `payTo` can be resolved and published before the clone
 * is deployed; an ERC-3009 settlement credits the address either way.
 */
import type { PaymentRequirements } from '@solarpunk/swarm-catalog';
import { ensureSplitter, predictSplitter, splitterTerms } from '@solarpunk/contracts';
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

export interface EnsureSplitterResult {
  splitter: Address;
  seller: Address;
  factory: Address;
  deployed: boolean;
  txHash?: string;
  treasury?: Address;
  taxBps?: number;
}

/**
 * Resolve — and optionally deploy — the seller's splitter.
 *
 * With `deploy: false` this is a pure read: it returns the deterministic address whether or not
 * code lives there yet, which is all a publisher needs to set `payTo`.
 */
export async function resolveSplitter(
  ctx: SplitterContext,
  deploy: boolean,
): Promise<EnsureSplitterResult> {
  const client = publicClient();

  if (!deploy) {
    const splitter = await predictSplitter(client, ctx.factory, ctx.seller);
    const terms = await splitterTerms(client, splitter).catch(() => undefined);
    return {
      splitter,
      seller: ctx.seller,
      factory: ctx.factory,
      // Terms only read back once the clone exists; a bare predicted address has no code.
      deployed: terms !== undefined,
      treasury: terms?.treasury,
      taxBps: terms?.taxBps,
    };
  }

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
    deployed,
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

  const splitter = await predictSplitter(publicClient(), ctx.factory, ctx.seller);
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
