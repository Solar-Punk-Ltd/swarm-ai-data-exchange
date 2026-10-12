/**
 * Which RPC endpoint to use for a chain. Shared by the splitter (viem) and identity (ethers)
 * layers so both resolve a chain to the same node.
 *
 * Order: RPC_URLS[caip2] wins; the primary identity chain (ERC8004_CHAIN) then falls back to the
 * legacy RPC_URL; any other chain uses its viem definition's public default.
 */
import { CHAIN_CAIP2, chainForCaip2 } from './chains';
import config from './config';

export function rpcUrlFor(caip2: string): string {
  const explicit = config.chain.rpcUrls[caip2];
  if (explicit) return explicit;
  if (caip2 === CHAIN_CAIP2[config.chain.chain]) return config.chain.rpcUrl;
  return chainForCaip2(caip2).rpcUrls.default.http[0];
}

/** Same, keyed by the adapter's chain name (`base-sepolia`, `celo-sepolia`). */
export function rpcUrlForChainName(chainName: string): string {
  const caip2 = CHAIN_CAIP2[chainName];
  if (!caip2) {
    if (chainName === config.chain.chain) return config.chain.rpcUrl;
    throw new Error(
      `Unknown chain "${chainName}". Expected one of ${Object.keys(CHAIN_CAIP2).join(', ')}.`,
    );
  }
  return rpcUrlFor(caip2);
}
