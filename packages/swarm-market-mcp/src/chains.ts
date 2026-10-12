/**
 * The chains this server knows how to talk to, in the three spellings the codebase uses:
 *
 *   name   — `base-sepolia`, what ERC8004_CHAIN and the erc8004-adapter's CHAIN_DEFAULTS use
 *   CAIP-2 — `eip155:84532`, what a catalog item's payment[].chainId and the x402 challenge use
 *   id     — 84532, what viem and ethers want
 *
 * Payment rails are keyed by CAIP-2 everywhere in this package, because that is the spelling a
 * buyer sees in the 402 challenge and a seller writes into payment[]. The name form survives
 * only where the adapter needs it (identity chain).
 */
import type { Chain } from 'viem';
import { base, baseSepolia, celo, celoSepolia } from 'viem/chains';

export const CHAINS: Record<number, Chain> = {
  [baseSepolia.id]: baseSepolia,
  [base.id]: base,
  [celoSepolia.id]: celoSepolia,
  [celo.id]: celo,
};

/** ERC8004_CHAIN name → CAIP-2. */
export const CHAIN_CAIP2: Record<string, string> = {
  'base-sepolia': 'eip155:84532',
  base: 'eip155:8453',
  'celo-sepolia': 'eip155:11142220',
  celo: 'eip155:42220',
  mainnet: 'eip155:1',
};

/** CAIP-2 → ERC8004_CHAIN name (the adapter's spelling), or undefined for an unknown chain. */
export function chainNameForCaip2(caip2: string): string | undefined {
  return Object.keys(CHAIN_CAIP2).find((name) => CHAIN_CAIP2[name] === caip2);
}

/** "eip155:84532" → 84532. Throws on anything that is not a numeric CAIP-2 reference. */
export function chainIdFromCaip2(caip2: string): number {
  const id = Number(caip2.split(':').pop());
  if (!Number.isInteger(id)) {
    throw new Error(`Invalid CAIP-2 chain id: ${caip2}`);
  }
  return id;
}

/** The viem chain for a CAIP-2 network, or a readable error naming the supported ones. */
export function chainForCaip2(caip2: string): Chain {
  const chain = CHAINS[chainIdFromCaip2(caip2)];
  if (!chain) {
    throw new Error(
      `Unsupported chain ${caip2}. Expected one of ${Object.values(CHAIN_CAIP2)
        .filter((c) => CHAINS[chainIdFromCaip2(c)])
        .join(', ')}.`,
    );
  }
  return chain;
}

/** Explorer link for a transaction, when the chain's viem definition names an explorer. */
export function explorerTxUrl(chainId: number, txHash: string): string | undefined {
  const explorer = CHAINS[chainId]?.blockExplorers?.default.url;
  return explorer ? `${explorer.replace(/\/+$/, '')}/tx/${txHash}` : undefined;
}
