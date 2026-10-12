// resolvePayTo with two rails: each entry's payTo must come from the factory on ITS chain.
jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    chain: { rpcUrl: 'https://base.example', chain: 'base-sepolia', rpcUrls: {} },
    payment: { rpcUrls: {} },
    splitter: {
      factoryAddresses: {
        'eip155:84532': '0x1000000000000000000000000000000000000001',
        'eip155:11142220': '0x2000000000000000000000000000000000000002',
      },
      sellerAddress: '0x5e11e5000000000000000000000000000000005e',
    },
  },
}));

jest.mock('@solarpunk/contracts', () => ({
  splitterOf: jest.fn(),
  splitterTerms: jest.fn(),
  ensureSplitter: jest.fn(),
}));

import { splitterOf } from '@solarpunk/contracts';
import { configuredRails, resolvePayTo, splitterContext } from '../src/splitter';

const splitterOfMock = splitterOf as jest.Mock;

const BASE_FACTORY = '0x1000000000000000000000000000000000000001';
const CELO_FACTORY = '0x2000000000000000000000000000000000000002';
const BASE_CLONE = '0xBA5e000000000000000000000000000000000001';
const CELO_CLONE = '0xCe10000000000000000000000000000000000002';

beforeEach(() => {
  splitterOfMock.mockReset();
  splitterOfMock.mockImplementation(async (_client: unknown, factory: string) => {
    if (factory === BASE_FACTORY) return BASE_CLONE;
    if (factory === CELO_FACTORY) return CELO_CLONE;
    return undefined;
  });
});

describe('configuredRails', () => {
  it('lists every rail with a factory, identity rail first', () => {
    expect(configuredRails()).toEqual(['eip155:84532', 'eip155:11142220']);
  });

  it("builds a context per rail with that rail's factory", () => {
    expect(splitterContext('eip155:11142220')).toMatchObject({
      factory: CELO_FACTORY,
      chainId: 'eip155:11142220',
    });
    expect(splitterContext('eip155:1')).toBeUndefined();
  });
});

describe('resolvePayTo', () => {
  const base = { scheme: 'exact' as const, chainId: 'eip155:84532', asset: 'a', amount: '1' };
  const celo = { scheme: 'exact' as const, chainId: 'eip155:11142220', asset: 'b', amount: '1' };

  it("fills payTo from the factory on each entry's own chain", async () => {
    const resolved = await resolvePayTo([base, celo], 'item');
    expect(resolved.map((p) => p.payTo)).toEqual([BASE_CLONE, CELO_CLONE]);
    // One splitterOf per distinct rail, not per entry.
    expect(splitterOfMock).toHaveBeenCalledTimes(2);
  });

  it('accepts an explicit payTo that is the clone on that rail', async () => {
    const resolved = await resolvePayTo([{ ...celo, payTo: CELO_CLONE.toLowerCase() }], 'item');
    expect(resolved[0].payTo).toBe(CELO_CLONE);
  });

  it('rejects a payTo that is the clone from the other rail', async () => {
    await expect(resolvePayTo([{ ...celo, payTo: BASE_CLONE }], 'item')).rejects.toThrow(
      /not this seller's split contract on eip155:11142220/,
    );
  });

  it('rejects a rail with no factory configured', async () => {
    await expect(resolvePayTo([{ ...base, chainId: 'eip155:1' }], 'item')).rejects.toThrow(
      /rail eip155:1 has no SplitterFactory configured/,
    );
  });

  it('rejects a rail where the seller has no clone yet', async () => {
    splitterOfMock.mockImplementation(async (_c: unknown, factory: string) =>
      factory === BASE_FACTORY ? BASE_CLONE : undefined,
    );
    await expect(resolvePayTo([base, celo], 'item')).rejects.toThrow(
      /no split contract on eip155:11142220/,
    );
  });
});
