import { CHAIN_CAIP2, chainForCaip2, chainIdFromCaip2, explorerTxUrl } from '../src/chains';

describe('chains', () => {
  it('maps every ERC8004_CHAIN name to a CAIP-2 id', () => {
    expect(CHAIN_CAIP2['base-sepolia']).toBe('eip155:84532');
    expect(CHAIN_CAIP2['celo-sepolia']).toBe('eip155:11142220');
    expect(CHAIN_CAIP2.celo).toBe('eip155:42220');
  });

  it('parses the numeric chain id out of a CAIP-2 id', () => {
    expect(chainIdFromCaip2('eip155:11142220')).toBe(11142220);
    expect(() => chainIdFromCaip2('eip155:celo')).toThrow(/Invalid CAIP-2/);
  });

  it('resolves viem chains for Base and Celo rails and rejects unknown ones', () => {
    expect(chainForCaip2('eip155:84532').name).toMatch(/Base Sepolia/);
    expect(chainForCaip2('eip155:11142220').id).toBe(11142220);
    expect(() => chainForCaip2('eip155:1')).toThrow(/Unsupported chain eip155:1/);
  });

  it('builds explorer links from the chain definition', () => {
    expect(explorerTxUrl(11142220, '0xabc')).toBe('https://celo-sepolia.blockscout.com/tx/0xabc');
    expect(explorerTxUrl(84532, '0xabc')).toBe('https://sepolia.basescan.org/tx/0xabc');
    expect(explorerTxUrl(999, '0xabc')).toBeUndefined();
  });
});
