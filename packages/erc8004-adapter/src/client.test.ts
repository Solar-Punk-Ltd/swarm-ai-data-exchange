import { JsonRpcProvider, Network } from 'ethers';
import { createERC8004Client } from './client';

// A provider that never connects: staticNetwork skips the eth_chainId probe, and no module
// method is called, so nothing reaches the (unroutable) URL.
function offlineProvider(chainId: number): JsonRpcProvider {
  return new JsonRpcProvider('http://127.0.0.1:9', undefined, {
    staticNetwork: Network.from(chainId),
  });
}

describe('createERC8004Client chain defaults', () => {
  it('resolves the Celo Sepolia registries', () => {
    const client = createERC8004Client({
      provider: offlineProvider(11142220),
      chain: 'celo-sepolia',
    });
    expect(client.identity.contractAddress).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e');
    expect(client.identity.networkChainId).toBe(11142220n);
  });

  it('resolves the Celo mainnet registries', () => {
    const client = createERC8004Client({ provider: offlineProvider(42220), chain: 'celo' });
    expect(client.identity.contractAddress).toBe('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432');
    expect(client.identity.networkChainId).toBe(42220n);
  });

  it('keeps Base Sepolia as before', () => {
    const client = createERC8004Client({ provider: offlineProvider(84532), chain: 'base-sepolia' });
    expect(client.identity.contractAddress).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e');
    expect(client.identity.networkChainId).toBe(84532n);
  });

  it('rejects an unknown chain', () => {
    expect(() =>
      createERC8004Client({ provider: offlineProvider(1), chain: 'no-such-chain' }),
    ).toThrow(/Unsupported chain/);
  });
});
