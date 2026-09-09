import { base, baseSepolia } from 'viem/chains';
import type { Chain } from 'viem';

const CHAINS: Record<number, Chain> = {
  [baseSepolia.id]: baseSepolia,
  [base.id]: base,
};

export function chainById(chainId: number): Chain | undefined {
  return CHAINS[chainId];
}

export const SUPPORTED_CHAIN_IDS = Object.keys(CHAINS).map(Number);

/**
 * Block explorer base URL for a chain. Never hardcode `sepolia.basescan.org` — the chain is
 * configurable, so the explorer must be too.
 */
export function explorerUrl(chain: Chain): string | undefined {
  return chain.blockExplorers?.default.url;
}

export function addressUrl(chain: Chain, address: string): string | undefined {
  const base = explorerUrl(chain);
  return base ? `${base}/address/${address}` : undefined;
}

export function txUrl(chain: Chain, hash: string): string | undefined {
  const base = explorerUrl(chain);
  return base ? `${base}/tx/${hash}` : undefined;
}
