import { normaliseRegistrations, upsertRegistration } from './agent-card';
import type { AgentCard } from './types';

const BASE = 'eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e';
const CELO = 'eip155:11142220:0x8004A818BFB912233c491871b3d84c89A494BD9e';

const card = (registrations?: AgentCard['registrations']): AgentCard => ({
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'n',
  description: 'd',
  version: '1.0.0',
  image: '',
  services: [],
  x402Support: false,
  active: true,
  registrations,
});

describe('upsertRegistration', () => {
  it('adds a second registry without dropping the first', () => {
    const out = upsertRegistration(card([{ agentId: 9312n, agentRegistry: BASE }]), {
      agentId: 7n,
      agentRegistry: CELO,
    });
    expect(out.registrations).toEqual([
      { agentId: 7n, agentRegistry: CELO },
      { agentId: 9312n, agentRegistry: BASE },
    ]);
  });

  it('replaces the entry for the same registry, matching case-insensitively', () => {
    const out = upsertRegistration(card([{ agentId: 1n, agentRegistry: BASE }]), {
      agentId: 2n,
      agentRegistry: BASE.toLowerCase(),
    });
    expect(out.registrations).toEqual([{ agentId: 2n, agentRegistry: BASE.toLowerCase() }]);
  });

  it('gives the same order whichever chain wrote first, and does not mutate its input', () => {
    const start = card([]);
    const a = upsertRegistration(upsertRegistration(start, { agentId: 1n, agentRegistry: BASE }), {
      agentId: 2n,
      agentRegistry: CELO,
    });
    const b = upsertRegistration(upsertRegistration(start, { agentId: 2n, agentRegistry: CELO }), {
      agentId: 1n,
      agentRegistry: BASE,
    });
    expect(a.registrations).toEqual(b.registrations);
    expect(start.registrations).toEqual([]);
  });
});

describe('normaliseRegistrations', () => {
  it('leaves undefined alone', () => {
    expect(normaliseRegistrations(undefined)).toBeUndefined();
  });
});
