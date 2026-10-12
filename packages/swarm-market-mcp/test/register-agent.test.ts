// register_agent across two identity chains, with the identity layer mocked: each chain is
// converged in turn, card writes merge rather than overwrite, and one chain failing never loses
// another chain's agentId.
jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    bee: { endpoint: 'http://bee.test' },
    chain: {
      rpcUrl: 'https://base.example',
      chain: 'base-sepolia',
      chains: ['base-sepolia', 'celo-sepolia'],
      rpcUrls: {},
    },
    payment: { rpcUrls: {} },
    splitter: { factoryAddresses: {} },
  },
}));

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const CHAIN_IDS: Record<string, bigint> = { 'base-sepolia': 84532n, 'celo-sepolia': 11142220n };

// The "feed": every published card becomes what the next read returns.
let feed: unknown = null;
const published: Array<{ registrations?: Array<{ agentId: bigint; agentRegistry: string }> }> = [];
const discover = jest.fn();
const mint = jest.fn();

jest.mock('../src/agent-identity', () => {
  const actual = jest.requireActual('../src/agent-identity');
  return {
    ...actual,
    identityContext: () => ({
      feedOwner: '0x1111111111111111111111111111111111111111',
      agentURI: 'https://gw.example/feeds/1111/abcd',
      signer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      feedPk: '0x' + '1'.repeat(64),
      privateKey: '0x' + '2'.repeat(64),
    }),
    writeClient: (_ctx: unknown, chain: string) => ({
      identity: { networkChainId: CHAIN_IDS[chain], contractAddress: REGISTRY, chain },
    }),
    discoverCandidates: (erc8004: { identity: { chain: string } }) =>
      discover(erc8004.identity.chain),
    fetchAgentCard: async () => ({ card: feed }),
    publishAgentCard: async (_ctx: unknown, card: never) => {
      feed = card;
      published.push(card);
      return `ref-${published.length}`;
    },
    mintAgent: (erc8004: { identity: { chain: string } }) => mint(erc8004.identity.chain),
  };
});

jest.mock('../src/splitter', () => ({
  configuredRails: () => [],
  createSplitter: jest.fn(),
  factoryAddress: () => undefined,
  identityRail: () => 'eip155:84532',
  readSplitter: jest.fn(),
  sellerAddress: () => undefined,
}));

import { registerAgent } from '../src/tools/register_agent/index';

const BASE_REG = `eip155:84532:${REGISTRY}`;
const CELO_REG = `eip155:11142220:${REGISTRY}`;
const ARGS = { name: 'Seller', description: 'sells', skipSplitter: true };

beforeEach(() => {
  feed = null;
  published.length = 0;
  discover.mockReset();
  mint.mockReset();
});

function structured(res: Record<string, unknown>) {
  expect(res.isError).toBeUndefined();
  return res.structuredContent as {
    identity: { agentId: string | null; status: string };
    identities: Array<{
      chain: string;
      chainId: string;
      identity: { agentId: string | null; status: string; error?: string };
    }>;
    warnings: string[];
  };
}

it('mints on both chains and leaves one card naming both registrations', async () => {
  discover.mockResolvedValue({ candidates: [], card: null });
  mint.mockImplementation(async (chain: string) => ({
    agentId: chain === 'base-sepolia' ? 9312n : 7n,
    txHash: `0x${chain}`,
  }));

  const out = structured(await registerAgent(ARGS));

  expect(
    out.identities.map((i) => [i.chain, i.chainId, i.identity.status, i.identity.agentId]),
  ).toEqual([
    ['base-sepolia', 'eip155:84532', 'minted', '9312'],
    ['celo-sepolia', 'eip155:11142220', 'minted', '7'],
  ]);
  expect(out.identity.agentId).toBe('9312');
  const final = published[published.length - 1];
  expect(final.registrations).toEqual([
    { agentId: 7n, agentRegistry: CELO_REG },
    { agentId: 9312n, agentRegistry: BASE_REG },
  ]);
});

it('keeps the Base agentId and reports Celo when the Celo chain fails', async () => {
  discover.mockImplementation(async (chain: string) => {
    if (chain === 'celo-sepolia') throw new Error('celo rpc down');
    return { candidates: [], card: null };
  });
  mint.mockResolvedValue({ agentId: 9312n, txHash: '0xbase' });

  const out = structured(await registerAgent(ARGS));

  expect(out.identities[0].identity.agentId).toBe('9312');
  expect(out.identities[1].identity.status).toBe('failed');
  expect(out.identities[1].identity.error).toMatch(/celo rpc down/);
  expect(out.warnings.join('\n')).toMatch(/\[celo-sepolia\]/);
});

it('adds a Celo registration to an existing Base agent without dropping Base', async () => {
  feed = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Seller',
    description: 'sells',
    registrations: [{ agentId: 9312n, agentRegistry: BASE_REG }],
  };
  discover.mockImplementation(async (chain: string) =>
    chain === 'base-sepolia'
      ? {
          candidates: [
            { agentId: '9312', verdict: 'verified', owner: '', agentURI: '', source: 'card' },
          ],
          card: feed,
        }
      : { candidates: [], card: feed },
  );
  mint.mockResolvedValue({ agentId: 7n, txHash: '0xcelo' });

  const out = structured(await registerAgent({ ...ARGS, refreshCard: false }));

  expect(out.identities[1].identity.status).toBe('minted');
  // Every card written during the Celo mint still names the Base agent.
  for (const card of published) {
    expect(card.registrations).toEqual(
      expect.arrayContaining([{ agentId: 9312n, agentRegistry: BASE_REG }]),
    );
  }
});

it('returns an error only when no chain produced an agentId', async () => {
  discover.mockRejectedValue(new Error('rpc down'));

  const res = await registerAgent(ARGS);

  expect(res.isError).toBe(true);
  expect(JSON.stringify(res.content)).toMatch(/base-sepolia.*celo-sepolia/s);
});
