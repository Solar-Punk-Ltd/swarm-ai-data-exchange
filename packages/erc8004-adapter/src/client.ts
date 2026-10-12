import type { Signer, Provider } from 'ethers';
import { IdentityModule } from './modules/identity';
import { ReputationModule } from './modules/reputation';
import { AggregateModule } from './modules/aggregate';
import type { ERC8004Config } from './types';

interface ChainDefaults {
  identityRegistry: string;
  reputationRegistry: string;
  chainId: bigint;
  deployBlock: number;
}

// Contract addresses are set once deployed. Override via config.contracts if needed.
const CHAIN_DEFAULTS: Record<string, ChainDefaults> = {
  'base-sepolia': {
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    chainId: 84532n,
    deployBlock: 40400000, // block to start scanning from
  },
  base: {
    identityRegistry: '',
    reputationRegistry: '',
    chainId: 8453n,
    deployBlock: 0,
  },
  mainnet: {
    identityRegistry: '',
    reputationRegistry: '',
    chainId: 1n,
    deployBlock: 0,
  },
  'celo-sepolia': {
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    chainId: 11142220n,
    deployBlock: 17013547,
  },
  celo: {
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    chainId: 42220n,
    deployBlock: 0, // look up before use
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

  const identity = new IdentityModule(
    identityAddress,
    runner,
    defaults.chainId,
    defaults.deployBlock,
  );
  const reputation = new ReputationModule(reputationAddress, runner, defaults.chainId);
  const aggregate = new AggregateModule(reputation);

  return { identity, reputation, aggregate };
}
