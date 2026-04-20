import type { Signer, Provider } from 'ethers';
import { IdentityModule } from './modules/identity';
import { ReputationModule } from './modules/reputation';
import { AggregateModule } from './modules/aggregate';
import type { ERC8004Config } from './types';

interface ChainDefaults {
  identityRegistry: string;
  reputationRegistry: string;
  chainId: bigint;
}

// Contract addresses are set once deployed. Override via config.contracts if needed.
const CHAIN_DEFAULTS: Record<string, ChainDefaults> = {
  'base-sepolia': {
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    chainId: 84532n,
  },
  base: {
    identityRegistry: '',
    reputationRegistry: '',
    chainId: 8453n,
  },
  mainnet: {
    identityRegistry: '',
    reputationRegistry: '',
    chainId: 1n,
  },
};

export interface ERC8004Client {
  identity: IdentityModule;
  reputation: ReputationModule;
  aggregate: AggregateModule;
}

export function createERC8004Client(config: ERC8004Config): ERC8004Client {
  const defaults = CHAIN_DEFAULTS[config.chain];
  if (!defaults)
    throw new Error(
      `Unsupported chain: ${config.chain}. Pass contracts addresses via config.contracts.`,
    );

  const identityAddress = config.contracts?.identityRegistry ?? defaults.identityRegistry;
  const reputationAddress = config.contracts?.reputationRegistry ?? defaults.reputationRegistry;

  if (!identityAddress) {
    throw new Error(
      `Identity registry address not configured for chain "${config.chain}". Pass it via config.contracts.identityRegistry.`,
    );
  }
  if (!reputationAddress) {
    throw new Error(
      `Reputation registry address not configured for chain "${config.chain}". Pass it via config.contracts.reputationRegistry.`,
    );
  }

  const runner: Signer | Provider = config.signer ?? config.provider;

  const identity = new IdentityModule(identityAddress, runner, defaults.chainId);
  const reputation = new ReputationModule(reputationAddress, runner, defaults.chainId);
  const aggregate = new AggregateModule(reputation);

  return { identity, reputation, aggregate };
}
