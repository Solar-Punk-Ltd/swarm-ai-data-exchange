// One Agent Card shared by two registries at the SAME address on two chains: discovery on one
// chain must only ever look at its own registry's entries, because agentIds collide.
jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    bee: { endpoint: 'http://bee.test', catalogFeedPrivateKey: undefined },
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

// fetchAgentCard reads the card through the local Bee feed reader; serve it from `currentCard`.
let currentCard: unknown = null;
jest.mock('@ethersphere/bee-js', () => ({
  Bee: jest.fn().mockImplementation(() => ({
    makeFeedReader: () => ({
      downloadPayload: async () => {
        if (!currentCard) throw new Error('feed not found');
        return {
          payload: {
            toUtf8: () =>
              JSON.stringify(currentCard, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
          },
        };
      },
    }),
  })),
}));

import type { AgentCard, ERC8004Client } from '@solarpunk/erc8004-adapter';
import {
  cardsEqual,
  discoverCandidates,
  isOwnRegistration,
  registryId,
} from '../src/agent-identity';
import type { IdentityContext } from '../src/agent-identity';

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const BASE_REG = `eip155:84532:${REGISTRY}`;
const CELO_REG = `eip155:11142220:${REGISTRY}`;
const SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const FEED_OWNER = '0x1111111111111111111111111111111111111111';
const AGENT_URI = `https://gw.example/feeds/${FEED_OWNER.slice(2)}/abcd`;

const ctx: IdentityContext = {
  feedOwner: FEED_OWNER,
  agentURI: AGENT_URI,
  signer: SIGNER,
  feedPk: '0x' + '1'.repeat(64),
  privateKey: '0x' + '2'.repeat(64),
};

function card(registrations: AgentCard['registrations']): AgentCard {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Seller',
    description: 'd',
    version: '1.0.0',
    image: '',
    services: [],
    x402Support: false,
    active: true,
    capabilities: [],
    registrations,
  };
}

/** A client for one chain. Tokens not in `owners` revert, as ownerOf does for a missing id. */
function client(chainId: bigint, owners: Record<string, string>, scan: bigint[] = []) {
  const getOwner = jest.fn(async (id: bigint) => {
    const owner = owners[id.toString()];
    if (!owner) throw new Error('ERC721NonexistentToken');
    return owner;
  });
  const erc8004 = {
    identity: {
      networkChainId: chainId,
      contractAddress: REGISTRY,
      getOwner,
      getAgentURI: jest.fn(async () => AGENT_URI),
      findAgentsWithMetadata: jest.fn(async () =>
        scan.map((agentId) => ({
          agentId,
          uri: AGENT_URI,
          rawValue: new TextEncoder().encode(FEED_OWNER),
        })),
      ),
    },
  } as unknown as ERC8004Client;
  return { erc8004, getOwner };
}

beforeEach(() => {
  currentCard = null;
});

describe('registryId / isOwnRegistration', () => {
  it('derives the CAIP-10 registry id and matches it case-insensitively', () => {
    const { erc8004 } = client(11142220n, {});
    expect(registryId(erc8004)).toBe(CELO_REG);
    expect(isOwnRegistration(erc8004, { agentId: 1n, agentRegistry: CELO_REG.toLowerCase() })).toBe(
      true,
    );
    expect(isOwnRegistration(erc8004, { agentId: 1n, agentRegistry: BASE_REG })).toBe(false);
  });

  it('attributes a legacy entry without agentRegistry to the primary chain only', () => {
    const legacy = { agentId: 1n } as never;
    expect(isOwnRegistration(client(84532n, {}).erc8004, legacy)).toBe(true);
    expect(isOwnRegistration(client(11142220n, {}).erc8004, legacy)).toBe(false);
  });
});

describe('discoverCandidates on a second chain', () => {
  it('never classifies another registry’s entry against this one', async () => {
    // Card names only Base #7. On Celo, #7 belongs to a stranger: classifying it would read as
    // "owned by someone else" and block minting forever.
    currentCard = card([{ agentId: 7n, agentRegistry: BASE_REG }]);
    const celo = client(11142220n, { '7': '0x000000000000000000000000000000000000dEaD' });

    const result = await discoverCandidates(celo.erc8004, ctx);

    expect(celo.getOwner).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
  });

  it('verifies the entry for this registry', async () => {
    currentCard = card([
      { agentId: 7n, agentRegistry: BASE_REG },
      { agentId: 9n, agentRegistry: CELO_REG },
    ]);
    const celo = client(11142220n, { '9': SIGNER });

    const result = await discoverCandidates(celo.erc8004, ctx);

    expect(result.candidates).toEqual([
      expect.objectContaining({ agentId: '9', verdict: 'verified', source: 'card' }),
    ]);
  });

  it('does not treat a colliding agentId from the other chain as naming this token', async () => {
    // Celo token #7 is ours, but the card's #7 is the BASE registration: the Celo token is
    // repairable (card must gain a Celo entry), not verified.
    currentCard = card([{ agentId: 7n, agentRegistry: BASE_REG }]);
    const celo = client(11142220n, { '7': SIGNER }, [7n]);

    const result = await discoverCandidates(celo.erc8004, ctx);

    expect(result.candidates).toEqual([
      expect.objectContaining({ agentId: '7', verdict: 'repairable', source: 'scan' }),
    ]);
  });
});

describe('cardsEqual', () => {
  it('ignores the order of registrations', () => {
    const a = card([
      { agentId: 7n, agentRegistry: BASE_REG },
      { agentId: 9n, agentRegistry: CELO_REG },
    ]);
    const b = card([
      { agentId: 9n, agentRegistry: CELO_REG },
      { agentId: 7n, agentRegistry: BASE_REG },
    ]);
    expect(cardsEqual(a, b)).toBe(true);
    expect(cardsEqual(a, card([{ agentId: 7n, agentRegistry: BASE_REG }]))).toBe(false);
  });
});
