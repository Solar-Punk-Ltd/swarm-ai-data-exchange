/**
 * Deployed factory addresses per chain.
 *
 * Mirrors the CHAIN_DEFAULTS shape in erc8004-adapter/src/client.ts: empty string means
 * "not deployed on this chain yet", and callers may always override via config/env.
 * Keep in sync with `deployments/<network>.json`, which `script/Deploy.s.sol` writes.
 */
export interface SplitterDeployment {
  factory: string;
  implementation: string;
  chainId: number;
}

export const SPLITTER_DEPLOYMENTS: Record<string, SplitterDeployment> = {
  'base-sepolia': { factory: '', implementation: '', chainId: 84532 },
  base: { factory: '', implementation: '', chainId: 8453 },
};

/** CAIP-2 ("eip155:84532") → the chain key used by SPLITTER_DEPLOYMENTS. */
export function chainKeyFromCaip2(caip2: string): string | undefined {
  const chainId = Number(caip2.split(':').pop());
  return Object.keys(SPLITTER_DEPLOYMENTS).find(
    (key) => SPLITTER_DEPLOYMENTS[key].chainId === chainId,
  );
}

/** Resolve the factory address for a chain, preferring an explicit override. */
export function resolveFactoryAddress(chain: string, override?: string): string | undefined {
  if (override) return override;
  const deployment = SPLITTER_DEPLOYMENTS[chain];
  return deployment?.factory || undefined;
}
