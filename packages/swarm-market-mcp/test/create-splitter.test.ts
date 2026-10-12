// A confirmed clone deploy whose immediate splitterOf read comes back empty (an RPC node a block
// behind) must resolve by polling, not fail the rail — that race made sellers need two starts.
jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    chain: {
      rpcUrl: 'https://base.example',
      chain: 'base-sepolia',
      chains: ['base-sepolia'],
      rpcUrls: {},
      walletPrivateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    },
    payment: { rpcUrls: {} },
    splitter: { factoryAddresses: {}, sellerAddress: undefined },
  },
}));

jest.mock('@solarpunk/contracts', () => ({
  splitterOf: jest.fn(),
  splitterTerms: jest.fn(),
  ensureSplitter: jest.fn(),
}));

import { ensureSplitter, splitterOf, splitterTerms } from '@solarpunk/contracts';
import { createSplitter } from '../src/splitter';

const splitterOfMock = splitterOf as jest.Mock;
const ensureMock = ensureSplitter as jest.Mock;
const termsMock = splitterTerms as jest.Mock;

const CTX = {
  factory: '0x1000000000000000000000000000000000000001' as const,
  seller: '0x5e11e5000000000000000000000000000000005e' as const,
  chainId: 'eip155:84532',
};
const CLONE = '0xCe10000000000000000000000000000000000002';
const UNSET = new Error(
  `createSplitter succeeded in 0xabc123 but splitterOf(${CTX.seller}) is unset.`,
);

beforeEach(() => {
  splitterOfMock.mockReset();
  ensureMock.mockReset();
  termsMock.mockReset().mockResolvedValue({ treasury: '0xT', taxBps: 500 });
});

it('polls splitterOf after a confirmed deploy and returns the clone', async () => {
  splitterOfMock
    .mockResolvedValueOnce(undefined) // pre-deploy short-circuit check
    .mockResolvedValueOnce(undefined) // first poll still behind
    .mockResolvedValueOnce(CLONE);
  ensureMock.mockRejectedValue(UNSET);

  const result = await createSplitter(CTX, [0, 0, 0]);

  expect(result).toMatchObject({
    splitter: CLONE,
    txHash: '0xabc123',
    alreadyExisted: false,
    chainId: 'eip155:84532',
  });
  expect(splitterOfMock).toHaveBeenCalledTimes(3);
});

it('gives up with a re-run hint once the polls are exhausted', async () => {
  splitterOfMock.mockResolvedValue(undefined);
  ensureMock.mockRejectedValue(UNSET);

  await expect(createSplitter(CTX, [0, 0])).rejects.toThrow(/stayed unset after 2 retries/);
});

it('rethrows any other deploy failure untouched', async () => {
  splitterOfMock.mockResolvedValue(undefined);
  ensureMock.mockRejectedValue(new Error('insufficient funds'));

  await expect(createSplitter(CTX, [0])).rejects.toThrow('insufficient funds');
});
