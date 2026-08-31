/**
 * ERC-8004 Identity Registry per chain — the source of the agent <-> splitter link.
 *
 * Mirrors CHAIN_DEFAULTS in erc8004-adapter/src/client.ts. Empty string means "not deployed on
 * this chain yet", in which case the dashboard simply omits agent identity: the link is
 * supplementary, never a reason to fail booting.
 */
export interface RegistryDeployment {
  address: string;
  /** Block the registry was deployed at. Scanning from 0 is not viable on a public node. */
  deployBlock: number;
}

export const IDENTITY_REGISTRIES: Record<number, RegistryDeployment> = {
  84532: { address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', deployBlock: 40400000 },
  8453: { address: '', deployBlock: 0 },
};

/**
 * How many blocks per `eth_getLogs` call. Public nodes reject wide ranges; this is the knob to
 * turn when the index comes back partial.
 */
export const DEFAULT_LOG_CHUNK_BLOCKS = 500_000;

/** Ceiling on chunks per sweep, so a misconfigured fromBlock cannot spin forever. */
export const MAX_LOG_CHUNKS = 40;
